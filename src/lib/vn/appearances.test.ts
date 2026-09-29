import { describe, expect, it } from 'vitest'
import { appearanceForCharacter, formMentionedInText, mentionsCharacter } from './appearances'

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
