/**
 * Relay to a LuxTTS voice-cloning server (a small FastAPI service: `POST /tts {text, reference,
 * speed}` returns audio; `PUT /references/{name}` stores a reference clip). The browser never sees
 * the server's address or token: they come from `.env` (`LUXTTS_URL`, `LUXTTS_TOKEN`) and every
 * request goes through this app's own API.
 *
 * Voice samples are the user's data, so they live in the data folder (`voice-samples/`), named by
 * content hash like the LuxTTS server names them. A sample is pushed to the server the first time
 * it is used there; a changed sample gets a new hash and is pushed again.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { dataDir } from './db.ts'

export const voiceSamplesDir = path.join(dataDir, 'voice-samples')
const indexPath = path.join(voiceSamplesDir, 'index.json')
const SAMPLE_RE = /^[0-9a-f]{64}\.wav$/
const MAX_SAMPLE_BYTES = 20 * 1024 * 1024

export interface VoiceSample {
  file: string
  label: string
  bytes: number
  addedAt: number
}

function config() {
  return {
    base: (process.env.LUXTTS_URL ?? '').trim().replace(/\/+$/, ''),
    token: (process.env.LUXTTS_TOKEN ?? '').trim(),
    defaultReference: (process.env.LUXTTS_DEFAULT_REFERENCE ?? '').trim(),
  }
}

function call(pathname: string, init: RequestInit = {}, timeoutMs = 180_000) {
  const { base, token } = config()
  return fetch(base + pathname, {
    ...init,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(timeoutMs),
  })
}

function readIndex(): Record<string, { label: string; addedAt: number }> {
  try {
    return JSON.parse(fs.readFileSync(indexPath, 'utf8'))
  } catch {
    return {}
  }
}

export function listVoiceSamples(): VoiceSample[] {
  if (!fs.existsSync(voiceSamplesDir)) return []
  const index = readIndex()
  return fs.readdirSync(voiceSamplesDir)
    .filter((f) => SAMPLE_RE.test(f))
    .map((file) => ({
      file,
      label: index[file]?.label ?? file.slice(0, 12),
      bytes: fs.statSync(path.join(voiceSamplesDir, file)).size,
      addedAt: index[file]?.addedAt ?? 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/** Stores a WAV reference clip (a `data:` URL) under its content hash and labels it. Re-adding the same audio just relabels it. */
export function addVoiceSample(label: unknown, dataUrl: unknown): VoiceSample {
  if (typeof dataUrl !== 'string') throw new Error('Send the sample as a data URL.')
  const match = dataUrl.match(/^data:[^;,]*;base64,(.+)$/s)
  if (!match) throw new Error('Malformed audio data URL.')
  if (Math.floor((match[1].length * 3) / 4) > MAX_SAMPLE_BYTES) throw new Error('Voice sample is too large (max 20MB).')
  const audio = Buffer.from(match[1], 'base64')
  if (audio.length < 44 || audio.toString('latin1', 0, 4) !== 'RIFF' || audio.toString('latin1', 8, 12) !== 'WAVE') {
    throw new Error('Voice samples must be WAV files.')
  }
  const file = `${createHash('sha256').update(audio).digest('hex')}.wav`
  fs.mkdirSync(voiceSamplesDir, { recursive: true })
  fs.writeFileSync(path.join(voiceSamplesDir, file), audio)
  const index = readIndex()
  const clean = typeof label === 'string' && label.trim() ? label.trim().slice(0, 120) : 'Voice sample'
  index[file] = { label: clean, addedAt: index[file]?.addedAt ?? Date.now() }
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2))
  return { file, label: clean, bytes: audio.length, addedAt: index[file].addedAt }
}

export async function luxttsStatus() {
  const { base, defaultReference } = config()
  if (!base) return { configured: false, reachable: false, detail: 'Set LUXTTS_URL (and LUXTTS_TOKEN if your server needs one) in .env, then restart.' }
  try {
    const r = await call('/health', {}, 5_000)
    const health = r.ok ? await r.json().catch(() => null) : null
    return {
      configured: true,
      reachable: r.ok,
      detail: r.ok ? 'Connected' : `LuxTTS answered HTTP ${r.status}`,
      health,
      defaultReference: defaultReference || null,
    }
  } catch (e) {
    return { configured: true, reachable: false, detail: `Can't reach LuxTTS: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Speaks `text` in the voice of `reference` (a sample file), pushing the sample to the server if it hasn't seen it. */
export async function luxttsSpeak(input: { text: unknown; reference?: unknown; speed?: unknown }): Promise<{ audio: Buffer; contentType: string }> {
  const { base, defaultReference } = config()
  if (!base) throw Object.assign(new Error('LuxTTS is not configured. Set LUXTTS_URL in .env.'), { status: 503 })
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, 5000) : ''
  if (!text) throw Object.assign(new Error('Nothing to speak.'), { status: 400 })
  const requested = typeof input.reference === 'string' && input.reference ? input.reference : defaultReference
  if (requested && !SAMPLE_RE.test(requested)) throw Object.assign(new Error('Unknown voice sample.'), { status: 400 })
  const local = requested ? path.join(voiceSamplesDir, requested) : ''
  const speed = Math.max(0.5, Math.min(2, Number(input.speed) || 1))
  const speak = () =>
    call('/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, reference: requested || null, speed }) })
  let r = await speak()
  if (r.status === 404 && requested && fs.existsSync(local)) {
    const put = await call(`/references/${requested}`, { method: 'PUT', headers: { 'content-type': 'audio/wav' }, body: fs.readFileSync(local) })
    if (!put.ok) throw Object.assign(new Error(`LuxTTS rejected the voice sample (HTTP ${put.status}).`), { status: 502 })
    r = await speak()
  }
  if (r.status === 404) throw Object.assign(new Error('No voice sample chosen, and the LuxTTS server has no default voice. Pick a sample in Settings → Voice.'), { status: 502 })
  if (!r.ok) throw Object.assign(new Error(`LuxTTS returned HTTP ${r.status}.`), { status: 502 })
  return { audio: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || 'audio/wav' }
}
