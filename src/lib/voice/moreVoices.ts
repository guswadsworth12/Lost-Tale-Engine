import type { SecretName } from '@/lib/accounts/contract'
import { relayFetch } from '../api/relay'

/**
 * The voice services added after the first set (`ttsProviders.ts` dispatches to these): Gemini,
 * Fish Audio, MiniMax, NovelAI, AllTalk and Edge. Each returns a playable Blob, and each one's
 * voices can be listed for the pickers.
 */

async function failure(res: Response, what: string): Promise<Error> {
  const body = await res.text().catch(() => '')
  let detail = body
  try {
    const parsed = JSON.parse(body) as unknown
    const first = (Array.isArray(parsed) ? parsed[0] : parsed) as { error?: { message?: string } | string; message?: string; base_resp?: { status_msg?: string } } | undefined
    detail = (typeof first?.error === 'string' ? first.error : first?.error?.message) || first?.message || first?.base_resp?.status_msg || body
  } catch { /* plain text */ }
  if (res.status === 401 || res.status === 403) return new Error(`${what} didn't accept the API key. Check it in Settings → Models and services.`)
  if (res.status === 402) return new Error(`${what} says the account is out of credit.`)
  if (res.status === 429) return new Error(`${what} is rate-limiting or out of quota. Try again shortly.`)
  return new Error(`${what} failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ''}`)
}

const bytes = (base64: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))

// ---- Gemini ---------------------------------------------------------------------------------

export const GEMINI_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts']
/** Gemini's prebuilt voices. */
export const GEMINI_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina',
  'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
]

/** 16-bit mono PCM as a WAV file, for a reply that arrives without a header. */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(44 + pcm.length)
  const view = new DataView(out.buffer)
  const text = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, 36 + pcm.length, true); text(8, 'WAVE')
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  text(36, 'data'); view.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

/** The audio in a Gemini reply, wherever the response shape keeps it: `{ data, mime_type | mimeType }`. */
export function geminiAudioOf(reply: unknown): { data: string; mime: string } | undefined {
  const seen = new Set<unknown>()
  const visit = (node: unknown): { data: string; mime: string } | undefined => {
    if (!node || typeof node !== 'object' || seen.has(node)) return undefined
    seen.add(node)
    const n = node as Record<string, unknown>
    const mime = (typeof n.mime_type === 'string' && n.mime_type) || (typeof n.mimeType === 'string' && n.mimeType) || ''
    if (typeof n.data === 'string' && n.data.length > 64 && (!mime || /audio|wav|pcm|l16/i.test(mime))) return { data: n.data, mime: mime || 'audio/wav' }
    for (const child of Object.values(n)) {
      const found = visit(child)
      if (found) return found
    }
    return undefined
  }
  return visit(reply)
}

export async function speakGemini(keySaved: boolean, model: string, voice: string, text: string, secret: SecretName = 'geminiApiKey', signal?: AbortSignal): Promise<Blob> {
  if (!keySaved) throw new Error('Gemini needs its API key (Settings → Models and services).')
  const res = await relayFetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    secret,
    auth: 'header:x-goog-api-key',
    signal,
    body: JSON.stringify({
      model: model || GEMINI_TTS_MODELS[0],
      input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: voice || 'Kore' }] },
    }),
  })
  if (!res.ok) throw await failure(res, 'Gemini')
  const audio = geminiAudioOf(await res.json())
  if (!audio) throw new Error('Gemini answered without audio. The text may have been blocked; try rephrasing.')
  const raw = bytes(audio.data)
  // WAV arrives with its header; raw PCM (L16) gets one.
  const wav = /pcm|l16/i.test(audio.mime) ? pcmToWav(raw) : raw
  return new Blob([wav], { type: 'audio/wav' })
}

// ---- Fish Audio -----------------------------------------------------------------------------

export const FISH_MODELS = ['s2.1-pro', 's2-pro', 's1', 's2.1-pro-free']

