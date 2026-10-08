import { describe, expect, it, vi } from 'vitest'
import { MeaningRecall } from './meaningRecall'
import { indexMemoryBatch, type VectorUpload } from './indexing'

const connection = () => ({ model: 'synthetic', key: 'local|synthetic', embed: vi.fn(async (_texts: string[], _signal?: AbortSignal) => [[1, 0]]) })
describe('optional meaning recall', () => {
  it('makes no embedding or score calls with the module off, no model, or no context', async () => {
    const c = connection()
    const score = vi.fn(async () => ({ memory: 1 }))
    const recall = new MeaningRecall()
    await recall.recall(false, c, 'A crossing.', score)
    await recall.recall(true, undefined, 'A crossing.', score)
    await recall.recall(true, c, '', score)
    expect(c.embed).not.toHaveBeenCalled()
    expect(score).not.toHaveBeenCalled()
  })
  it('shares an in-flight/cached query across retries and Inspector, but changes with text/model/service', async () => {
    const c = connection()
    const score = vi.fn(async () => ({ memory: 0.9 }))
    const recall = new MeaningRecall()
    const results = await Promise.all([recall.recall(true, c, 'A crossing.', score), recall.recall(true, c, 'A crossing.', score)])
    expect(c.embed).toHaveBeenCalledTimes(1)
    expect(results[0].similarities?.get('memory')).toBe(0.9)
    await recall.recall(true, c, 'A crossing.', score)
    expect(c.embed).toHaveBeenCalledTimes(1)
    await recall.recall(true, c, 'A different crossing.', score)
    await recall.recall(true, { ...c, model: 'other', key: 'local|other' }, 'A crossing.', score)
    await recall.recall(true, { ...c, key: 'other-service|synthetic' }, 'A crossing.', score)
    expect(c.embed).toHaveBeenCalledTimes(4)
    recall.clear()
    await recall.recall(true, c, 'A crossing.', score)
    expect(c.embed).toHaveBeenCalledTimes(5)
  })
  it('falls back for empty indices/failed calls and backs off a failed embedding query', async () => {
    const c = connection()
    const recall = new MeaningRecall()
    expect((await recall.recall(true, c, 'A crossing.', async () => ({}))).skipped).toMatch(/No current indexed/)
    expect((await recall.recall(true, c, 'A crossing.', async () => { throw new Error('synthetic') })).skipped).toMatch(/Ordinary recall/)
    c.embed.mockRejectedValue(new Error('synthetic'))
    await recall.recall(true, c, 'A storm.', async () => ({}))
    await recall.recall(true, c, 'A storm.', async () => ({}))
    expect(c.embed).toHaveBeenCalledTimes(2)
  })
})

describe('background indexing steps', () => {
  it('never calls the embedder while disabled, missing a model, paused or cancelled', async () => {
    const c = connection()
    const missing = vi.fn(async () => ({ total: 1, missing: [{ memoryId: 'memory', text: 'A crossing.', textHash: 'synthetic' }] }))
    const put = vi.fn(async (_rows: VectorUpload[]) => {})
    const signal = new AbortController().signal
    for (const [enabled, model, paused] of [[false, c, false], [true, undefined, false], [true, c, true]] as const) await indexMemoryBatch(enabled, model, signal, () => paused, missing, put)
    await indexMemoryBatch(true, c, AbortSignal.abort(), () => false, missing, put)
    expect(c.embed).not.toHaveBeenCalled()
    expect(missing).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })
  it('batches 32 texts and stops before embedding when a reply begins after loading the queue', async () => {
    const c = connection()
    c.embed.mockImplementation(async (texts: string[]) => texts.map(() => [1, 0]))
    const rows = Array.from({ length: 40 }, (_, i) => ({ memoryId: `synthetic-${i}`, text: 'A crossing.', textHash: 'synthetic' }))
    const missing = async () => ({ total: 40, missing: rows })
    const put = vi.fn(async (_rows: VectorUpload[]) => {})
    const signal = new AbortController().signal
    expect(await indexMemoryBatch(true, c, signal, () => false, missing, put)).toEqual({ indexed: 32, remaining: 8 })
    expect(c.embed.mock.calls[0][0]).toHaveLength(32)
    expect(put.mock.calls[0][0]).toHaveLength(32)
    let paused = false
    await indexMemoryBatch(true, c, signal, () => paused, async () => { paused = true; return { total: 40, missing: rows } }, put)
    expect(c.embed).toHaveBeenCalledTimes(1)
  })
  it('does not upload an embedding completed after cancellation and leaves failures retryable', async () => {
    const c = connection()
    const controller = new AbortController()
    const missing = async () => ({ total: 1, missing: [{ memoryId: 'synthetic', text: 'A crossing.', textHash: 'synthetic' }] })
    const put = vi.fn(async (_rows: VectorUpload[]) => {})
    c.embed.mockImplementation(async () => { controller.abort(); return [[1, 0]] })
    await indexMemoryBatch(true, c, controller.signal, () => false, missing, put)
    expect(put).not.toHaveBeenCalled()
    c.embed.mockRejectedValueOnce(new Error('synthetic'))
    await expect(indexMemoryBatch(true, c, new AbortController().signal, () => false, missing, put)).rejects.toThrow('synthetic')
  })
})


it('falls back within 2.5 seconds when embedding ignores cancellation, and caches the failure', async () => {
  const c = connection()
  c.embed.mockImplementation(() => new Promise(() => {}))
  const score = vi.fn(async () => ({ memory: 1 }))
  const recall = new MeaningRecall()
  const started = performance.now()
  expect((await recall.recall(true, c, 'A slow crossing.', score)).skipped).toMatch(/Ordinary recall/)
  expect(performance.now() - started).toBeLessThan(2900)
  expect(c.embed.mock.calls[0][1]?.aborted).toBe(true)
  await recall.recall(true, c, 'A slow crossing.', score)
  expect(c.embed).toHaveBeenCalledTimes(1)
  expect(score).not.toHaveBeenCalled()
})
it('bounds scoring within the same reply deadline', async () => {
  const started = performance.now()
  const result = await new MeaningRecall().recall(true, connection(), 'A crossing.', () => new Promise(() => {}))
  expect(result.skipped).toMatch(/Ordinary recall/)
  expect(performance.now() - started).toBeLessThan(2900)
})


it('refreshes a cached query after Test it observes new dimensions under the same model name', async () => {
  const c = connection()
  let dims = 2
  const observed = { ...c, dimensions: () => dims }
  const recall = new MeaningRecall()
  const score = vi.fn(async () => ({ memory: 1 }))
  await recall.recall(true, observed, 'A crossing.', score)
  dims = 3
  c.embed.mockResolvedValue([[1, 0, 0]])
  await recall.recall(true, observed, 'A crossing.', score)
  expect(c.embed).toHaveBeenCalledTimes(2)
  expect(score).toHaveBeenLastCalledWith('synthetic', [1, 0, 0], expect.any(AbortSignal))
})
