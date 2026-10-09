import { expect, it } from 'vitest'
import { savedRecallReasons } from './savedReasons'
it('bounds saved diagnostics while leaving ranking and Inspector reasons intact', () => {
  const strings = Array.from({ length: 12 }, (_, i) => `${i}`.repeat(90))
  const reasons = { pinned: false, openThread: false, aboutPresent: strings, matchedWords: strings, linkedThrough: strings, linkedWeights: Object.fromEntries(strings.map((s) => [s, 1])), recent: true, important: false, score: 1 }
  const saved = savedRecallReasons(reasons)
  for (const list of [saved.aboutPresent, saved.matchedWords, saved.linkedThrough!]) {
    expect(list).toHaveLength(10)
    expect(list.every((s) => s.length <= 80)).toBe(true)
  }
  expect(Object.keys(saved.linkedWeights!)).toHaveLength(10)
  expect(reasons.matchedWords).toHaveLength(12)
  expect(reasons.matchedWords[0].length).toBe(90)
})

it('bounds reasons in the recall client request without changing the supplied reasons', async () => {
  const { vi } = await import('vitest')
  const { memoriesApi } = await import('../api/client')
  const reasons = { pinned: false, openThread: false, aboutPresent: [], matchedWords: Array(12).fill('quay'), recent: true, important: false, score: 1 }
  const fetchMock = vi.fn(async () => ({ ok: true, status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  try {
    await memoriesApi.recordRecalls('synthetic-scene', 'synthetic-character', 'synthetic-reply', ['synthetic-memory'], 0, { 'synthetic-memory': reasons })
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.reasons['synthetic-memory'].matchedWords).toHaveLength(10)
    expect(reasons.matchedWords).toHaveLength(12)
  } finally { vi.unstubAllGlobals() }
})
