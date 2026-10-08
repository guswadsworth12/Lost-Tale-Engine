import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { useAuthStore } from '@/lib/accounts/useAuthStore'
import { embeddingConnection, useEmbeddingDimensions } from '@/lib/api/embeddings'
import { memoryVectorsApi, subscribe } from '@/lib/api/client'
import { indexMemoryBatch } from '@/lib/memory/indexing'

export const useMemoryIndexProgress = create<{
  context: string; chatId: string; indexed: number; remaining: number; status: string; cancelled: boolean
  cancel: () => void; resume: () => void
}>((set) => ({ context: '', chatId: '', indexed: 0, remaining: 0, status: '', cancelled: false,
  cancel: () => set({ cancelled: true, status: 'Indexing cancelled.' }),
  resume: () => set({ cancelled: false }),
}))

/** Index only the open scene, while idle. Missing/edited/model-changed memories share this loop. */
export function useMemoryIndexer(chatId: string | null, enabled: boolean, generating: boolean) {
  const services = useSettingsStore((s) => s.services)
  const embeddingModel = useSettingsStore((s) => s.embeddingModel)
  const { saved: secrets } = useSecretStatus()
  const userId = useAuthStore((s) => s.user?.id)
  const cancelled = useMemoryIndexProgress((s) => s.cancelled)
  const connection = useMemo(() => embeddingConnection({ services, embeddingModel }, secrets, false), [services, embeddingModel, secrets])
  const dims = useEmbeddingDimensions((s) => connection ? s.byConnection[connection.key] : undefined)
  useEffect(() => {
    const context = `${userId ?? ''}|${chatId ?? ''}|${connection?.key ?? ''}`
    const previous = useMemoryIndexProgress.getState()
    if (previous.context !== context) {
      useMemoryIndexProgress.setState({ context, chatId: chatId ?? '', indexed: 0, remaining: 0, cancelled: false, status: '' })
    }
    if (!chatId || !enabled || !connection) { useMemoryIndexProgress.setState({ status: '', chatId: '' }); return }
    if (previous.context === context && cancelled) { useMemoryIndexProgress.setState({ status: 'Indexing cancelled.' }); return }
    if (generating) { useMemoryIndexProgress.setState({ status: 'Indexing paused during the reply.' }); return }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let indexed = previous.context === context ? previous.indexed : 0
    let failures = 0
    let running = false
    let dirty = false
    useMemoryIndexProgress.setState({ context, chatId, indexed, remaining: previous.context === context ? previous.remaining : 0, status: 'Checking memories…' })
    const step = async () => {
      running = true
      dirty = false
      let delay = 1500
      try {
        const result = await indexMemoryBatch(enabled, connection, controller.signal,
          () => useMemoryIndexProgress.getState().cancelled,
          () => memoryVectorsApi.missing(chatId, connection.model, controller.signal, dims),
          async (rows) => {
            await memoryVectorsApi.put(rows, controller.signal)
            // A provider can change dimensions while this idle batch is running.
            const actual = rows[0]?.dims
            if (!controller.signal.aborted && dims !== undefined && actual && actual !== dims) {
              useEmbeddingDimensions.setState((s) => ({ byConnection: { ...s.byConnection, [connection.key]: actual } }))
            }
          })
        if (controller.signal.aborted || !result) return
        failures = 0
        indexed += result.indexed
        useMemoryIndexProgress.setState({ indexed, remaining: result.remaining,
          status: result.remaining ? 'Preparing recall by meaning…' : 'Recall by meaning is ready.' })
        if (!result.remaining) delay = 5 * 60_000
      } catch {
        if (controller.signal.aborted) return
        delay = Math.min(60_000, 2000 * 2 ** ++failures)
        useMemoryIndexProgress.setState({ status: 'Indexing will retry later. Ordinary recall is available.' })
      }
      running = false
      timer = setTimeout(step, dirty ? 1500 : delay)
    }
    const unsubscribe = subscribe('memories', () => {
      dirty = true
      if (!running) { clearTimeout(timer); void step() }
    })
    void step()
    return () => { controller.abort(); clearTimeout(timer); unsubscribe() }
  }, [chatId, enabled, connection, generating, cancelled, userId, dims])
}