export async function speakFishAudio(keySaved: boolean, model: string, voice: string, text: string, speed: number | undefined, secret: SecretName, signal?: AbortSignal): Promise<Blob> {
  if (!keySaved) throw new Error('Fish Audio needs its API key (Settings → Models and services).')
  const res = await relayFetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', model: model || FISH_MODELS[0] },
    secret,
    auth: 'bearer',
    signal,
    body: JSON.stringify({ text, ...(voice ? { reference_id: voice } : {}), format: 'mp3', ...(speed && speed !== 1 ? { prosody: { speed } } : {}) }),
  })
  if (!res.ok) throw await failure(res, 'Fish Audio')
  return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' })
}

/** The account's own Fish Audio voices, then the most used public ones. */
export async function listFishVoices(keySaved: boolean, secret: SecretName): Promise<{ id: string; label: string }[]> {
  if (!keySaved) return []
  const list = async (query: string) => {
    const res = await relayFetch(`https://api.fish.audio/model?${query}`, { secret, auth: 'bearer' })
    if (!res.ok) return []
    const body = await res.json() as { items?: { _id?: string; title?: string }[] }
    return (body.items ?? []).filter((m) => m._id && m.title).map((m) => ({ id: m._id!, label: m.title! }))
  }
  const [own, popular] = await Promise.all([list('self=true&page_size=100'), list('page_size=50&sort_by=task_count')])
  return [...own.map((v) => ({ ...v, label: `${v.label} (yours)` })), ...popular.filter((p) => !own.some((o) => o.id === p.id))]
}

// ---- MiniMax --------------------------------------------------------------------------------

export const MINIMAX_MODELS = ['speech-2.8-hd', 'speech-2.8-turbo', 'speech-2.6-hd', 'speech-2.6-turbo', 'speech-02-hd', 'speech-02-turbo']
export const MINIMAX_VOICES = ['English_Graceful_Lady', 'English_Insightful_Speaker', 'English_radiant_girl', 'Japanese_Whisper_Belle']

/** MiniMax's system voices and the account's own cloned and designed ones; the examples when it can't be asked. */
export async function listMiniMaxVoices(keySaved: boolean, secret: SecretName): Promise<{ id: string; label: string }[]> {
  const examples = MINIMAX_VOICES.map((id) => ({ id, label: id.replace(/_/g, ' ') }))
  if (!keySaved) return examples
  const res = await relayFetch('https://api.minimax.io/v1/get_voice', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, secret, auth: 'bearer', body: JSON.stringify({ voice_type: 'all' }),
  }).catch(() => undefined)
  if (!res?.ok) return examples
  type Entry = { voice_id?: string; voice_name?: string }
  const body = await res.json().catch(() => null) as { system_voice?: Entry[]; voice_cloning?: Entry[]; voice_generation?: Entry[] } | null
  const pick = (list: Entry[] | undefined, suffix = '') => (list ?? []).filter((v) => v.voice_id).map((v) => ({ id: v.voice_id!, label: `${v.voice_name || v.voice_id}${suffix}` }))
  const voices = [...pick(body?.voice_cloning, ' (yours)'), ...pick(body?.voice_generation, ' (yours)'), ...pick(body?.system_voice)]
  return voices.length ? voices : examples
}

export async function speakMiniMax(keySaved: boolean, model: string, voice: string, text: string, speed: number | undefined, secret: SecretName, signal?: AbortSignal): Promise<Blob> {
  if (!keySaved) throw new Error('MiniMax needs its API key (Settings → Models and services).')
  const res = await relayFetch('https://api.minimax.io/v1/t2a_v2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    secret,
    auth: 'bearer',
    signal,
    body: JSON.stringify({
      model: model || MINIMAX_MODELS[0],
      text,
      stream: false,
      output_format: 'hex',
      voice_setting: { voice_id: voice || MINIMAX_VOICES[0], speed: speed ?? 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
    }),
  })
  if (!res.ok) throw await failure(res, 'MiniMax')
  const body = await res.json() as { data?: { audio?: string }; base_resp?: { status_code?: number; status_msg?: string } }
  if (body.base_resp?.status_code) throw new Error(`MiniMax failed: ${body.base_resp.status_msg ?? body.base_resp.status_code}`)
  const hex = body.data?.audio
  if (!hex) throw new Error('MiniMax answered without audio.')
  return new Blob([Uint8Array.from(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)))], { type: 'audio/mpeg' })
}

