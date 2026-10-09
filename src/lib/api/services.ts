import { serviceSecretName, type SecretName } from '@/lib/accounts/contract'
import type { ChatBackend, ChatBackendId } from './chatBackend'
import type { ImageBackendId } from './imageBackend'
import type { TtsProviderId } from '@/lib/voice/ttsProviders'
import { KoboldClient } from './kobold'
import { NovelAIClient } from './novelai'
import { OPENMAYHEM_BASE_URL } from './openMayhem'
import { OpenAICompatibleClient } from './openaiCompatible'
import { FISH_MODELS, GEMINI_TTS_MODELS, MINIMAX_MODELS } from '@/lib/voice/moreVoices'

/**
 * Services and models. A **service** is one account or server (OpenAI, a local KoboldCpp, an
 * ElevenLabs account), added once with its address and key. **Models** are then chosen from what
 * those services offer: one for text, one for images, one for voice, and optionally a different text
 * model for particular jobs (`ModelJob`) or characters.
 *
 * The chosen Text, Images and Voice models are written through to the long-standing settings the
 * chat, image and voice code reads (`legacyFieldsFor`), so that code needs to know nothing of
 * services beyond which saved key to use.
 */

export type ServiceKind =
  | 'openai' | 'gemini' | 'openmayhem' | 'openai-compatible' | 'koboldcpp' | 'novelai'
  | 'a1111' | 'comfyui' | 'swarmui' | 'elevenlabs' | 'azure' | 'luxtts'
  | 'fishaudio' | 'minimax' | 'edge' | 'alltalk'

export type Capability = 'text' | 'images' | 'voice' | 'embeddings'

export interface ServiceKindInfo {
  label: string
  offers: Capability[]
  /** Whether it needs an address, and what to start with. */
  address?: { default: string; required: boolean }
  key: 'none' | 'optional' | 'required'
  /** The provider-wide key it shares with the rest of the app, instead of a key of its own. */
  sharedSecret?: SecretName
  /** A1111's `--api-auth` user. */
  username?: boolean
  /** Azure speech's region. */
  region?: boolean
  /** Nothing to choose between: it speaks with whatever it has (the model picker says so instead of offering to type one). */
  noModels?: boolean
  /** Suggested models, until the service's own list is loaded. */
  models?: Partial<Record<Capability, string[]>>
  hint?: string
}

