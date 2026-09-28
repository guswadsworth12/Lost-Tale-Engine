import { describe, expect, it } from 'vitest'
import type { GalleryEntry } from '@/lib/characters/cardSpec'
import { ALL_PLAYER_CHARACTERS, cgProgress, isCgUnlocked, lockedCgLabel, playerCharacterOptions, viewableCgs, type CgCharacter, type CgChat } from './cgProgress'

const cg = (id: string, unlockAffection: number, extra: Partial<GalleryEntry> = {}): GalleryEntry => ({
  id,
  title: id,
  imageUrl: `data:image/png;base64,${id}`,
  unlockAffection,
  ...extra,
})

const mira: CgCharacter = {
  id: 'mira',
  card: { name: 'Mira' },
  gallery: [cg('picnic', 30), cg('rooftop', 60), cg('festival', 90), cg('epilogue', 0, { isEnding: true })],
}
const sol: CgCharacter = { id: 'sol', card: { name: 'Sol' }, gallery: [cg('library', 20)] }
const noCgs: CgCharacter = { id: 'nobody', card: { name: 'Nobody' } }

describe('isCgUnlocked', () => {
  it('unlocks an entry a story has explicitly unlocked, regardless of affection', () => {
    expect(isCgUnlocked(cg('festival', 90), new Set(['festival']), 0)).toBe(true)
  })

  it('unlocks a regular CG once affection reaches its threshold', () => {
    expect(isCgUnlocked(cg('rooftop', 60), new Set(), 59)).toBe(false)
    expect(isCgUnlocked(cg('rooftop', 60), new Set(), 60)).toBe(true)
  })

  it('never unlocks an ending by affection, only by id', () => {
    const ending = cg('epilogue', 0, { isEnding: true })
    expect(isCgUnlocked(ending, new Set(), 100)).toBe(false)
    expect(isCgUnlocked(ending, new Set(['epilogue']), 0)).toBe(true)
  })
})

describe('cgProgress', () => {
  const chats: CgChat[] = [
    { characterId: 'mira', playerCharacterId: 'ash', affection: 35, unlockedGalleryIds: ['festival'] },
    { characterId: 'mira', playerCharacterId: 'rin', affection: 65, unlockedGalleryIds: ['epilogue'] },
    { characterId: 'sol', playerCharacterId: 'rin', affection: 10 },
  ]

  it('combines unlocked ids and takes the best affection across every story', () => {
    const summary = cgProgress([mira, sol, noCgs], chats, ALL_PLAYER_CHARACTERS)
    const miraRow = summary.characters.find((row) => row.characterId === 'mira')!
    expect(miraRow.affection).toBe(65)
    expect(miraRow.entries.map((status) => [status.entry.id, status.unlocked])).toEqual([
      ['picnic', true],
      ['rooftop', true],
      ['festival', true],
      ['epilogue', true],
    ])
    expect(miraRow).toMatchObject({ name: 'Mira', unlocked: 4, total: 4 })
  })

  it('leaves out characters with no CGs and totals progress across the rest', () => {
    const summary = cgProgress([mira, sol, noCgs], chats)
    expect(summary.characters.map((row) => row.characterId)).toEqual(['mira', 'sol'])
    expect(summary).toMatchObject({ unlocked: 4, total: 5 })
  })

  it('counts only the selected player character’s stories', () => {
    const ash = cgProgress([mira, sol], chats, 'ash')
    const miraRow = ash.characters[0]
    expect(miraRow.affection).toBe(35)
    expect(miraRow.entries.filter((status) => status.unlocked).map((status) => status.entry.id)).toEqual(['picnic', 'festival'])
    expect(ash.characters[1]).toMatchObject({ characterId: 'sol', affection: 0, unlocked: 0, total: 1 })
    expect(ash).toMatchObject({ unlocked: 2, total: 5 })
  })

  it('shows every CG locked for a player character with no stories yet', () => {
    const none = cgProgress([mira, sol], chats, 'someone-new')
    expect(none).toMatchObject({ unlocked: 0, total: 5 })
    expect(none.characters.every((row) => row.affection === 0)).toBe(true)
  })

  it('returns an empty summary when no character has CGs', () => {
    expect(cgProgress([noCgs], chats)).toEqual({ characters: [], unlocked: 0, total: 0 })
  })

  it('ignores stories with no player card when filtering by one', () => {
    const summary = cgProgress([mira], [{ characterId: 'mira', affection: 90 }], 'ash')
    expect(summary.characters[0].affection).toBe(0)
  })
})

describe('playerCharacterOptions', () => {
  it('lists "you only" cards plus any card a story is played as, by name', () => {
    const cards: CgCharacter[] = [
      { id: 'rin', card: { name: 'Rin' }, playerOnly: true },
      { id: 'mira', card: { name: 'Mira' } },
      { id: 'sol', card: { name: 'Sol' } },
      { id: 'ash', card: { name: 'Ash' }, playerOnly: true },
    ]
    const options = playerCharacterOptions(cards, [{ playerCharacterId: 'sol' }, { playerCharacterId: undefined }])
    expect(options.map((c) => c.id)).toEqual(['ash', 'rin', 'sol'])
  })
})

describe('viewableCgs and lockedCgLabel', () => {
  it('steps only through unlocked CGs that have art', () => {
    const character: CgCharacter = { id: 'x', card: { name: 'X' }, gallery: [cg('a', 0), cg('b', 0, { imageUrl: '' }), cg('c', 99)] }
    const [row] = cgProgress([character], [{ characterId: 'x', playerCharacterId: 'p', affection: 10 }]).characters
    expect(viewableCgs(row).map((entry) => entry.id)).toEqual(['a'])
  })

  it('describes how a locked CG unlocks', () => {
    expect(lockedCgLabel(cg('a', 40))).toBe('Unlocks at 40 warmth')
    expect(lockedCgLabel(cg('b', 0, { isEnding: true }))).toBe('Reach Sweethearts')
  })
})
