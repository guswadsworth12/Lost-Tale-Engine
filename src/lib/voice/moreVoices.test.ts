import { afterEach, describe, expect, it, vi } from 'vitest'
import { geminiAudioOf, pcmToWav } from './moreVoices'
import { listVoices, synthesizeSpeech } from './ttsProviders'
import { stubRelayedFetch } from '../api/relayTestUtils'

afterEach(() => vi.unstubAllGlobals())

const audioBytes = (n = 100) => Uint8Array.from({ length: n }, (_, i) => i % 256)
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const audio = (type = 'audio/mpeg') => new Response(audioBytes(), { status: 200, headers: { 'content-type': type } })
const head = async (blob: Blob, n = 4) => new TextDecoder().decode((await blob.arrayBuffer()).slice(0, n))

describe('Gemini', () => {
  const reply = (mime: string) => json(200, { id: 'x', steps: [{ type: 'model_output', content: [{ type: 'audio', data: base64(audioBytes()), mime_type: mime }] }] })

  it('asks the interactions API for one voice, with the Gemini key in its header', async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply('audio/wav'))
    stubRelayedFetch(fetchMock)
    const blob = await synthesizeSpeech({ provider: 'gemini', keySaved: true, secret: 'geminiApiKey', model: 'gemini-3.8-flash-tts', voice: 'Puck' }, ' Hello there. ', '')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(init.relay).toEqual({ secret: 'geminiApiKey', auth: 'header:x-goog-api-key', username: null })
    expect(JSON.parse(init.body)).toEqual({
      model: 'gemini-3.8-flash-tts',
      input: [{ type: 'user_input', content: [{ type: 'text', text: 'Hello there.' }] }],
      response_format: { type: 'audio', mime_type: 'audio/wav', sample_rate: 24000 },
      generation_config: { speech_config: [{ voice: 'Puck' }] },
    })
    expect(blob.type).toBe('audio/wav')
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(audioBytes())
  })

  it('gives raw PCM a WAV header so the browser can play it', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(reply('audio/L16;codec=pcm;rate=24000')))
    const blob = await synthesizeSpeech({ provider: 'gemini', keySaved: true, voice: '' }, 'Hi', '')
    expect(await head(blob)).toBe('RIFF')
    expect(blob.size).toBe(44 + 100)
  })

  it('says so when the reply has no audio (blocked text)', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(json(200, { steps: [{ content: [{ type: 'text', text: 'no' }] }] })))
    await expect(synthesizeSpeech({ provider: 'gemini', keySaved: true, voice: 'Kore' }, 'Hi', '')).rejects.toThrow('without audio')
  })

  it('turns a quota error into an actionable message', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(json(429, { error: { message: 'Resource exhausted' } })))
    await expect(synthesizeSpeech({ provider: 'gemini', keySaved: true, voice: 'Kore' }, 'Hi', '')).rejects.toThrow('rate-limiting or out of quota')
  })

  it('sends nothing for empty text or without a key', async () => {
    const fetchMock = vi.fn()
    stubRelayedFetch(fetchMock)
    await expect(synthesizeSpeech({ provider: 'gemini', keySaved: true, voice: 'Kore' }, '  ', '')).rejects.toThrow('Nothing to speak')
    await expect(synthesizeSpeech({ provider: 'gemini', keySaved: false, voice: 'Kore' }, 'Hi', '')).rejects.toThrow('needs its API key')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes the stop signal through, so a stopped line is cancelled', async () => {
    const controller = new AbortController()
    const fetchMock = vi.fn((_url: string, init: { signal?: AbortSignal | null }) => new Promise<Response>((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    stubRelayedFetch(fetchMock)
    const speaking = synthesizeSpeech({ provider: 'gemini', keySaved: true, voice: 'Kore' }, 'Hi', '', controller.signal)
    controller.abort()
    await expect(speaking).rejects.toThrow('Aborted')
  })

  it('finds the audio wherever the reply keeps it', () => {
    const data = base64(audioBytes())
    expect(geminiAudioOf({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/pcm', data } }] } }] })).toEqual({ data, mime: 'audio/pcm' })
    expect(geminiAudioOf({ steps: [] })).toBeUndefined()
  })

  it('writes a valid 24 kHz mono 16-bit WAV header', () => {
    const wav = pcmToWav(new Uint8Array(10))
    const view = new DataView(wav.buffer)
    expect(view.getUint32(24, true)).toBe(24000)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(10)
  })
})

describe('Fish Audio', () => {
  it('names the engine in a model header and the voice as reference_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audio())
    stubRelayedFetch(fetchMock)
    const blob = await synthesizeSpeech({ provider: 'fishaudio', keySaved: true, secret: 'service:fish', model: 's2-pro', voice: 'abc123', speed: 1.2 }, 'Hi', '')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.fish.audio/v1/tts')
    expect(init.headers.model).toBe('s2-pro')
    expect(init.relay).toEqual({ secret: 'service:fish', auth: 'bearer', username: null })
    expect(JSON.parse(init.body)).toEqual({ text: 'Hi', reference_id: 'abc123', format: 'mp3', prosody: { speed: 1.2 } })
    expect(blob.type).toBe('audio/mpeg')
  })

  it('reports a refused key plainly', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(json(401, { message: 'Invalid token' })))
    await expect(synthesizeSpeech({ provider: 'fishaudio', keySaved: true, secret: 'service:fish', voice: '' }, 'Hi', '')).rejects.toThrow("Fish Audio didn't accept the API key")
  })

  it('lists the account\'s own voices first, without repeating them among the popular ones', async () => {
    stubRelayedFetch(vi.fn(async (url: string) => json(200, {
      items: url.includes('self=true') ? [{ _id: 'mine', title: 'Ferro' }] : [{ _id: 'mine', title: 'Ferro' }, { _id: 'pop', title: 'Narrator' }],
    })))
    const list = await listVoices({ provider: 'fishaudio', secret: 'service:fish' }, true)
    expect(list).toEqual({ voices: [{ id: 'mine', label: 'Ferro (yours)' }, { id: 'pop', label: 'Narrator' }], typable: true })
  })
})

describe('MiniMax', () => {
  it('asks for hex MP3 and decodes it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { data: { audio: '49443303' }, base_resp: { status_code: 0, status_msg: 'success' } }))
    stubRelayedFetch(fetchMock)
    const blob = await synthesizeSpeech({ provider: 'minimax', keySaved: true, secret: 'service:minimax', model: '', voice: 'English_Graceful_Lady' }, 'Hi', '')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.minimax.io/v1/t2a_v2')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ model: 'speech-2.8-hd', text: 'Hi', stream: false, output_format: 'hex', voice_setting: { voice_id: 'English_Graceful_Lady', speed: 1 } })
    expect(await head(blob, 3)).toBe('ID3')
  })

  it('reports an error MiniMax returns with a 200', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(json(200, { base_resp: { status_code: 1004, status_msg: 'authentication failed' } })))
    await expect(synthesizeSpeech({ provider: 'minimax', keySaved: true, secret: 'service:minimax', voice: '' }, 'Hi', '')).rejects.toThrow('authentication failed')
  })
})

