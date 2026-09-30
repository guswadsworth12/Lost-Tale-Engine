import { describe, expect, it } from 'vitest'
import { revertRevision } from '@/lib/world/revisions'
import { GM_STYLE_GUIDANCE } from '@/lib/world/gm'
import { SCRIBE_GUIDANCE } from '@/lib/memory/scribe'
import { previewPrompt, sampleFrom, STAND_IN_SAMPLE, targetHistory, targetLabel, targetText, tuningPatch, type TuningTarget } from './tuning'

const item = (id: string, content: string) => ({ id, name: `Item ${id}`, content, role: 'system' as const, enabled: true })
const world = { name: 'Harbor', description: 'A fishing town.', gmNotes: 'The lighthouse is empty.', promptItems: [item('w1', 'Keep it grounded.')] }
const bea = { id: 'bea', card: { name: 'Bea' }, promptItems: [item('c1', 'Speaks softly.')] }
const ids = () => {
  let n = 0
  return () => `r${++n}`
}

describe('tuning targets', () => {
  it('read what each target says now, engine defaults included', () => {
    expect(targetText({ kind: 'engine', id: 'scribe' }, world)).toBe(SCRIBE_GUIDANCE)
    expect(targetText({ kind: 'engine', id: 'scribe' }, { ...world, promptOverrides: { scribe: 'Only promises.' } })).toBe('Only promises.')
    expect(targetText({ kind: 'gmNotes' }, world)).toBe('The lighthouse is empty.')
    expect(targetText({ kind: 'worldItem', itemId: 'w1' }, world)).toBe('Keep it grounded.')
    expect(targetText({ kind: 'characterItem', characterId: 'bea', itemId: 'c1' }, world, bea)).toBe('Speaks softly.')
    expect(targetLabel({ kind: 'characterItem', characterId: 'bea', itemId: 'c1' }, world, bea)).toBe('Bea: Item c1')
  })

  it('save an engine prompt as an override, and drop it when set back to the default', () => {
    const target: TuningTarget = { kind: 'engine', id: 'gm-style' }
    const tuned = tuningPatch(target, world, undefined, ' End every scene on a question. ', 5, ids())
    expect(tuned.promptOverrides).toEqual({ 'gm-style': 'End every scene on a question.' })
    const next = { ...world, ...tuned } as typeof world & { revisions: never[] }
    expect(targetHistory(target, next)).toMatchObject([{ label: 'Tuned Game Master style' }])
    expect(tuningPatch(target, next, undefined, GM_STYLE_GUIDANCE, 6, ids()).promptOverrides).toEqual({})
    expect(tuningPatch(target, next, undefined, '  ', 6, ids()).revisions).toMatchObject([{ label: 'Reset Game Master style to the engine default' }, {}])
  })

  it('edit one prompt item on the record that holds it, and revert it from that record\'s history', () => {
    const target: TuningTarget = { kind: 'characterItem', characterId: 'bea', itemId: 'c1' }
    const patch = tuningPatch(target, world, bea, 'Speaks in clipped lines.', 5, ids())
    expect(patch.promptItems).toEqual([item('c1', 'Speaks in clipped lines.')])
    const edited = { ...bea, ...patch } as typeof bea & { revisions: never[] }
    expect(targetHistory(target, world, edited)).toHaveLength(1)
    expect(revertRevision(edited, 'r1', 6, () => 'r2').promptItems).toEqual([item('c1', 'Speaks softly.')])
    expect(() => tuningPatch(target, world, undefined, 'x', 1, ids())).toThrow(/no longer in your library/)
  })
})

describe('previewing a change on a sample turn', () => {
  it('builds the prompt the model would receive, with the edit in place', () => {
    const gm = previewPrompt({ kind: 'engine', id: 'gm-style' }, world, undefined, 'End every scene on a question.')
    expect(gm).toContain('End every scene on a question.')
    expect(gm).toContain('Never write a carded character’s dialogue')
    expect(gm).toContain('I set the lantern on the table')
    expect(previewPrompt({ kind: 'gmNotes' }, world, undefined, 'The keeper is alive.')).toContain('Storyteller-only continuity (do not disclose without an in-story cause): The keeper is alive.')
    expect(previewPrompt({ kind: 'engine', id: 'scribe' }, world, undefined, 'Only promises.')).toContain('Only promises.')
    expect(previewPrompt({ kind: 'engine', id: 'scene-recap' }, world, undefined, 'Two lines.')).toContain('recap of this scene. Two lines.')
    expect(previewPrompt({ kind: 'engine', id: 'chapter-recap' }, world, undefined, 'One paragraph.')).toContain('whole chapter. One paragraph.')
    expect(previewPrompt({ kind: 'engine', id: 'journal' }, world, undefined, 'As {name} would.')).toContain('As Bea would.')
    expect(previewPrompt({ kind: 'worldItem', itemId: 'w1' }, world, undefined, 'Keep it bleak.')).toBe('Keep it bleak.')
  })

  it('uses the world\'s latest scene when there is one', () => {
    const sample = sampleFrom([
      { role: 'user', text: 'Where were you last night?' },
      { role: 'char', name: 'Bea', text: 'Out on the water.' },
      { role: 'char', name: 'Game Master', text: 'The tide turns.' },
      { role: 'char', name: 'Cole', text: '', failed: true },
    ], 'Wren')
    expect(sample).toEqual({ playerName: 'Wren', castNames: ['Bea'], lines: [
      { speaker: 'Wren', text: 'Where were you last night?', isPlayer: true },
      { speaker: 'Bea', text: 'Out on the water.', isPlayer: false },
      { speaker: 'Game Master', text: 'The tide turns.', isPlayer: false },
    ] })
    expect(sampleFrom([], 'Wren')).toBeUndefined()
    expect(previewPrompt({ kind: 'engine', id: 'scribe' }, world, undefined, 'x', sample!)).toContain('Out on the water.')
    expect(STAND_IN_SAMPLE.castNames.length).toBeGreaterThan(0)
  })
})
