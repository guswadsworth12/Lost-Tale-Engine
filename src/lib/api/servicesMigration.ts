import type { SecretName } from '@/lib/accounts/contract'
import { isOpenMayhem } from './openMayhem'
import {
  KNOWN_COMPATIBLE, MODEL_JOBS, SERVICE_KINDS, newServiceId, serviceSecret,
  type ModelChoice, type ModelJob, type Service, type ServiceKind, type ServiceSettings,
} from './services'

/** The settings an install had before services: one chat, one image and one voice provider. */
export interface PreServiceSettings {
  chatBackend: string
  baseUrl: string
  chatBackendBaseUrl: string
  chatBackendModel: string
  imageBackend: string
  imageBackendBaseUrl: string
  imageBackendUsername: string
  imageBackendModel: string
  ttsProvider: string
  ttsBaseUrl: string
  ttsRegion: string
  ttsModel: string
  /** This branch's first try at several connections, before services. */
  connections?: { id: string; name: string; kind: string; baseUrl: string; model: string }[]
  modelJobs?: Partial<Record<ModelJob, { connectionId?: string; serviceId?: string; model?: string }>>
}

export interface ServicesMigration {
  settings: Required<Pick<ServiceSettings, 'services' | 'modelJobs'>> & Pick<ServiceSettings, 'textModel' | 'imageModel' | 'voiceModel'>
  /** Saved keys to move to their service's own name, server-side. */
  keyMoves: { from: SecretName; to: SecretName }[]
}

const host = (url: string) => {
  try { return new URL(url).host } catch { return url }
}

/**
 * Turns the settings an install had before services into services, and the Text, Images and Voice
 * models they were using. Keys saved under the old per-purpose names (`chatBackendApiKey`,
 * `imageBackendPassword`, `ttsApiKey`) are moved to the service that now owns them, never over a key
 * already saved there. Pure: `saved` says which keys are saved.
 */
export function migrateToServices(old: PreServiceSettings, saved: Partial<Record<SecretName, boolean>>): ServicesMigration {
  const services: Service[] = []
  const keyMoves: { from: SecretName; to: SecretName }[] = []
  const planned = new Set<string>()

  /** The service for a kind (and address, for kinds with one), made once. */
  const serviceFor = (kind: ServiceKind, fields: Partial<Service> = {}, name?: string): Service => {
    const address = fields.baseUrl?.trim().replace(/\/+$/, '')
    const existing = services.find((s) => s.kind === kind && (!SERVICE_KINDS[kind].address || (s.baseUrl ?? '') === (address ?? '')))
    if (existing) return existing
    const label = name ?? SERVICE_KINDS[kind].label
    const service: Service = { id: newServiceId(label, services.map((s) => s.id)), name: label, kind, ...fields, ...(address !== undefined ? { baseUrl: address } : {}) }
    services.push(service)
    return service
  }
  /** Moves a saved key to the service, unless it has one already (saved, or planned). */
  const moveKey = (from: SecretName, service: Service) => {
    const to = serviceSecret(service)
    if (!to || !saved[from] || from === to || saved[to] || planned.has(to)) return
    planned.add(to)
    keyMoves.push({ from, to })
  }
  /** An OpenAI-style address as the service it belongs to. */
  const compatible = (url: string): Service => {
    if (/api\.openai\.com/.test(url)) return serviceFor('openai')
    if (/generativelanguage\.googleapis\.com/.test(url)) return serviceFor('gemini')
    if (isOpenMayhem(url)) return serviceFor('openmayhem')
    const known = KNOWN_COMPATIBLE.find((k) => k.baseUrl.replace(/\/+$/, '') === url.trim().replace(/\/+$/, ''))
    return serviceFor('openai-compatible', { baseUrl: url }, known?.label ?? host(url))
  }

  // Text: the one chat backend.
  let text: Service
  if (old.chatBackend === 'novelai') text = serviceFor('novelai')
  else if (old.chatBackend === 'openai-compatible' && old.chatBackendBaseUrl.trim()) text = compatible(old.chatBackendBaseUrl)
  else text = serviceFor('koboldcpp', { baseUrl: old.baseUrl || SERVICE_KINDS.koboldcpp.address!.default })
  moveKey('chatBackendApiKey', text)
  const textModel: ModelChoice = { serviceId: text.id, model: old.chatBackend === 'koboldcpp' ? '' : old.chatBackendModel }

  // Images: only one that was set up (a local backend needs its address).
  let imageModel: ModelChoice | undefined
  const imageService = (() => {
    switch (old.imageBackend) {
      case 'openai-image': return serviceFor('openai')
      case 'gemini-image': return serviceFor('gemini')
      case 'openmayhem': return serviceFor('openmayhem')
      case 'novelai-image': return serviceFor('novelai')
      case 'a1111': case 'comfyui': case 'swarmui':
        return old.imageBackendBaseUrl.trim()
          ? serviceFor(old.imageBackend, { baseUrl: old.imageBackendBaseUrl, ...(old.imageBackend === 'a1111' && old.imageBackendUsername ? { username: old.imageBackendUsername } : {}) })
          : undefined
      default: return undefined
    }
  })()
  if (imageService) {
    moveKey('imageBackendPassword', imageService)
    imageModel = { serviceId: imageService.id, model: old.imageBackendModel }
  }

  // Voice.
  let voiceModel: ModelChoice | undefined
  const voiceService = (() => {
    switch (old.ttsProvider) {
      case 'koboldcpp': return serviceFor('koboldcpp', { baseUrl: old.baseUrl || SERVICE_KINDS.koboldcpp.address!.default })
      case 'openai-compatible': return old.ttsBaseUrl.trim() ? compatible(old.ttsBaseUrl) : undefined
      case 'elevenlabs': return serviceFor('elevenlabs')
      case 'azure': return serviceFor('azure', old.ttsRegion ? { region: old.ttsRegion } : {})
      case 'openmayhem': return serviceFor('openmayhem')
      case 'luxtts': return serviceFor('luxtts')
      default: return undefined
    }
  })()
  if (voiceService) {
    moveKey('ttsApiKey', voiceService)
    voiceModel = { serviceId: voiceService.id, model: old.ttsModel }
  }

  // This branch's earlier connections become services too. (Their keys were never released, so
  // there are none worth moving: a key saved on one is entered again on its service.)
  const fromConnection = new Map<string, { service: Service; model: string }>([['main', { service: text, model: textModel.model }]])
  for (const c of old.connections ?? []) {
    const service = c.kind === 'openai-compatible' || !(c.kind in SERVICE_KINDS)
      ? compatible(c.baseUrl)
      : serviceFor(c.kind as ServiceKind, c.kind === 'koboldcpp' ? { baseUrl: c.baseUrl } : {}, c.name)
    fromConnection.set(c.id, { service, model: c.model })
  }
  const modelJobs: Partial<Record<ModelJob, ModelChoice>> = {}
  for (const { id } of MODEL_JOBS) {
    const job = old.modelJobs?.[id]
    if (!job) continue
    if (job.serviceId) { modelJobs[id] = { serviceId: job.serviceId, model: job.model ?? '' }; continue }
    const from = job.connectionId ? fromConnection.get(job.connectionId) : undefined
    if (from) modelJobs[id] = { serviceId: from.service.id, model: job.model?.trim() || from.model }
  }

  return { settings: { services, textModel, imageModel, voiceModel, modelJobs }, keyMoves }
}