describe('NovelAI', () => {
  it('asks for the voice seed as MP3, at most 1000 characters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audio())
    stubRelayedFetch(fetchMock)
    await synthesizeSpeech({ provider: 'novelai', keySaved: true, secret: 'service:novelai', voice: 'Aini+Ogma' }, 'x'.repeat(1500), '')
    const [url, init] = fetchMock.mock.calls[0]
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe('https://api.novelai.net/ai/generate-voice')
    expect(parsed.searchParams.get('seed')).toBe('Aini+Ogma')
    expect(parsed.searchParams.get('version')).toBe('v2')
    expect(parsed.searchParams.get('text')).toHaveLength(1000)
    expect(init.relay).toEqual({ secret: 'service:novelai', auth: 'bearer', username: null })
  })
})

describe('AllTalk', () => {
  it('generates, then fetches the file from the address it gives back', async () => {
    const fetchMock = vi.fn(async (url: string) => url.endsWith('/api/tts-generate')
      ? json(200, { status: 'generate-success', output_file_url: '/audio/lost_tales_1.wav' })
      : audio('audio/wav'))
    stubRelayedFetch(fetchMock)
    const blob = await synthesizeSpeech({ provider: 'alltalk', baseUrl: 'http://127.0.0.1:7851/', voice: 'female_01.wav' }, 'Hi', '')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toBe('http://127.0.0.1:7851/api/tts-generate')
    const form = new URLSearchParams(init.body)
    expect(form.get('text_input')).toBe('Hi')
    expect(form.get('character_voice_gen')).toBe('female_01.wav')
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:7851/audio/lost_tales_1.wav')
    expect(blob.type).toBe('audio/wav')
  })

  it('says so when AllTalk could not generate', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(json(200, { status: 'generate-failure' })))
    await expect(synthesizeSpeech({ provider: 'alltalk', baseUrl: 'http://127.0.0.1:7851', voice: '' }, 'Hi', '')).rejects.toThrow('generate-failure')
  })
})

