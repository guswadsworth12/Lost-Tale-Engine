// Multi-provider text-to-speech. Every provider returns a playable audio Blob from
// plain text — a caller doesn't need to know which provider is behind it.

import { speakOpenMayhem } from '../api/openMayhemMedia'
import { relayFetch } from '../api/relay'
import {
  GEMINI_VOICES, NOVELAI_VOICES, listAllTalkVoices, listEdgeVoices, listFishVoices, listMiniMaxVoices,
  speakAllTalk, speakEdge, speakFishAudio, speakGemini, speakMiniMax, speakNovelAI,
} from './moreVoices'
import type { SecretName } from '@/lib/accounts/contract'

export type TtsProviderId =
  | 'koboldcpp' | 'openai-compatible' | 'elevenlabs' | 'azure' | 'alibaba' | 'openmayhem' | 'luxtts'
  | 'gemini' | 'fishaudio' | 'minimax' | 'novelai' | 'alltalk' | 'edge'

export interface TtsConfig {
  provider: TtsProviderId
  /**
   * Whether this provider's key is saved (`ttsApiKey`, or `openMayhemApiKey` for OpenMayhem). The
   * browser never holds it: requests go through the server's relay (or OpenMayhem's proxy), which
   * attaches it.
   */
  keySaved?: boolean
  /** For 'openai-compatible' (e.g. a local Kokoro-FastAPI server) and 'alltalk'. koboldcpp reuses the app's own connection URL instead. */
  baseUrl?: string
  /** Azure region, e.g. "eastus". */
  region?: string
  voice: string
  model?: string
  /** Speaking rate, 0.5–2. LuxTTS, Edge, Fish Audio, MiniMax and AllTalk read it. */
  speed?: number
  /** Which saved key to attach: the chosen voice service's (`api/services.ts`). Unset: `ttsApiKey`. */
  secret?: SecretName
}

export const TTS_PROVIDER_LABELS: Record<TtsProviderId, string> = {
  luxtts: 'LuxTTS (your voice server)',
  openmayhem: 'OpenMayhem (hosted)',
  koboldcpp: 'KoboldCpp (local)',
  'openai-compatible': 'OpenAI-compatible (incl. local Kokoro)',
  elevenlabs: 'ElevenLabs',
  azure: 'Microsoft / Azure Speech',
  alibaba: 'Alibaba Cloud Model Studio',
  gemini: 'Google Gemini',
  fishaudio: 'Fish Audio',
  minimax: 'MiniMax',
  novelai: 'NovelAI',
  alltalk: 'AllTalk (local)',
  edge: 'Edge TTS (free)',
}

/** Providers that read `speed`. */
export const SPEED_TTS: TtsProviderId[] = ['luxtts', 'edge', 'fishaudio', 'minimax', 'alltalk']

/** Providers that need nothing from Settings (no key, no address), so a character may override to them freely. */
export const SERVER_SIDE_TTS: TtsProviderId[] = ['luxtts', 'edge']

/**
 * LuxTTS goes through this app's server (`server/luxtts.ts`), which holds the server address and
 * token. `voice` is a voice-sample file from Settings → Voice; blank uses the server's default.
 */
async function speakLuxtts(text: string, voice: string, speed: number | undefined, signal?: AbortSignal): Promise<Blob> {
  const res = await relayFetch('/api/tts/luxtts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, reference: voice || undefined, speed }),
    signal,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `LuxTTS request failed (${res.status})`)
  }
  return res.blob()
}

