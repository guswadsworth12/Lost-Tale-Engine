import { describe, expect, it } from 'vitest'
import type { CharacterUpdateDraft } from '@/lib/assistant/thread'
import {
  applyEdits,
  draftHasChanges,
  editsAreValid,
  initialEdits,
  parseStatInput,
} from './CharacterUpdateCard'

const draft: CharacterUpdateDraft = {
  characterId: 'c1',
  characterName: 'Ash',
  worldId: 'w1',
  worldName: 'Hollow Coast',
  stats: [
    { id: 'hot', name: 'Hot', before: 1, after: 2, reason: 'Charming' },
    { id: 'cold', name: 'Cold', after: -1 },
  ],
  fields: [{ key: 'goals', label: 'Goals', before: 'Find the lighthouse', after: 'Find the lighthouse\nKeep Mara safe' }],
  summary: 'A PbtA sheet for Ash.',
}

describe('parseStatInput', () => {
  it('accepts whole numbers, including negatives', () => {
    expect(parseStatInput('3')).toBe(3)
    expect(parseStatInput(' -2 ')).toBe(-2)
    expect(parseStatInput('0')).toBe(0)
  })
  it('rejects partial or non-integer input', () => {
    expect(parseStatInput('')).toBeNull()
    expect(parseStatInput('-')).toBeNull()
    expect(parseStatInput('1.5')).toBeNull()
    expect(parseStatInput('abc')).toBeNull()
  })
})

describe('edits', () => {
  it('round-trips the proposal unchanged', () => {
    const edits = initialEdits(draft)
    expect(editsAreValid(draft, edits)).toBe(true)
    expect(applyEdits(draft, edits)).toEqual(draft)
  })

  it('writes edited values into `after` and keeps the rest of the draft', () => {
    const edits = initialEdits(draft)
    edits.stats.hot = '-3'
    edits.fields.goals = 'Sleep'
    const out = applyEdits(draft, edits)
    expect(out.stats?.[0]).toEqual({ id: 'hot', name: 'Hot', before: 1, after: -3, reason: 'Charming' })
    expect(out.fields?.[0].after).toBe('Sleep')
    expect(out.characterId).toBe('c1')
    expect(draft.stats?.[0].after).toBe(2)
  })

  it('flags a half-typed stat as invalid', () => {
    const edits = initialEdits(draft)
    edits.stats.cold = '-'
    expect(editsAreValid(draft, edits)).toBe(false)
  })
})

describe('draftHasChanges', () => {
  it('is false when every value matches what is saved', () => {
    expect(
      draftHasChanges({
        ...draft,
        stats: [{ id: 'hot', name: 'Hot', before: 1, after: 1 }],
        fields: [{ key: 'likes', label: 'Likes', before: 'tea', after: 'tea' }],
      }),
    ).toBe(false)
  })
  it('counts a stat with no saved value as a change', () => {
    expect(draftHasChanges({ ...draft, stats: [{ id: 'x', name: 'X', after: 0 }], fields: [] })).toBe(true)
  })
  it('counts an edited field as a change', () => {
    expect(draftHasChanges({ ...draft, stats: [], fields: [{ key: 'likes', label: 'Likes', before: '', after: 'tea' }] })).toBe(true)
  })
})
