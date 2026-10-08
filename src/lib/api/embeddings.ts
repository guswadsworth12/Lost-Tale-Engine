import type { SecretName } from '@/lib/accounts/contract'
import { chosen, serviceSecret, textBaseUrl, type ServiceSettings } from './services'
import { OpenAICompatibleClient } from './openaiCompatible'

export function embeddingConnection(settings: ServiceSettings, secrets: Partial<Record<SecretName, boolean>>) {
  const choice = chosen(settings, settings.embeddingModel, 'embeddings')
  if (!choice?.model.trim()) return undefined
  const { service } = choice
  const model = choice.model.trim()
  const secret = serviceSecret(service)
  const base = textBaseUrl(service)
  const client = new OpenAICompatibleClient(base, !!secret && !!secrets[secret], model, secret)
  return { model, key: `${service.id}|${base}|${model}`, embed: (texts: string[], signal?: AbortSignal) => client.embed(texts, signal) }
}
