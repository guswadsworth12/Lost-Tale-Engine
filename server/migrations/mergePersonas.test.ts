import { describe, expect, it } from 'vitest'
import { isEmptyPlan, planPersonaMerge } from './mergePersonas.ts'

const card = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, card: { name, description: `${name} card` }, ...extra })
const ids = () => {
  let n = 0
  return () => `new-${++n}`
}

describe('planPersonaMerge', () => {
  it('folds a linked persona into its character and keeps its own blurb as the player description', () => {
    const plan = planPersonaMerge(
      [{ id: 'p1', name: 'Ash', description: 'A courier others know by sight.', characterId: 'c1' }],
      [card('c1', 'Ash')],
      [{ id: 's1', personaId: 'p1' }],
      ids(),
      1000,
    )
    expect(plan.newCharacters).toEqual([])
    expect(plan.characterPatches).toEqual([{ id: 'c1', patch: { playerDescription: 'A courier others know by sight.' } }])
    expect(plan.chatPatches).toEqual([{ id: 's1', patch: { playerCharacterId: 'c1' } }])
    expect(plan.personaPatches).toEqual([{ id: 'p1', patch: { migratedToCharacterId: 'c1' } }])
  })

  it('never overwrites a player description the card already has, or copies the card description', () => {
    const plan = planPersonaMerge(
      [
        { id: 'p1', name: 'A', description: 'Different', characterId: 'c1' },
        { id: 'p2', name: 'B', description: 'B card', characterId: 'c2' },
      ],
      [card('c1', 'A', { playerDescription: 'Kept' }), card('c2', 'B')],
      [],
      ids(),
      1000,
    )
    expect(plan.characterPatches).toEqual([])
  })

  it('joins a standalone persona to the one card with the same name instead of duplicating it', () => {
    const plan = planPersonaMerge([{ id: 'p1', name: '  ash  vale ', description: '' }], [card('c1', 'Ash Vale')], [], ids(), 1000)
    expect(plan.newCharacters).toEqual([])
    expect(plan.personaPatches[0].patch.migratedToCharacterId).toBe('c1')
  })

  it('makes a "you only" card when a standalone persona has no unique name match', () => {
    const plan = planPersonaMerge(
      [{ id: 'p1', name: 'Kai', description: 'A second-year.', avatarDataUrl: '/avatars/personas/0a1b-2c.png?t=5', createdAt: 42 }],
      [card('c1', 'Sumire'), card('c2', 'Kai'), card('c3', 'kai')],
      [{ id: 's1', personaId: 'p1' }],
      ids(),
      1000,
    )
    expect(plan.newCharacters).toHaveLength(1)
    expect(plan.newCharacters[0]).toMatchObject({ id: 'new-1', playerOnly: true, gmEligible: false, createdAt: 42, card: { name: 'Kai', description: 'A second-year.' } })
    expect(plan.avatarCopies).toEqual([{ characterId: 'new-1', from: 'personas/0a1b-2c.png' }])
    expect(plan.chatPatches).toEqual([{ id: 's1', patch: { playerCharacterId: 'new-1' } }])
  })

  it('treats a persona whose linked character was deleted as standalone', () => {
    const plan = planPersonaMerge([{ id: 'p1', name: 'Ghost', description: '', characterId: 'gone' }], [], [], ids(), 1000)
    expect(plan.newCharacters[0]).toMatchObject({ card: { name: 'Ghost' }, playerOnly: true })
  })

  it('is a no-op once everything is folded, and never touches a story that already has a player', () => {
    const plan = planPersonaMerge(
      [{ id: 'p1', name: 'Kai', migratedToCharacterId: 'c9' }],
      [card('c9', 'Kai', { playerOnly: true })],
      [
        { id: 's1', personaId: 'p1', playerCharacterId: 'c9' },
        { id: 's2', personaId: 'p1', playerCharacterId: 'other' },
      ],
      ids(),
      1000,
    )
    expect(isEmptyPlan(plan)).toBe(true)
  })

  it('maps a story left behind by an earlier run', () => {
    const plan = planPersonaMerge([{ id: 'p1', name: 'Kai', migratedToCharacterId: 'c9' }], [card('c9', 'Kai')], [{ id: 's1', personaId: 'p1' }], ids(), 1000)
    expect(plan.personaPatches).toEqual([])
    expect(plan.chatPatches).toEqual([{ id: 's1', patch: { playerCharacterId: 'c9' } }])
  })

  it('leaves stories without a persona alone', () => {
    const plan = planPersonaMerge([], [], [{ id: 's1', personaId: '' }, { id: 's2' }], ids(), 1000)
    expect(isEmptyPlan(plan)).toBe(true)
  })
})