/**
 * When something still sets the text backend the long-standing way (the Welcome screen's first-run
 * setup), the service it means: an existing one with the same kind and address, else a new one. It
 * becomes the Text model. Undefined while the choice isn't complete yet (an OpenAI-compatible
 * backend with no address).
 */
export function adoptLegacyText(s: Pick<PreServiceSettings, 'chatBackend' | 'baseUrl' | 'chatBackendBaseUrl' | 'chatBackendModel'> & ServiceSettings): { services: Service[]; textModel: ModelChoice } | undefined {
  if (s.chatBackend === 'openai-compatible' && !s.chatBackendBaseUrl.trim()) return undefined
  const { settings } = migrateToServices({
    chatBackend: s.chatBackend, baseUrl: s.baseUrl, chatBackendBaseUrl: s.chatBackendBaseUrl, chatBackendModel: s.chatBackendModel,
    imageBackend: '', imageBackendBaseUrl: '', imageBackendUsername: '', imageBackendModel: '', ttsProvider: '', ttsBaseUrl: '', ttsRegion: '', ttsModel: '',
  }, {})
  const made = settings.services[0]
  const services = s.services ?? []
  const model = settings.textModel?.model ?? ''
  const existing = services.find((x) => x.kind === made.kind && (x.baseUrl ?? '') === (made.baseUrl ?? ''))
  if (existing) return { services, textModel: { serviceId: existing.id, model } }
  // The same kind of server at a new address (KoboldCpp found elsewhere): it moved, not a second one.
  const current = services.find((x) => x.id === s.textModel?.serviceId)
  if (current && current.kind === made.kind && SERVICE_KINDS[made.kind].address) {
    return { services: services.map((x) => (x.id === current.id ? { ...x, baseUrl: made.baseUrl } : x)), textModel: { serviceId: current.id, model } }
  }
  const service = { ...made, id: newServiceId(made.name, services.map((x) => x.id)) }
  return { services: [...services, service], textModel: { serviceId: service.id, model } }
}
