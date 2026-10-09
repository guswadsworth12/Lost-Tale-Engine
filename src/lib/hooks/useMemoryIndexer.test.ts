import type { StateCreator } from 'zustand/vanilla'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  effect: undefined as undefined | (() => void | (() => void)),
  listener: undefined as undefined | (() => void),
  connection: { model: 'synthetic', key: 'local|synthetic', embed: vi.fn(async (_texts: string[], _signal?: AbortSignal) => [[1, 0]]) },
  dims: undefined as number | undefined,
  missing: vi.fn(async (_chat: string, _model: string, _signal?: AbortSignal, _dims?: number) => ({ total: 0, missing: [] as { memoryId: string; text: string; textHash: string }[] })),
  put: vi.fn(async () => {}),
}))
// Run the effect lifecycle directly in Node; no DOM or provider calls are needed.
vi.mock('zustand', async () => {
  const { createStore } = await import('zustand/vanilla')
  return { create: (initializer: StateCreator<unknown>) => {
    const store = createStore(initializer)
    return Object.assign((select: (state: unknown) => unknown) => select(store.getState()), store)
  } }
})
vi.mock('react', async (original) => ({ ...(await original<typeof import('react')>()),
  useEffect: (effect: () => void | (() => void)) => { harness.effect = effect },
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }),
  useDebugValue: () => {},
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))
vi.mock('@/lib/store/useSettingsStore', () => ({ useSettingsStore: (select: (state: unknown) => unknown) => select({ services: [], embeddingModel: null }) }))
vi.mock('@/lib/accounts/secrets', () => ({ useSecretStatus: () => ({ saved: {} }) }))
vi.mock('@/lib/accounts/useAuthStore', () => ({ useAuthStore: (select: (state: unknown) => unknown) => select({ user: { id: 'owner' } }) }))
vi.mock('@/lib/api/embeddings', () => ({ embeddingConnection: () => harness.connection,
  useEmbeddingDimensions: Object.assign((select: (state: unknown) => unknown) => select({ byConnection: { [harness.connection.key]: harness.dims } }), {
    setState: (update: (state: { byConnection: Record<string, number | undefined> }) => { byConnection: Record<string, number | undefined> }) => {
      harness.dims = update({ byConnection: { [harness.connection.key]: harness.dims } }).byConnection[harness.connection.key]
    },
  }),
}))
vi.mock('@/lib/api/client', () => ({ memoryVectorsApi: { missing: harness.missing, put: harness.put },
  subscribe: (_resource: string, listener: () => void) => { harness.listener = listener; return () => { harness.listener = undefined } },
}))
import { useMemoryIndexer, useMemoryIndexProgress } from './useMemoryIndexer'
let cleanup: void | (() => void)
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
const open = async (scene = 'scene', generating = false) => {
  cleanup?.()
  useMemoryIndexer(scene, true, generating)
  cleanup = harness.effect?.()
  await flush()
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  harness.connection.key = 'local|synthetic'
  harness.dims = undefined
  harness.missing.mockResolvedValue({ total: 0, missing: [] })
  useMemoryIndexProgress.setState({ context: '', cancelled: false, indexed: 0, remaining: 0, status: '' })
})
afterEach(() => { cleanup?.(); cleanup = undefined; vi.useRealTimers() })
it('waits five minutes after completion, but checks immediately when memories change', async () => {
  await open()
  expect(harness.missing).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(harness.missing).toHaveBeenCalledTimes(1)
  harness.listener?.()
  await flush()
  expect(harness.missing).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(300_000)
  expect(harness.missing).toHaveBeenCalledTimes(3)
})
it('keeps cancellation within a scene/model and resumes on scene or model changes', async () => {
  await open()
  useMemoryIndexProgress.getState().cancel()
  await open()
  expect(harness.missing).toHaveBeenCalledTimes(1)
  await open('other-scene')
  expect(useMemoryIndexProgress.getState().cancelled).toBe(false)
  expect(harness.missing).toHaveBeenCalledTimes(2)
  useMemoryIndexProgress.getState().cancel()
  harness.connection.key = 'local|other-model'
  await open('other-scene')
  expect(useMemoryIndexProgress.getState().cancelled).toBe(false)
  expect(harness.missing).toHaveBeenCalledTimes(3)
})
it('checks observed dimensions after a query, and waits while generating', async () => {
  await open()
  harness.dims = 3
  await open('scene', true)
  expect(harness.missing).toHaveBeenCalledTimes(1)
  await open()
  expect(harness.missing.mock.calls[harness.missing.mock.calls.length - 1]?.[3]).toBe(3)
})

it('updates the observed dimensions after a background provider changes size', async () => {
  harness.dims = 3
  harness.missing.mockResolvedValueOnce({ total: 1, missing: [{ memoryId: 'memory', text: 'A crossing.', textHash: 'synthetic' }] })
  await open()
  expect(harness.put).toHaveBeenCalledTimes(1)
  expect(harness.dims).toBe(2)
})