export const SERVICE_KINDS: Record<ServiceKind, ServiceKindInfo> = {
  openai: {
    label: 'OpenAI', offers: ['text', 'images', 'voice', 'embeddings'], key: 'required', sharedSecret: 'openaiApiKey',
    models: { text: ['gpt-4o', 'gpt-5'], images: ['gpt-image-2', 'gpt-image-1'], voice: ['tts-1', 'gpt-4o-mini-tts'], embeddings: ['text-embedding-3-small', 'text-embedding-3-large'] },
  },
  gemini: {
    label: 'Google Gemini', offers: ['text', 'images', 'voice'], key: 'required', sharedSecret: 'geminiApiKey',
    models: { text: ['gemini-2.5-pro', 'gemini-2.5-flash'], images: ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview'], voice: GEMINI_TTS_MODELS },
  },
  openmayhem: { label: 'OpenMayhem', offers: ['text', 'images', 'voice'], key: 'required', sharedSecret: 'openMayhemApiKey' },
  'openai-compatible': {
    label: 'OpenAI-compatible', offers: ['text', 'voice', 'embeddings'], key: 'optional', address: { default: '', required: true },
    hint: 'OpenRouter, Groq, Mistral, DeepSeek, LM Studio, Ollama, a local Kokoro voice server, and anything else that speaks the OpenAI API.',
  },
  koboldcpp: { label: 'KoboldCpp', offers: ['text', 'voice'], key: 'none', address: { default: 'http://localhost:5001', required: true } },
  novelai: {
    label: 'NovelAI', offers: ['text', 'images', 'voice'], key: 'required',
    models: { text: ['kayra-v1', 'clio-v1'], images: ['nai-diffusion-4-5-full', 'nai-diffusion-4-5-curated'], voice: ['v2'] },
  },
  a1111: { label: 'Automatic1111 / Forge', offers: ['images'], key: 'optional', username: true, address: { default: 'http://127.0.0.1:7860', required: true } },
  comfyui: { label: 'ComfyUI', offers: ['images'], key: 'none', address: { default: 'http://127.0.0.1:8188', required: true } },
  swarmui: { label: 'SwarmUI', offers: ['images'], key: 'none', address: { default: 'http://127.0.0.1:7801', required: true } },
  elevenlabs: { label: 'ElevenLabs', offers: ['voice'], key: 'required' },
  azure: { label: 'Microsoft / Azure Speech', offers: ['voice'], key: 'required', region: true },
  luxtts: { label: 'LuxTTS (your voice server)', offers: ['voice'], key: 'none', hint: 'Its address and token are set on the server.' },
  fishaudio: { label: 'Fish Audio', offers: ['voice'], key: 'required', models: { voice: FISH_MODELS }, hint: 'Your own cloned voices and the community\'s, from fish.audio.' },
  minimax: { label: 'MiniMax', offers: ['voice'], key: 'required', models: { voice: MINIMAX_MODELS }, hint: 'A key from minimax.io (the international platform).' },
  edge: { label: 'Edge TTS (free)', offers: ['voice'], key: 'none', noModels: true, hint: 'Microsoft\'s free neural voices, as Edge\'s Read Aloud uses. No account needed.' },
  alltalk: {
    label: 'AllTalk', offers: ['voice'], key: 'none', noModels: true, address: { default: 'http://127.0.0.1:7851', required: true },
    hint: 'AllTalk TTS v2 on your machine. Its engine and model are chosen in AllTalk itself.',
  },
}

/** OpenAI-compatible services people commonly add, so their address fills in by itself. */
export const KNOWN_COMPATIBLE: { label: string; baseUrl: string }[] = [
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { label: 'Nano-GPT', baseUrl: 'https://nano-gpt.com/api/v1' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1' },
  { label: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
  { label: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1' },
  { label: 'xAI (Grok)', baseUrl: 'https://api.x.ai/v1' },
  { label: 'LM Studio (local)', baseUrl: 'http://localhost:1234/v1' },
  { label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1' },
  { label: 'Kokoro (local)', baseUrl: 'http://localhost:8880/v1' },
]

export interface Service {
  id: string
  name: string
  kind: ServiceKind
  /** Kinds with an address only. */
  baseUrl?: string
  username?: string
  region?: string
  /** The service's own model lists, as last loaded, for the model pickers. */
  models?: Partial<Record<Capability, string[]>>
}

/** A model picked from a service. */
export interface ModelChoice {
  serviceId: string
  model: string
}

/** The text jobs a different model can be picked for. Each covers a family of calls. */
export type ModelJob = 'story' | 'gm' | 'memory' | 'tracking' | 'vision' | 'creation' | 'images'

export const MODEL_JOBS: { id: ModelJob; label: string; covers: string }[] = [
  { id: 'story', label: 'Story replies', covers: 'Each character\'s reply, and writing your turn for you.' },
  { id: 'gm', label: 'Game Master', covers: 'Rulings, narration, who speaks next.' },
  { id: 'memory', label: 'Memory', covers: 'The memory scribe, journals, the rolling summary, scene and chapter recaps.' },
  { id: 'tracking', label: 'Story tracking', covers: 'Relationships, dates, rapport, objectives, reply suggestions.' },
  { id: 'vision', label: 'Scene vision', covers: 'Expressions, forms and scenery. Needs a model that can see images.' },
  { id: 'creation', label: 'Writer\'s Room and creation', covers: 'The assistant, rulesets and prompt tuning, drafting characters and worlds, lore suggestions.' },
  { id: 'images', label: 'Image prompts', covers: 'Writing Picture this prompts.' },
]

/** What this module reads from settings. */
export interface ServiceSettings {
  services?: Service[]
  textModel?: ModelChoice | null
  imageModel?: ModelChoice | null
  voiceModel?: ModelChoice | null
  embeddingModel?: ModelChoice | null
  modelJobs?: Partial<Record<ModelJob, ModelChoice>>
}

export const offers = (service: Service, capability: Capability) => SERVICE_KINDS[service.kind].offers.includes(capability)

/** The saved key a service's calls carry, or none. */
export function serviceSecret(service: Pick<Service, 'id' | 'kind'>): SecretName | undefined {
  const info = SERVICE_KINDS[service.kind]
  if (info.key === 'none') return undefined
  return info.sharedSecret ?? serviceSecretName(service.id)
}

/** The address a text request goes to. */
export function textBaseUrl(service: Service): string {
  switch (service.kind) {
    case 'openai': return 'https://api.openai.com/v1'
    case 'gemini': return 'https://generativelanguage.googleapis.com/v1beta/openai'
    case 'openmayhem': return OPENMAYHEM_BASE_URL
    default: return service.baseUrl ?? ''
  }
}

/** Whether a service takes chat messages (and formats its own turns) rather than one templated prompt. */
export function usesChatCompletion(kind: ServiceKind): boolean {
  return kind === 'openai' || kind === 'gemini' || kind === 'openmayhem' || kind === 'openai-compatible'
}

/** A text client for one service and model. `secrets`: which keys are saved. */
export function createTextClient(service: Service, model: string, secrets: Partial<Record<SecretName, boolean>>): ChatBackend {
  const secret = serviceSecret(service)
  const keySaved = !!secret && !!secrets[secret]
  if (service.kind === 'koboldcpp') return new KoboldClient(service.baseUrl ?? '')
  if (service.kind === 'novelai') return new NovelAIClient(keySaved, model, secret)
  return new OpenAICompatibleClient(textBaseUrl(service), keySaved, model, secret)
}

const findService = (s: ServiceSettings, id: string | undefined) => (id ? s.services?.find((service) => service.id === id) : undefined)

/** A choice whose service still exists and offers `capability`, with that service. */
export function chosen(s: ServiceSettings, choice: ModelChoice | null | undefined, capability: Capability): { service: Service; model: string } | undefined {
  const service = findService(s, choice?.serviceId)
  return service && offers(service, capability) ? { service, model: choice!.model } : undefined
}

/** A job's text model: its own choice if it has one, else the Text model. Undefined: nothing chosen yet (the long-standing settings rule). */
export function resolveJob(job: ModelJob, s: ServiceSettings): { service: Service; model: string } | undefined {
  return chosen(s, s.modelJobs?.[job], 'text') ?? chosen(s, s.textModel, 'text')
}

/** A character's text model: their own choice, else the Story replies job's. */
export function resolveCharacter(character: { modelServiceId?: string; modelOverride?: string }, s: ServiceSettings): { service: Service; model: string } | undefined {
  const own = findService(s, character.modelServiceId)
  if (own && offers(own, 'text')) return { service: own, model: character.modelOverride?.trim() || '' }
  const story = resolveJob('story', s)
  return story && character.modelOverride?.trim() ? { ...story, model: character.modelOverride.trim() } : story
}

/** "Gemini · gemini-2.5-pro", for pickers, notices, and the record on a reply. */
export function modelLabel(service: Pick<Service, 'name'>, model: string): string {
  return model ? `${service.name} · ${model}` : service.name
}

/** A new service's id: short, unique among `taken`, safe in a secret name. */
export function newServiceId(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'service'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

// ---- Writing the choices through to the long-standing settings -------------------------------

/** The long-standing settings this module writes: what the chat, image and voice code reads. */
export interface LegacyFields {
  chatBackend?: ChatBackendId
  baseUrl?: string
  chatBackendBaseUrl?: string
  chatBackendModel?: string
  chatBackendSecret?: SecretName
  imageBackend?: ImageBackendId
  imageBackendBaseUrl?: string
  imageBackendUsername?: string
  imageBackendModel?: string
  imageBackendSecret?: SecretName
  ttsProvider?: TtsProviderId
  ttsBaseUrl?: string
  ttsRegion?: string
  ttsModel?: string
  ttsSecret?: SecretName
}

/** The long-standing fields that say what the chosen Text, Images and Voice models are. A capability with no choice leaves its fields alone. */
export function legacyFieldsFor(s: ServiceSettings): LegacyFields {
  const out: LegacyFields = {}
  const text = chosen(s, s.textModel, 'text')
  if (text) {
    const { service, model } = text
    out.chatBackendModel = model
    out.chatBackendSecret = serviceSecret(service)
    if (service.kind === 'koboldcpp') {
      out.chatBackend = 'koboldcpp'
      out.baseUrl = service.baseUrl ?? ''
    } else if (service.kind === 'novelai') {
      out.chatBackend = 'novelai'
    } else {
      out.chatBackend = 'openai-compatible'
      out.chatBackendBaseUrl = textBaseUrl(service)
    }
  }
  const image = chosen(s, s.imageModel, 'images')
  if (image) {
    const { service, model } = image
    const backend: Partial<Record<ServiceKind, ImageBackendId>> = {
      openai: 'openai-image', gemini: 'gemini-image', openmayhem: 'openmayhem', novelai: 'novelai-image', a1111: 'a1111', comfyui: 'comfyui', swarmui: 'swarmui',
    }
    out.imageBackend = backend[service.kind]
    out.imageBackendModel = model
    out.imageBackendBaseUrl = service.baseUrl ?? ''
    out.imageBackendUsername = service.username ?? ''
    out.imageBackendSecret = serviceSecret(service)
  }
  const voice = chosen(s, s.voiceModel, 'voice')
  if (voice) {
    const { service, model } = voice
    const target = voiceTarget(service)
    out.ttsModel = model
    out.ttsSecret = target.secret
    out.ttsRegion = target.region ?? ''
    out.ttsProvider = target.provider
    if (target.provider === 'koboldcpp') {
      // KoboldCpp's voice is spoken from the app's KoboldCpp address.
      out.baseUrl ??= service.baseUrl ?? ''
    } else if (target.baseUrl !== undefined) {
      out.ttsBaseUrl = target.baseUrl
    }
  }
  return out
}

// ---- Voices -----------------------------------------------------------------------------------

/** Where a voice service's speech goes: the provider that speaks it, and its address, region and key. */
export interface VoiceTarget {
  provider: TtsProviderId
  baseUrl?: string
  region?: string
  secret?: SecretName
}

export function voiceTarget(service: Service): VoiceTarget {
  const secret = serviceSecret(service)
  switch (service.kind) {
    case 'openai': return { provider: 'openai-compatible', baseUrl: 'https://api.openai.com', secret }
    case 'openai-compatible': return { provider: 'openai-compatible', baseUrl: service.baseUrl ?? '', secret }
    case 'koboldcpp':
    case 'alltalk': return { provider: service.kind, baseUrl: service.baseUrl ?? '' }
    case 'azure': return { provider: 'azure', region: service.region ?? '', secret }
    default: return { provider: service.kind as TtsProviderId, secret }
  }
}

/** A service's first voice model: its loaded list's, else the suggested one. Blank: it has none to choose. */
export function defaultVoiceModel(service: Service): string {
  return service.models?.voice?.[0] ?? SERVICE_KINDS[service.kind].models?.voice?.[0] ?? ''
}

/**
 * The voice service a character speaks with, when they have their own: that service, with the
 * Voice model's model if it is the same service, else the service's first. Undefined: they use the
 * Voice model. Throws when their service has been removed, rather than speaking in someone else's voice.
 */
export function resolveCharacterVoice(voice: { serviceId?: string } | undefined, s: ServiceSettings): { service: Service; model: string } | undefined {
  if (!voice?.serviceId) return undefined
  const own = findService(s, voice.serviceId)
  if (!own || !offers(own, 'voice')) {
    throw new Error('This character\'s voice service has been removed. Pick another on their Voice tab.')
  }
  const global = chosen(s, s.voiceModel, 'voice')
  return { service: own, model: global?.service.id === own.id ? global.model : defaultVoiceModel(own) }
}

// ---- Fallback ---------------------------------------------------------------------------------

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')
}

/**
 * A job's client that falls back to the Text model: when its own service fails (unreachable,
 * refused, out of quota), the call is made once more on the Text model and `onFallback` is told, so
 * play goes on and the user hears which model answered. A call the user stopped is never retried.
 */
export class FallbackBackend implements ChatBackend {
  /** Whether the last call was answered by the Text model rather than this job's own. */
  fellBack = false

  constructor(
    private primary: ChatBackend,
    private main: ChatBackend,
    private onFallback: (error: unknown) => void,
  ) {}

  get prefersJsonObject(): boolean | undefined { return this.primary.prefersJsonObject }

  async generate(...args: Parameters<ChatBackend['generate']>): Promise<string> {
    this.fellBack = false
    try {
      return await this.primary.generate(...args)
    } catch (error) {
      if (isAbort(error, args[1])) throw error
      this.onFallback(error)
      this.fellBack = true
      return this.main.generate(...args)
    }
  }

  async generateStream(...args: Parameters<ChatBackend['generateStream']>): Promise<string> {
    this.fellBack = false
    try {
      return await this.primary.generateStream(...args)
    } catch (error) {
      if (isAbort(error, args[2])) throw error
      this.onFallback(error)
      this.fellBack = true
      // `onToken` hands over the whole text so far, so the Text model's stream simply replaces any partial reply.
      return this.main.generateStream(...args)
    }
  }

  getEffectiveMaxContext(fallback?: number): Promise<number> { return this.primary.getEffectiveMaxContext(fallback) }
  tokenCount(text: string): Promise<{ count: number }> { return this.primary.tokenCount(text) }
  getChatTemplate(): Promise<string | null> { return this.primary.getChatTemplate() }

  async abort(genkey: string): Promise<void> {
    await Promise.all([this.primary.abort(genkey), this.main.abort(genkey)].map((p) => p.catch(() => {})))
  }
}

/**
 * What wrote something, for the record on it: nothing when it was the Text model as chosen, the
 * service and model otherwise, and plainly when the Text model had to step in.
 */
export function servedByLabel(job: { client: ChatBackend; label: string; isMain: boolean }): string | null {
  if (job.isMain) return null
  return job.client instanceof FallbackBackend && job.client.fellBack ? `Text model (${job.label} didn't answer)` : job.label
}