// ---- NovelAI --------------------------------------------------------------------------------

/** NovelAI's named voice seeds (v2). Any other seed, or a blend like `Aini+Ogma`, works too. */
export const NOVELAI_VOICES = ['Ligeia', 'Aini', 'Orea', 'Claea', 'Lim', 'Aurae', 'Naia', 'Aulon', 'Elei', 'Ogma', 'Raid', 'Pega', 'Lam']

export async function speakNovelAI(keySaved: boolean, voice: string, text: string, secret: SecretName, signal?: AbortSignal): Promise<Blob> {
  if (!keySaved) throw new Error('NovelAI needs its API key (Settings → Models and services).')
  // One request takes at most 1000 characters.
  const query = new URLSearchParams({ text: text.slice(0, 1000), voice: '-1', seed: voice || NOVELAI_VOICES[0], opus: 'false', version: 'v2' })
  const res = await relayFetch(`https://api.novelai.net/ai/generate-voice?${query}`, { headers: { Accept: 'audio/mpeg' }, secret, auth: 'bearer', signal })
  if (!res.ok) throw await failure(res, 'NovelAI')
  return new Blob([await res.arrayBuffer()], { type: 'audio/mpeg' })
}

// ---- AllTalk --------------------------------------------------------------------------------

export async function speakAllTalk(baseUrl: string, voice: string, text: string, speed: number | undefined, signal?: AbortSignal): Promise<Blob> {
  if (!baseUrl) throw new Error('Set AllTalk\'s address (Settings → Models and services).')
  const base = baseUrl.replace(/\/+$/, '')
  const form = new URLSearchParams({ text_input: text, text_filtering: 'standard', narrator_enabled: 'false', output_file_name: 'lost_tales', output_file_timestamp: 'true', autoplay: 'false' })
  if (voice) form.set('character_voice_gen', voice)
  if (speed && speed !== 1) form.set('speed', String(speed))
  const res = await relayFetch(`${base}/api/tts-generate`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(), signal })
  if (!res.ok) throw await failure(res, 'AllTalk')
  const body = await res.json() as { status?: string; output_file_url?: string }
  if (body.status !== 'generate-success' || !body.output_file_url) throw new Error(`AllTalk couldn't generate it${body.status ? ` (${body.status})` : ''}.`)
  // The file's address is relative to the server.
  const audio = await relayFetch(/^https?:/.test(body.output_file_url) ? body.output_file_url : `${base}${body.output_file_url}`, { signal })
  if (!audio.ok) throw await failure(audio, 'AllTalk')
  return new Blob([await audio.arrayBuffer()], { type: audio.headers.get('content-type') || 'audio/wav' })
}

export async function listAllTalkVoices(baseUrl: string): Promise<{ id: string; label: string }[]> {
  if (!baseUrl) return []
  const res = await relayFetch(`${baseUrl.replace(/\/+$/, '')}/api/voices`).catch(() => undefined)
  if (!res?.ok) return []
  const body = await res.json().catch(() => null) as { voices?: unknown[] } | null
  return (body?.voices ?? []).filter((v): v is string => typeof v === 'string').map((v) => ({ id: v, label: v.replace(/\.wav$/i, '') }))
}

// ---- Edge -----------------------------------------------------------------------------------

/** Through the app's own server (`server/edgeTts.ts`): Microsoft's service only answers a server. */
export async function speakEdge(voice: string, text: string, speed: number | undefined, signal?: AbortSignal): Promise<Blob> {
  const res = await relayFetch('/api/tts/edge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice: voice || undefined, speed }),
    signal,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `Edge TTS failed (${res.status})`)
  }
  return res.blob()
}

export async function listEdgeVoices(): Promise<{ id: string; label: string }[]> {
  const res = await relayFetch('/api/tts/edge/voices').catch(() => undefined)
  if (!res?.ok) return []
  const voices = await res.json() as { id: string; label: string; locale: string; gender: string }[]
  return voices.map((v) => ({ id: v.id, label: `${v.label} · ${v.locale} · ${v.gender}` }))
}
