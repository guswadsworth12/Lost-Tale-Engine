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
