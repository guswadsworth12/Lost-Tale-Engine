import { describe, expect, it } from 'vitest'
import { MAX_REVISIONS, normalizeWorldRevisions, revertRevision, revisionsOf, withChanges, type WorldRevision } from './revisions'

const ids = () => {
  let n = 0
  return () => `r${++n}`
}

describe('world revisions', () => {
  const oldRules = { ruleset: 'Starter', resolver: 'pbta', moves: [] }
  const newRules = { ruleset: 'Harbor Rules', resolver: 'custom', moves: [] }

  it('records what a change replaced, for every field changed together', () => {
    const world = { campaign: oldRules, modules: { campaignRules: 'guided' } }
    const patch = withChanges(world, [
      { field: 'campaign', value: newRules, label: 'Applied Harbor Rules' },
      { field: 'modules', value: { campaignRules: 'mechanical' }, label: 'Turned on rolls' },
    ], 5, ids())
    expect(patch.campaign).toEqual(newRules)
    expect(patch.modules).toEqual({ campaignRules: 'mechanical' })
    expect(patch.revisions).toEqual([
      { id: 'r1', at: 5, field: 'campaign', before: oldRules, label: 'Applied Harbor Rules' },
      { id: 'r2', at: 5, field: 'modules', before: { campaignRules: 'guided' }, label: 'Turned on rolls' },
    ])
    // The stored copy is its own: changing the world later can't rewrite history.
    oldRules.ruleset = 'changed'
    expect((patch.revisions as WorldRevision[])[0].before).toMatchObject({ ruleset: 'Starter' })
    oldRules.ruleset = 'Starter'
  })

  it('reverts in one step, and the revert can itself be undone', () => {
    const world = { campaign: oldRules }
    const applied = { ...world, ...withChanges(world, [{ field: 'campaign', value: newRules, label: 'Applied Harbor Rules' }], 5, ids()) } as never as Record<string, unknown> & { revisions: WorldRevision[] }
    const reverted = { ...applied, ...revertRevision(applied, 'r1', 9, () => 'r2') } as typeof applied
    expect(reverted.campaign).toEqual(oldRules)
    expect(reverted.revisions[0]).toEqual({ id: 'r2', at: 9, field: 'campaign', before: newRules, label: 'Reverted: Applied Harbor Rules' })
    const redone = { ...reverted, ...revertRevision(reverted, 'r2', 12, () => 'r3') }
    expect(redone.campaign).toEqual(newRules)
    expect(() => revertRevision(applied, 'missing', 1, () => 'x')).toThrow(/no longer in the history/)
  })

  it('keeps one history per prompt, and clears an override back to the default', () => {
    const world = { promptOverrides: { scribe: 'Old scribe text' } }
    const patch = withChanges(world, [{ field: 'promptOverrides', key: 'journal', value: 'Short journals.', label: 'Tuned the journal' }], 1, ids())
    expect(patch.promptOverrides).toEqual({ scribe: 'Old scribe text', journal: 'Short journals.' })
    const next = { ...world, ...patch } as unknown as { promptOverrides: Record<string, string>; revisions: WorldRevision[] }
    expect(revisionsOf(next, 'promptOverrides', 'journal')).toHaveLength(1)
    expect(revisionsOf(next, 'promptOverrides', 'scribe')).toHaveLength(0)
    // The journal had no override before, so reverting returns it to the engine default.
    expect(revertRevision(next, 'r1', 2, () => 'r2').promptOverrides).toEqual({ scribe: 'Old scribe text' })
    expect(() => withChanges(world, [{ field: 'promptOverrides', value: 'x', label: 'x' }], 1, ids())).toThrow(/needs a key/)
  })

  it('keeps the newest revisions when the history is full', () => {
    const full = { campaign: oldRules, revisions: Array.from({ length: MAX_REVISIONS }, (_, i) => ({ id: `old${i}`, at: i, field: 'campaign' as const, label: 'x' })) }
    const patch = withChanges(full, [{ field: 'campaign', value: newRules, label: 'Newest' }], 99, ids())
    const kept = patch.revisions as WorldRevision[]
    expect(kept).toHaveLength(MAX_REVISIONS)
    expect(kept[0].label).toBe('Newest')
    expect(kept[kept.length - 1].id).toBe(`old${MAX_REVISIONS - 2}`)
  })

  it('accepts only known shapes from a request', () => {
    expect(normalizeWorldRevisions([
      { id: 'a', at: 1, field: 'campaign', before: { x: 1 }, label: ' Applied ' },
      { id: 'b', at: 1, field: 'lorebook', label: 'Unknown field' },
      { id: 'c', at: 1, field: 'promptOverrides', label: 'No key' },
      { id: 'd', at: 'soon', field: 'campaign', label: 'Bad time' },
      'junk',
    ])).toEqual([{ id: 'a', at: 1, field: 'campaign', before: { x: 1 }, label: 'Applied' }])
    expect(normalizeWorldRevisions('nope')).toBeUndefined()
  })
})
