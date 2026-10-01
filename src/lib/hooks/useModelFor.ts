import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus, type SecretFlags } from '@/lib/accounts/secrets'
import { errorMessage, toastInfo } from '@/lib/store/useToastStore'
import { useChatBackendClient } from './useChatBackendClient'
import { createChatBackend } from '@/lib/api/createChatBackend'
import type { ChatBackend, ChatBackendId } from '@/lib/api/chatBackend'
import {
  FallbackBackend, MODEL_JOBS, createTextClient, modelLabel, resolveCharacter, resolveJob,
  type ModelJob, type Service, type ServiceKind, type ServiceSettings,
} from '@/lib/api/services'

/** A job's client, and what it is: for notices, token-count scoping, and the record on a reply. */
export interface JobClient {
  client: ChatBackend
  /** "Gemini · gemini-2.5-pro". */
  label: string
  /** Distinct per service and model: tokenizers differ between them (`tokenCache.ts`). */
  scope: string
  /** True when it is the Text model as chosen, with no fallback around it. */
  isMain: boolean
  /** What its service is: decides how its requests are shaped (`usesChatCompletion`). */
  kind: ServiceKind
}

/** The settings a job's client is resolved from: services and choices, and the Text model's long-standing backend. */
export type ModelSettings = ServiceSettings & { chatBackend: ChatBackendId }

// One notice per job a minute: a service that's down would otherwise announce itself every call.
const lastNotice = new Map<string, number>()
function noticeFallback(what: string, label: string, error: unknown): void {
  const now = Date.now()
  if (now - (lastNotice.get(what) ?? 0) < 60_000) return
  lastNotice.set(what, now)
  toastInfo(`${what}: ${label} didn't answer (${errorMessage(error).slice(0, 120)}), so the Text model was used.`)
}

export function useModelSettings(): ModelSettings {
  return useSettingsStore(useShallow((s) => ({
    services: s.services,
    textModel: s.textModel,
    imageModel: s.imageModel,
    voiceModel: s.voiceModel,
    modelJobs: s.modelJobs,
    chatBackend: s.chatBackend,
  })))
}

/** The Text model's own kind: its service's, or what the long-standing backend setting says. */
function mainKind(s: ModelSettings): ServiceKind {
  const text = s.services?.find((service) => service.id === s.textModel?.serviceId)
  return text?.kind ?? (s.chatBackend === 'koboldcpp' ? 'koboldcpp' : s.chatBackend === 'novelai' ? 'novelai' : 'openai-compatible')
}

/**
 * The client for a resolved service and model: the Text model's own when that's what it is,
 * otherwise a fresh one that falls back to the Text model if its service fails, announcing it as `what`.
 */
function clientFor(
  what: string,
  resolved: { service: Service; model: string } | undefined,
  s: ModelSettings,
  main: ChatBackend,
  secrets: SecretFlags,
): JobClient {
  const isText = !resolved || (resolved.service.id === s.textModel?.serviceId && resolved.model === (s.textModel?.model ?? ''))
  if (isText) {
    const text = s.services?.find((service) => service.id === s.textModel?.serviceId)
    return { client: main, label: text ? modelLabel(text, s.textModel?.model ?? '') : 'Text model', scope: 'text', isMain: true, kind: mainKind(s) }
  }
  const { service, model } = resolved
  const label = modelLabel(service, model)
  const own = createTextClient(service, model, secrets)
  return { client: new FallbackBackend(own, main, (error) => noticeFallback(what, label, error)), label, scope: `${service.id}:${model}`, isMain: false, kind: service.kind }
}

/** Every job's client (`MODEL_JOBS`): the model chosen for it in Settings, else the Text model. */
export function useJobClients(): Record<ModelJob, JobClient> {
  const settings = useModelSettings()
  const { saved: secrets } = useSecretStatus()
  const main = useChatBackendClient()
  return useMemo(() => Object.fromEntries(MODEL_JOBS.map(({ id, label }) =>
    [id, clientFor(label, resolveJob(id, settings), settings, main, secrets)])) as Record<ModelJob, JobClient>, [main, secrets, settings])
}

/** One job's client. Prefer `useJobClients` where several jobs are used together. */
export function useModelFor(job: ModelJob): ChatBackend {
  return useJobClients()[job].client
}

/**
 * A job's client outside React (a background tick), from the settings as they are now. Same
 * resolution and fallback as `useJobClients`.
 */
export function jobClientNow(job: ModelJob, secrets: SecretFlags): JobClient {
  const s = useSettingsStore.getState()
  const main = createChatBackend({ chatBackend: s.chatBackend, baseUrl: s.baseUrl, chatBackendBaseUrl: s.chatBackendBaseUrl, chatBackendModel: s.chatBackendModel, chatBackendSecret: s.chatBackendSecret, secrets })
  return clientFor(MODEL_JOBS.find((j) => j.id === job)?.label ?? job, resolveJob(job, s), s, main, secrets)
}

/**
 * A character's own client for their replies: their chosen service and model, else the Story
 * replies job's. Not a hook, so the reply loop can pick one per speaker.
 */
export function characterClient(
  character: { card: { name: string }; modelServiceId?: string; modelOverride?: string },
  settings: ModelSettings,
  main: ChatBackend,
  secrets: SecretFlags,
): JobClient {
  return clientFor(`${character.card.name}'s reply`, resolveCharacter(character, settings), settings, main, secrets)
}