async function speakOpenAiCompatible(baseUrl: string, keySaved: boolean, text: string, voice: string, secret: SecretName = 'ttsApiKey', model = '', signal?: AbortSignal): Promise<Blob> {
  // Kokoro and most servers are given as `http://host:8880/v1`; the path adds its own `/v1`.
  const res = await relayFetch(`${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(keySaved ? { secret, auth: 'bearer' as const } : {}),
    body: JSON.stringify({ model: model || 'tts-1', input: text, voice: voice || 'alloy' }),
    signal,
  })
  if (!res.ok) throw new Error(`TTS request to ${baseUrl} failed (${res.status})`)
  return res.blob()
}

async function speakElevenLabs(keySaved: boolean, voiceId: string, text: string, secret: SecretName = 'ttsApiKey'): Promise<Blob> {
  if (!keySaved) throw new Error('ElevenLabs needs an API key (Settings → Models and services)')
  if (!voiceId) throw new Error('ElevenLabs needs a voice ID (Settings → Voice)')
  const res = await relayFetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    secret,
    auth: 'header:xi-api-key',
    body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2' }),
  })
  if (!res.ok) throw new Error(`ElevenLabs TTS failed (${res.status})`)
  return res.blob()
}

function escapeSsml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function speakAzure(keySaved: boolean, region: string, voiceName: string, text: string, secret: SecretName = 'ttsApiKey'): Promise<Blob> {
  if (!keySaved || !region) throw new Error('Azure Speech needs a subscription key and region (Settings → Models and services)')
  const ssml = `<speak version="1.0" xml:lang="en-US"><voice name="${voiceName || 'en-US-JennyNeural'}">${escapeSsml(text)}</voice></speak>`
  const res = await relayFetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-64kbitrate-mono-mp3',
    },
    secret,
    auth: 'header:Ocp-Apim-Subscription-Key',
    body: ssml,
  })
  if (!res.ok) throw new Error(`Azure Speech TTS failed (${res.status})`)
  return res.blob()
}

/**
 * Synthesizes speech for the given text using whichever provider is configured.
 * `koboldBaseUrl` is the app's own KoboldCpp connection URL (Settings → Connection) —
 * koboldcpp exposes an OpenAI-compatible /v1/audio/speech endpoint, so the local
 * provider is just the same call pointed at that URL with no API key.
 */
export async function synthesizeSpeech(config: TtsConfig, text: string, koboldBaseUrl: string, signal?: AbortSignal): Promise<Blob> {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('Nothing to speak')
  // A pasted id/region with a trailing space or newline is a common, silent cause of a 401 —
  // trimmed here (at the point of use) rather than on every keystroke in Settings. (Keys are
  // trimmed when saved; the browser never holds one.)
  const keySaved = !!config.keySaved
  const voice = config.voice?.trim() ?? ''
  const baseUrl = config.baseUrl?.trim()
  const region = config.region?.trim()

  switch (config.provider) {
    case 'luxtts':
      return speakLuxtts(trimmed, voice, config.speed, signal)
    case 'openmayhem':
      return speakOpenMayhem(keySaved, config.model || '', trimmed, voice, signal)
    case 'koboldcpp':
      // A character's own KoboldCpp service brings its address; otherwise it's the app's.
      return speakOpenAiCompatible(baseUrl || koboldBaseUrl, false, trimmed, voice, undefined, '', signal)
    case 'openai-compatible':
      if (!baseUrl) throw new Error('Set an address for the OpenAI-compatible voice service (Settings → Models and services)')
      return speakOpenAiCompatible(baseUrl, keySaved, trimmed, voice, config.secret, config.model, signal)
    case 'elevenlabs':
      return speakElevenLabs(keySaved, voice, trimmed, config.secret)
    case 'azure':
      return speakAzure(keySaved, region ?? '', voice, trimmed, config.secret)
    case 'gemini':
      return speakGemini(keySaved, config.model || '', voice, trimmed, config.secret, signal)
    case 'fishaudio':
      return speakFishAudio(keySaved, config.model || '', voice, trimmed, config.speed, config.secret ?? 'ttsApiKey', signal)
    case 'minimax':
      return speakMiniMax(keySaved, config.model || '', voice, trimmed, config.speed, config.secret ?? 'ttsApiKey', signal)
    case 'novelai':
      return speakNovelAI(keySaved, voice, trimmed, config.secret ?? 'ttsApiKey', signal)
    case 'alltalk':
      return speakAllTalk(baseUrl ?? '', voice, trimmed, config.speed, signal)
    case 'edge':
      return speakEdge(voice, trimmed, config.speed, signal)
    case 'alibaba':
      // DashScope's TTS request/response shape hasn't been confirmed against a live account —
      // rather than guess at an API contract, this is left honestly unimplemented.
      throw new Error('Alibaba Cloud Model Studio isn\'t wired up yet. The other providers are ready to use.')
  }
}

/** Voices available for the local koboldcpp TTS model, if one is loaded. */
export async function listKoboldSpeakers(koboldBaseUrl: string): Promise<string[]> {
  const res = await relayFetch(`${koboldBaseUrl.replace(/\/+$/, '')}/api/extra/speakers_list`)
  if (!res.ok) return []
  const data = (await res.json().catch(() => null)) as { speakers?: { name?: string }[] } | null
  return Array.isArray(data?.speakers) ? data.speakers.map((s) => s.name).filter((n): n is string => !!n) : []
}

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']

/** A provider's voices for a picker, and whether a voice id it doesn't list may be typed (a clone, a seed, a voice from a library). */
export interface VoiceList {
  voices: { id: string; label: string }[]
  typable: boolean
}

/**
 * The voices `target` can speak with, as far as it can say. A list that can't be loaded comes back
 * empty with typing allowed, so a voice can still be set. LuxTTS and OpenMayhem have pickers of their own.
 */
export async function listVoices(
  target: { provider: TtsProviderId; baseUrl?: string; region?: string; secret?: SecretName },
  keySaved: boolean,
  koboldBaseUrl = '',
): Promise<VoiceList> {
  const named = (ids: string[]) => ids.map((id) => ({ id, label: id }))
  const secret = target.secret ?? 'ttsApiKey'
  const base = (target.baseUrl ?? '').replace(/\/+$/, '').replace(/\/v1$/, '')
  try {
    switch (target.provider) {
      case 'gemini': return { voices: named(GEMINI_VOICES), typable: false }
      case 'novelai': return { voices: named(NOVELAI_VOICES), typable: true }
      case 'edge': return { voices: await listEdgeVoices(), typable: false }
      case 'fishaudio': return { voices: await listFishVoices(keySaved, secret), typable: true }
      case 'minimax': return { voices: await listMiniMaxVoices(keySaved, secret), typable: true }
      case 'alltalk': return { voices: await listAllTalkVoices(target.baseUrl ?? ''), typable: true }
      case 'koboldcpp': return { voices: named(await listKoboldSpeakers(target.baseUrl || koboldBaseUrl)), typable: true }
      case 'elevenlabs': {
        if (!keySaved) return { voices: [], typable: true }
        const res = await relayFetch('https://api.elevenlabs.io/v1/voices', { secret, auth: 'header:xi-api-key' })
        const body = res.ok ? await res.json() as { voices?: { voice_id?: string; name?: string }[] } : null
        return { voices: (body?.voices ?? []).filter((v) => v.voice_id).map((v) => ({ id: v.voice_id!, label: v.name || v.voice_id! })), typable: true }
      }
      case 'azure': {
        if (!keySaved || !target.region) return { voices: [], typable: true }
        const res = await relayFetch(`https://${target.region.trim()}.tts.speech.microsoft.com/cognitiveservices/voices/list`, { secret, auth: 'header:Ocp-Apim-Subscription-Key' })
        const body = res.ok ? await res.json() as { ShortName?: string; DisplayName?: string; Locale?: string; Gender?: string }[] : []
        return { voices: body.filter((v) => v.ShortName).map((v) => ({ id: v.ShortName!, label: `${v.DisplayName ?? v.ShortName} · ${v.Locale} · ${v.Gender}` })), typable: true }
      }
      case 'openai-compatible': {
        if (/api\.openai\.com$/.test(base)) return { voices: named(OPENAI_VOICES), typable: true }
        // Kokoro-FastAPI lists its voices here; other servers may not.
        const res = await relayFetch(`${base}/v1/audio/voices`, keySaved ? { secret, auth: 'bearer' } : {}).catch(() => undefined)
        const body = res?.ok ? await res.json().catch(() => null) as { voices?: unknown[] } | null : null
        const ids = (body?.voices ?? []).map((v) => (typeof v === 'string' ? v : (v as { id?: string; name?: string })?.id ?? (v as { name?: string })?.name)).filter((v): v is string => !!v)
        return { voices: named(ids.length ? ids : OPENAI_VOICES), typable: true }
      }
      default: return { voices: [], typable: true }
    }
  } catch {
    return { voices: [], typable: true }
  }
}
