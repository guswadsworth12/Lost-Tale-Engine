import { create } from 'zustand'
import type { SecretName } from '@/lib/accounts/contract'
import { chosen, serviceSecret, textBaseUrl, type ServiceSettings } from './services'
import { OpenAICompatibleClient } from './openaiCompatible'

// Dimensions are observed in the browser, including query/Test it calls; never persisted.
export const useEmbeddingDimensions = create<{ byConnection: Record<string, number> }>(() => ({ byConnection: {} }))

export function embeddingConnection(settings: ServiceSettings, secrets: Partial<Record<SecretName, boolean>>, observeDimensions = true) {
  const choice = chosen(settings, settings.embeddingModel, 'embeddings')
  if (!choice?.model.trim()) return undefined
  const { service } = choice
  const model = choice.model.trim()
  const secret = serviceSecret(service)
  const base = textBaseUrl(service)
  const client = new OpenAICompatibleClient(base, !!secret && !!secrets[secret], model, secret)
  const key = `${service.id}|${base}|${model}`
  return { model, key, dimensions: () => useEmbeddingDimensions.getState().byConnection[key], embed: async (texts: string[], signal?: AbortSignal) => {
    const rows = await client.embed(texts, signal)
    const dims = rows[0]?.length
    if (observeDimensions && dims && !signal?.aborted && useEmbeddingDimensions.getState().byConnection[key] !== dims) {
      useEmbeddingDimensions.setState((s) => ({ byConnection: { ...s.byConnection, [key]: dims } }))
    }
    return rows
  } }
}
