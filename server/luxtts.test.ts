import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('./db.ts', () => ({ dataDir: '/tmp/lost-tales-luxtts-test' }))

import { luxttsSpeak } from './luxtts'

beforeEach(() => vi.stubEnv('LUXTTS_URL', 'http://voice.test'))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('cancels the upstream LuxTTS request when playback is stopped', async () => {
  const controller = new AbortController()
  let upstreamSignal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    upstreamSignal = init.signal ?? undefined
    return new Promise((_resolve, reject) => {
      upstreamSignal?.addEventListener('abort', () => reject(upstreamSignal?.reason), { once: true })
    })
  }))
  const pending = luxttsSpeak({ text: 'Hello.' }, controller.signal)
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(upstreamSignal?.aborted).toBe(true)
})

it('reports a synthesis timeout as a clear gateway error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError')))
  await expect(luxttsSpeak({ text: 'Hello.' })).rejects.toMatchObject({
    message: 'LuxTTS timed out generating this line. Try it again.',
    status: 504,
  })
})
