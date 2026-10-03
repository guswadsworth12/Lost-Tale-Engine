import { describe, expect, it } from 'vitest'
import { appearanceForCharacter, formChoices, formMentionedInText, mentionsCharacter } from './appearances'

const lira = {
  id: 'lira', name: 'Lira',
  outfits: [{ id: 'dragon', label: 'Dragon' }, { id: 'human', label: 'Human' }],
  sprites: { 'dragon--neutral': 'dragon-art', 'human--neutral': 'human-art' },
}
const cole = { id: 'cole', name: 'Cole Harrow', outfits: [{ id: 'travel', label: 'Travel' }], sprites: { 'travel--neutral': 'travel-art' } }
const noFlags = new Set<string>()

describe('per-character stage appearance', () => {
  it('reads a human arrival rather than an earlier dragon nickname', () => {
    const messages = [
      { role: 'user', text: 'Where is my little dragon Lira?' },
      { role: 'char', speakerId: 'cole', scene: { outfit: 'travel' }, text: 'Lira drops off the last rung of the ladder, a basket in one hand and flour on her cheek. She pushes her hair back.' },
    ]
    expect(appearanceForCharacter(messages, lira, 'cole', 0, noFlags)).toBe('human')
    expect(appearanceForCharacter(messages, cole, 'cole', 0, noFlags)).toBe('travel')
  })

  it('never broadcasts one speaker’s outfit to the other cast', () => {
    const messages = [{ role: 'char', speakerId: 'cole', scene: { outfit: 'travel' } }]
    expect(appearanceForCharacter(messages, lira, 'cole', 0, noFlags)).toBe('base')
  })

  it('uses saved AI form decisions, selected swipes, and manual overrides', () => {
    const messages = [{ role: 'char', speakerId: 'cole', scene: { appearances: { lira: 'human' } }, swipeScenes: [{ appearances: { lira: 'dragon' } }, { appearances: { lira: 'human' } }], activeSwipe: 0 }]
    expect(appearanceForCharacter(messages, lira, 'cole', 0, noFlags)).toBe('dragon')
    expect(appearanceForCharacter(messages, lira, 'cole', 0, noFlags, 'human')).toBe('human')
    messages[0].activeSwipe = 1
    expect(appearanceForCharacter(messages, lira, 'cole', 0, noFlags)).toBe('human')
  })

  it('does not treat a dragon nickname as a form change', () => {
    expect(formMentionedInText('Lira is my little dragon.', 'Lira', lira.outfits)).toBeUndefined()
    expect(formMentionedInText('Lira shifts into her dragon form.', 'Lira', lira.outfits)).toBe('dragon')
  })

  it('does not let a player description of an unadjudicated transformation restage an NPC', () => {
    expect(appearanceForCharacter([{ role: 'user', text: 'Lira shifts into dragon form.' }], lira, 'cole', 0, noFlags)).toBe('base')
  })
})

describe('names in narration', () => {
  const forms = [{ id: 'construct', label: 'Construct', kind: 'form' as const }, { id: 'wisp', label: 'Wisp', kind: 'form' as const }]

  it('recognises a two-word card name by its first name', () => {
    expect(formMentionedInText('Al shifts into his wisp form.', 'Al Brand', forms)).toBeUndefined()
    expect(formMentionedInText('Wren shifts into her wisp form.', 'Wren Talley', forms)).toBe('wisp')
    expect(formMentionedInText('Wren Talley shifts into her wisp form.', 'Wren Talley', forms)).toBe('wisp')
  })

  it('matches whole names only', () => {
    expect(mentionsCharacter('Wren arrives.', 'Wren Talley')).toBe(true)
    expect(mentionsCharacter('Wrenfield is quiet.', 'Wren Talley')).toBe(false)
  })
})

describe('a usual look that has a name, and other words for forms', () => {
  // Zinnia-shaped: her human look is the base art; construct and wisp are forms.
  const zin = {
    id: 'zin', name: 'Wren Talley',
    baseForm: { label: 'Human', aliases: ['mortal'] },
    aliases: ['the archivist'],
    outfits: [
      { id: 'construct', label: 'construct', kind: 'form' as const, aliases: ['golem'] },
      { id: 'wisp', label: 'wisp', kind: 'form' as const, aliases: ['will-o\'-wisp', 'spirit'] },
    ],
    sprites: { neutral: 'base-art', 'construct--neutral': 'c', 'wisp--neutral': 'w' },
  }
  const tavi = { id: 'tavi', name: 'Tavi Rook', outfits: [{ id: 'fox', label: 'Fox', kind: 'form' as const }], sprites: { 'fox--neutral': 'f' } }

  it('offers the usual look as a form, so a character with one other form can change both ways', () => {
    expect(formChoices(zin, 0, noFlags).map((f) => f.id)).toEqual(['base', 'construct', 'wisp'])
    expect(formChoices(tavi, 0, noFlags).map((f) => f.id)).toEqual(['base', 'fox'])
    // Only outfits, no forms: nothing to tell apart.
    expect(formChoices(cole, 0, noFlags)).toEqual([])
  })

  it('switches back to a named usual look, and recognises forms by their other words', () => {
    const forms = formChoices(zin, 0, noFlags)
    expect(formMentionedInText('Wren is stabilized in her new human form.', 'Wren Talley', forms)).toBe('base')
    expect(formMentionedInText('Wren becomes a mortal again, as she shifts into the mortal.', 'Wren Talley', forms)).toBe('base')
    expect(formMentionedInText('Wren unravels into a will-o\'-wisp.', 'Wren Talley', forms)).toBe('wisp')
    expect(formMentionedInText('The archivist shifts into her golem shape.', 'Wren Talley', forms, zin.aliases)).toBe('construct')
  })

  it('reads "usual" and its like only as "<word> form", never alone', () => {
    const forms = formChoices(tavi, 0, noFlags)
    expect(formMentionedInText('Tavi takes their usual seat by the stove.', 'Tavi Rook', forms)).toBeUndefined()
    expect(formMentionedInText('Tavi shakes off the fur and returns to their usual form.', 'Tavi Rook', forms)).toBe('base')
    expect(formMentionedInText('Tavi shifts into the fox.', 'Tavi Rook', forms)).toBe('fox')
  })

  it('finds a character by an alias, and puts a saved base decision on stage', () => {
    expect(mentionsCharacter('The archivist sighs.', 'Wren Talley', zin.aliases)).toBe(true)
    const messages = [
      { role: 'char', speakerId: 'gm', scene: { appearances: { zin: 'wisp' } } },
      { role: 'char', speakerId: 'gm', scene: { appearances: { zin: 'base' } } },
    ]
    expect(appearanceForCharacter(messages, zin, 'other', 0, noFlags)).toBe('base')
    expect(appearanceForCharacter(messages.slice(0, 1), zin, 'other', 0, noFlags)).toBe('wisp')
  })
})
