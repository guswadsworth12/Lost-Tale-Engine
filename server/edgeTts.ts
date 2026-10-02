/**
 * Edge TTS: Microsoft's free neural voices, through the read-aloud service Microsoft Edge uses. That
 * service only answers a server or Edge itself (a browser can't send what it checks), so the app's
 * server speaks for the browser here, as it does for LuxTTS. No key: nothing to store.
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'

const MAX_TEXT = 5000
const VOICE_LIST_TTL_MS = 24 * 60 * 60 * 1000

export class EdgeTtsError extends Error {
  readonly status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

let voiceCache: { at: number; voices: { id: string; label: string; locale: string; gender: string }[] } | undefined

/** Microsoft's voice list, newest a day old at most. */
export async function edgeVoices(): Promise<{ id: string; label: string; locale: string; gender: string }[]> {
  if (voiceCache && Date.now() - voiceCache.at < VOICE_LIST_TTL_MS) return voiceCache.voices
  const tts = new MsEdgeTTS()
  try {
    const voices = (await tts.getVoices()).map((v) => ({
      id: v.ShortName,
      label: v.FriendlyName.replace(/^Microsoft\s+/, '').replace(/\s+Online \(Natural\).*$/, ''),
      locale: v.Locale,
      gender: v.Gender,
    })).sort((a, b) => a.locale.localeCompare(b.locale) || a.id.localeCompare(b.id))
    voiceCache = { at: Date.now(), voices }
    return voices
  } catch {
    throw new EdgeTtsError('Could not reach Microsoft\'s voice list.')
  } finally {
    tts.close()
  }
}

/** One line spoken in `voice` (a ShortName like `en-US-AriaNeural`), as MP3. `speed` is 0.5–2. */
export async function edgeSpeak(input: { text?: unknown; voice?: unknown; speed?: unknown }, signal?: AbortSignal): Promise<{ audio: Buffer; contentType: string }> {
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, MAX_TEXT) : ''
  if (!text) throw new EdgeTtsError('Nothing to say.', 400)
  const voice = typeof input.voice === 'string' && /^[A-Za-z]{2,3}-[A-Za-z0-9-]+Neural$/.test(input.voice) ? input.voice : 'en-US-AriaNeural'
  const speed = typeof input.speed === 'number' && input.speed >= 0.5 && input.speed <= 2 ? input.speed : 1
  const tts = new MsEdgeTTS()
  const stop = () => tts.close()
  signal?.addEventListener('abort', stop, { once: true })
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(escapeXml(text), speed === 1 ? undefined : { rate: speed })
    const chunks: Buffer[] = []
    for await (const chunk of audioStream) chunks.push(Buffer.from(chunk as Buffer))
    const audio = Buffer.concat(chunks)
    if (!audio.length) throw new EdgeTtsError('Microsoft returned no audio. Try another voice.')
    return { audio, contentType: 'audio/mpeg' }
  } catch (e) {
    if (e instanceof EdgeTtsError) throw e
    throw new EdgeTtsError(`Edge TTS failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300))
  } finally {
    signal?.removeEventListener('abort', stop)
    tts.close()
  }
}

/** The text goes inside SSML: anything that would read as markup is escaped. */
function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
