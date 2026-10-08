import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { useAuthStore } from '@/lib/accounts/useAuthStore'
import { embeddingConnection } from '@/lib/api/embeddings'
import { memoryVectorsApi } from '@/lib/api/client'
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
  const connection = useMemo(() => embeddingConnection({ services, embeddingModel }, secrets), [services, embeddingModel, secrets])
  useEffect(() => {
    if (!chatId || !enabled || !connection) { useMemoryIndexProgress.setState({ status: '', chatId: '' }); return }
    if (cancelled) { useMemoryIndexProgress.setState({ status: 'Indexing cancelled.' }); return }
    if (generating) { useMemoryIndexProgress.setState({ status: 'Indexing paused during the reply.' }); return }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const context = `${userId ?? ''}|${chatId}|${connection.key}`
    const previous = useMemoryIndexProgress.getState()
    let indexed = previous.context === context ? previous.indexed : 0
    let failures = 0
    useMemoryIndexProgress.setState({ context, chatId, indexed, remaining: previous.context === context ? previous.remaining : 0, status: 'Checking memories…' })
    const step = async () => {
      let delay = 1500
      try {
        const result = await indexMemoryBatch(enabled, connection, controller.signal,
          () => useMemoryIndexProgress.getState().cancelled,
          () => memoryVectorsApi.missing(chatId, connection.model, controller.signal),
          (rows) => memoryVectorsApi.put(rows, controller.signal))
        if (controller.signal.aborted || !result) return
        failures = 0
        indexed += result.indexed
        useMemoryIndexProgress.setState({ indexed, remaining: result.remaining,
          status: result.remaining ? 'Preparing recall by meaning…' : 'Recall by meaning is ready.' })
        if (!result.remaining) delay = 20_000
      } catch {
        if (controller.signal.aborted) return
        delay = Math.min(60_000, 2000 * 2 ** ++failures)
        useMemoryIndexProgress.setState({ status: 'Indexing will retry later. Ordinary recall is available.' })
      }
      timer = setTimeout(step, delay)
    }
    void step()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [chatId, enabled, connection, generating, cancelled, userId])
}
