import { describe, expect, it } from 'vitest'
import type { CharacterMemory } from '../types'
import { DEEP_MEMORY_WEIGHTS, selectMemoriesExplained } from './rank'

const memory = (over: Partial<CharacterMemory> = {}): CharacterMemory => ({
  id: 'memory', chatId: 'scene', text: 'Brisa crossed the flooded road.', kind: 'event',
  witnesses: ['brisa'], knownBy: ['brisa'], importance: 0.5, active: true, origin: 'manual', createdAt: 1, ...over,
})
const base = { characterId: 'brisa', presentIds: [], recentText: '' }
const now = 1_000_000_000
const score = (m: CharacterMemory, deep?: Parameters<typeof selectMemoriesExplained>[1]['deep']) => selectMemoriesExplained([m], { ...base, deep })[0]

describe('Deep Memory ranking', () => {
  it('uses only this speaker’s feeling strength, of either sign, when enabled', () => {
    const neutral = score(memory(), { now })
    for (const feeling of [-1, 1]) {
      const m = memory({ feelings: { brisa: feeling, tavi: 0.1 } })
      expect(score(m).reasons.score).toBe(score(memory()).reasons.score)
      expect(score(m, { now }).reasons.score - neutral.reasons.score).toBeCloseTo(DEEP_MEMORY_WEIGHTS.feeling)
      expect(score(m, { now }).reasons.strongFeeling).toBe(true)
    }
    expect(score(memory({ feelings: { tavi: 1 } }), { now }).reasons.strongFeeling).toBe(false)
  })

  it('matches places without case or whitespace differences, but never matches missing places', () => {
    const m = memory({ location: '  Ferry   Landing ' })
    expect(score(m, { now, location: 'ferry landing' }).reasons.samePlace).toBe(true)
    expect(score(m, { now, location: 'FERRY\nLANDING' }).reasons.score - score(m).reasons.score).toBeCloseTo(DEEP_MEMORY_WEIGHTS.place)
    expect(score(m, { now, location: 'orchard' }).reasons.samePlace).toBe(false)
    expect(score(memory(), { now }).reasons.samePlace).toBe(false)
  })

  it('caps logarithmic count strength and halves it after thirty days', () => {
    const recalled = (count: number, lastAt = now) => score(memory(), { now, recalls: new Map([['memory', { count, lastAt }]]) })
    const delta = (count: number, lastAt = now) => recalled(count, lastAt).reasons.score - score(memory()).reasons.score
    expect(delta(10)).toBeCloseTo(DEEP_MEMORY_WEIGHTS.recall)
    expect(delta(1)).toBeGreaterThan(0)
    expect(delta(2) - delta(1)).toBeLessThan(delta(1))
    expect(delta(1000)).toBeCloseTo(delta(10))
    expect(delta(10, now - 30 * 86400_000)).toBeCloseTo(delta(10) / 2)
    expect(recalled(10).reasons.oftenRecalled).toBe(true)
    expect(recalled(0).reasons.oftenRecalled).toBe(false)
    expect(delta(-1)).toBe(0)
    expect(delta(NaN)).toBe(0)
  })

  it('filters knowledge, active state and folding before any new boost', () => {
    const forbidden = memory({ knownBy: ['tavi'], feelings: { brisa: 1 }, location: 'Quay', pinned: true })
    const deep = { now, location: 'Quay', recalls: new Map([['memory', { count: 1000, lastAt: now }]]) }
    for (const m of [forbidden, memory({ active: false }), memory({ consolidatedFor: ['brisa'] })]) {
      expect(selectMemoriesExplained([m], { ...base, deep })).toEqual([])
    }
  })
})


it('boosts similarity only behind deep, with a reason, and preserves Phase 1 when unavailable', () => {
  const memory = { id: 'synthetic', chatId: 'chat', text: 'A river crossing.', active: true, kind: 'event', knownBy: ['brisa'], witnesses: ['brisa'], createdAt: 1, importance: 0.5 } as CharacterMemory
  const base = { characterId: 'brisa', presentIds: [], recentText: '', deep: { now: 1 } }
  const ordinary = selectMemoriesExplained([memory], base)[0]
  const meaning = selectMemoriesExplained([memory], { ...base, deep: { now: 1, similarities: new Map([[memory.id, 0.8]]) } })[0]
  expect(meaning.reasons.score - ordinary.reasons.score).toBeCloseTo(DEEP_MEMORY_WEIGHTS.similarity * ((0.8 - 0.4) / 0.6))
  expect(meaning.reasons.similarMeaning).toBe(true)
  expect(ordinary.reasons).not.toHaveProperty('similarMeaning')
  expect(selectMemoriesExplained([memory], { ...base, deep: { now: 1, similarities: undefined } })).toEqual([ordinary])
})


it('calibrates compressed cosine using only eligible candidates and labels only the strong match', () => {
  const memories = [0.45, 0.48, 0.50, 0.52, 0.70].map((similarity, i) => memory({ id: `candidate-${i}`, createdAt: i, importance: i === 4 ? 0.1 : 1 }))
  const similarities = new Map(memories.map((m, i) => [m.id, [0.45, 0.48, 0.50, 0.52, 0.70][i]]))
  const hidden = memory({ id: 'hidden', knownBy: ['tavi'] })
  similarities.set(hidden.id, 1)
  const picks = selectMemoriesExplained([...memories, hidden], { ...base, deep: { now, similarities } })
  expect(picks[0].memory.id).toBe('candidate-4')
  expect(picks.filter((p) => p.reasons.similarMeaning).map((p) => p.memory.id)).toEqual(['candidate-4'])
  const flat = selectMemoriesExplained(memories, { ...base, deep: { now, similarities: new Map(memories.map((m) => [m.id, 0.6])) } })
  expect(flat.every((p) => !p.reasons.similarMeaning)).toBe(true)
  expect(flat.map((p) => p.reasons.score)).toEqual(selectMemoriesExplained(memories, { ...base, deep: { now } }).map((p) => p.reasons.score))
})