describe('Edge', () => {
  it('goes to this app\'s own server, never the relay', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audio())
    stubRelayedFetch(fetchMock)
    await synthesizeSpeech({ provider: 'edge', voice: 'en-GB-SoniaNeural', speed: 1.1 }, 'Hi', '')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/tts/edge')
    expect(init.relay).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({ text: 'Hi', voice: 'en-GB-SoniaNeural', speed: 1.1 })
  })

  it('shows the server\'s error', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(json(502, { error: "Could not reach Microsoft's voice list." })))
    await expect(synthesizeSpeech({ provider: 'edge', voice: '' }, 'Hi', '')).rejects.toThrow("Could not reach Microsoft's voice list.")
  })

  it('labels voices with their language and gender', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(json(200, [{ id: 'en-US-AriaNeural', label: 'Aria', locale: 'en-US', gender: 'Female' }])))
    expect(await listVoices({ provider: 'edge' }, false)).toEqual({ voices: [{ id: 'en-US-AriaNeural', label: 'Aria · en-US · Female' }], typable: false })
  })
})

describe('Kokoro and other OpenAI-compatible voice servers', () => {
  it('accepts an address that already ends in /v1', async () => {
    const fetchMock = vi.fn().mockResolvedValue(audio())
    stubRelayedFetch(fetchMock)
    await synthesizeSpeech({ provider: 'openai-compatible', baseUrl: 'http://localhost:8880/v1', voice: 'af_bella' }, 'Hi', '')
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8880/v1/audio/speech')
  })

  it('lists Kokoro\'s voices', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { voices: ['af_bella', 'am_adam'] }))
    stubRelayedFetch(fetchMock)
    const list = await listVoices({ provider: 'openai-compatible', baseUrl: 'http://localhost:8880/v1' }, false)
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8880/v1/audio/voices')
    expect(list.voices.map((v) => v.id)).toEqual(['af_bella', 'am_adam'])
  })
})

describe('listVoices', () => {
  it('lists Gemini\'s voices without asking anyone', async () => {
    const fetchMock = vi.fn()
    stubRelayedFetch(fetchMock)
    const list = await listVoices({ provider: 'gemini', secret: 'geminiApiKey' }, true)
    expect(list.voices).toHaveLength(30)
    expect(list.typable).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still lets a voice be typed when the list can\'t be loaded', async () => {
    stubRelayedFetch(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    expect(await listVoices({ provider: 'elevenlabs', secret: 'service:eleven' }, true)).toEqual({ voices: [], typable: true })
  })
})
