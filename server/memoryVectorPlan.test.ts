import { describe, expect, it, vi } from 'vitest'
import fixtures from './memoryEval/fixtures/cases.json'
import { parseCase } from './memoryEval/bench'
import { memorySimilarities, memoryTextHash } from './memoryVectorPlan'
import { normalizeVector, cosine } from '../src/lib/memory/vector'

describe('filtered vector scoring', () => {
  it('normalizes scale and rejects zero, non-finite and dimension mismatches', () => {
    expect(cosine(normalizeVector([3, 4]), normalizeVector([6, 8]))).toBeCloseTo(1)
    expect(cosine(normalizeVector([3, 4]), normalizeVector([-4, 3]))).toBeCloseTo(0)
    expect(() => normalizeVector([0, 0])).toThrow()
    expect(() => normalizeVector([Infinity])).toThrow()
    expect(() => normalizeVector(Array(16385).fill(1))).toThrow()
    expect(() => cosine(normalizeVector([1]), normalizeVector([1, 0]))).toThrow()
  })
  it('never looks up or scores a forbidden candidate in any protected knowledge/branch case', () => {
    for (const c of fixtures.map(parseCase).filter((v) => v.mustNeverRegress)) {
      const get = vi.fn((id: string) => ({ model: 'stub', textHash: memoryTextHash('stub', c.memories.find((m) => m.id === id)!.text), vector: normalizeVector([1, 0]) }))
      const chain = new Set([c.scene.chatId])
      memorySimilarities(c.memories, chain, c.scene.speakerId, 'stub', normalizeVector([1, 0]), get)
      for (const id of c.forbiddenIds) expect(get.mock.calls.flat(), c.id).not.toContain(id)
    }
  })
  it('skips stale hashes/models and wrong dimensions before cosine', () => {
    const c = parseCase(fixtures[0])
    const m = c.memories[0]
    const run = (model: string, textHash: string, vector: Float32Array) => memorySimilarities([m], new Set([m.chatId]), c.scene.speakerId, 'stub', normalizeVector([1, 0]), () => ({ model, textHash, vector }))
    expect(run('other', memoryTextHash('stub', m.text), normalizeVector([1, 0]))).toEqual({})
    expect(run('stub', memoryTextHash('stub', m.text + ' changed'), normalizeVector([1, 0]))).toEqual({})
    expect(run('stub', memoryTextHash('stub', m.text), normalizeVector([1]))).toEqual({})
  })
})
