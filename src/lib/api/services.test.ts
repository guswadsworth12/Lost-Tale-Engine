import { describe, expect, it, vi } from 'vitest'
import {
  FallbackBackend, createTextClient, legacyFieldsFor, newServiceId, resolveCharacter, resolveCharacterVoice, resolveJob, serviceSecret, servedByLabel, voiceTarget,
  type Service, type ServiceSettings,
} from './services'
import { KoboldClient } from './kobold'
import { NovelAIClient } from './novelai'
import { OpenAICompatibleClient } from './openaiCompatible'
import type { ChatBackend } from './chatBackend'

const openai: Service = { id: 'openai', name: 'OpenAI', kind: 'openai' }
const gemini: Service = { id: 'gemini', name: 'Gemini', kind: 'gemini' }
const groq: Service = { id: 'groq', name: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' }
const kobold: Service = { id: 'koboldcpp', name: 'KoboldCpp', kind: 'koboldcpp', baseUrl: 'http://127.0.0.1:5001' }
const eleven: Service = { id: 'elevenlabs', name: 'ElevenLabs', kind: 'elevenlabs' }
const settings: ServiceSettings = {
  services: [openai, gemini, groq, kobold, eleven],
  textModel: { serviceId: 'openai', model: 'gpt-4o' },
  modelJobs: { gm: { serviceId: 'gemini', model: 'gemini-2.5-pro' }, memory: { serviceId: 'gone', model: 'x' } },
}

describe('services', () => {
  it('gives a job its own model, the Text model otherwise, and the Text model for one left on a removed service', () => {
    expect(resolveJob('gm', settings)).toEqual({ service: gemini, model: 'gemini-2.5-pro' })
    expect(resolveJob('story', settings)).toEqual({ service: openai, model: 'gpt-4o' })
    expect(resolveJob('memory', settings)).toEqual({ service: openai, model: 'gpt-4o' })
    expect(resolveJob('story', { services: [] })).toBeUndefined()
  })

  it('lets a character reply through a model of their own', () => {
    expect(resolveCharacter({ modelServiceId: 'groq', modelOverride: 'llama-3.3-70b' }, settings)).toEqual({ service: groq, model: 'llama-3.3-70b' })
    expect(resolveCharacter({ modelOverride: 'gpt-5' }, settings)).toEqual({ service: openai, model: 'gpt-5' })
    expect(resolveCharacter({}, settings)).toEqual({ service: openai, model: 'gpt-4o' })
    // A voice-only service can't write their replies.
    expect(resolveCharacter({ modelServiceId: 'elevenlabs' }, settings)).toEqual({ service: openai, model: 'gpt-4o' })
  })

  it('uses one key per service: the provider\'s own for OpenAI and Gemini, its own otherwise, none for local servers', () => {
    expect(serviceSecret(openai)).toBe('openaiApiKey')
    expect(serviceSecret(gemini)).toBe('geminiApiKey')
    expect(serviceSecret({ id: 'om', kind: 'openmayhem' })).toBe('openMayhemApiKey')
    expect(serviceSecret(groq)).toBe('service:groq')
    expect(serviceSecret(eleven)).toBe('service:elevenlabs')
    expect(serviceSecret(kobold)).toBeUndefined()
  })

  it('builds the right text client for each kind', () => {
    expect(createTextClient(kobold, '', {})).toBeInstanceOf(KoboldClient)
    expect(createTextClient({ id: 'nai', name: 'NovelAI', kind: 'novelai' }, 'kayra-v1', {})).toBeInstanceOf(NovelAIClient)
    const client = createTextClient(gemini, 'gemini-2.5-pro', { geminiApiKey: true })
    expect(client).toBeInstanceOf(OpenAICompatibleClient)
    expect((client as OpenAICompatibleClient).baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
  })

  it('writes the chosen models through to the settings the chat, image and voice code reads', () => {
    expect(legacyFieldsFor({ ...settings, imageModel: { serviceId: 'gemini', model: 'gemini-3-pro-image-preview' }, voiceModel: { serviceId: 'elevenlabs', model: '' } })).toEqual({
      chatBackend: 'openai-compatible', chatBackendBaseUrl: 'https://api.openai.com/v1', chatBackendModel: 'gpt-4o', chatBackendSecret: 'openaiApiKey',
      imageBackend: 'gemini-image', imageBackendModel: 'gemini-3-pro-image-preview', imageBackendBaseUrl: '', imageBackendUsername: '', imageBackendSecret: 'geminiApiKey',
      ttsProvider: 'elevenlabs', ttsModel: '', ttsSecret: 'service:elevenlabs', ttsRegion: '',
    })
    const local = legacyFieldsFor({ services: [kobold], textModel: { serviceId: 'koboldcpp', model: '' }, voiceModel: { serviceId: 'koboldcpp', model: '' } })
    expect(local).toMatchObject({ chatBackend: 'koboldcpp', baseUrl: 'http://127.0.0.1:5001', ttsProvider: 'koboldcpp' })
    expect(legacyFieldsFor({ services: [openai], voiceModel: { serviceId: 'openai', model: 'tts-1' } })).toMatchObject({ ttsProvider: 'openai-compatible', ttsBaseUrl: 'https://api.openai.com', ttsSecret: 'openaiApiKey' })
    // Nothing chosen: the long-standing fields are left as they are.
    expect(legacyFieldsFor({ services: [openai] })).toEqual({})
  })

  it('speaks through each new voice service with its own key, address or none', () => {
    const fish: Service = { id: 'fish', name: 'Fish Audio', kind: 'fishaudio' }
    const alltalk: Service = { id: 'alltalk', name: 'AllTalk', kind: 'alltalk', baseUrl: 'http://127.0.0.1:7851' }
    const edge: Service = { id: 'edge', name: 'Edge', kind: 'edge' }
    expect(voiceTarget(gemini)).toEqual({ provider: 'gemini', secret: 'geminiApiKey' })
    expect(voiceTarget(fish)).toEqual({ provider: 'fishaudio', secret: 'service:fish' })
    expect(voiceTarget({ id: 'mm', name: 'MiniMax', kind: 'minimax' })).toEqual({ provider: 'minimax', secret: 'service:mm' })
    expect(voiceTarget({ id: 'nai', name: 'NovelAI', kind: 'novelai' })).toEqual({ provider: 'novelai', secret: 'service:nai' })
    expect(voiceTarget(alltalk)).toEqual({ provider: 'alltalk', baseUrl: 'http://127.0.0.1:7851' })
    expect(voiceTarget(edge)).toEqual({ provider: 'edge', secret: undefined })
    expect(legacyFieldsFor({ services: [alltalk], voiceModel: { serviceId: 'alltalk', model: '' } })).toMatchObject({ ttsProvider: 'alltalk', ttsBaseUrl: 'http://127.0.0.1:7851' })
    expect(legacyFieldsFor({ services: [gemini], voiceModel: { serviceId: 'gemini', model: 'gemini-3.8-flash-tts' } })).toMatchObject({ ttsProvider: 'gemini', ttsModel: 'gemini-3.8-flash-tts', ttsSecret: 'geminiApiKey' })
  })

  it('gives a character their own voice service, and refuses a removed one rather than using another voice', () => {
    const fish: Service = { id: 'fish', name: 'Fish Audio', kind: 'fishaudio' }
    const comfy: Service = { id: 'comfy', name: 'ComfyUI', kind: 'comfyui', baseUrl: 'http://127.0.0.1:8188' }
    const s: ServiceSettings = { services: [gemini, fish, comfy], voiceModel: { serviceId: 'gemini', model: 'gemini-2.5-pro-preview-tts' } }
    expect(resolveCharacterVoice(undefined, s)).toBeUndefined()
    expect(resolveCharacterVoice({}, s)).toBeUndefined()
    // The Voice model's own service keeps its chosen model; another starts on its first.
    expect(resolveCharacterVoice({ serviceId: 'gemini' }, s)).toEqual({ service: gemini, model: 'gemini-2.5-pro-preview-tts' })
    expect(resolveCharacterVoice({ serviceId: 'fish' }, s)).toEqual({ service: fish, model: 's2.1-pro' })
    expect(() => resolveCharacterVoice({ serviceId: 'gone' }, s)).toThrow('voice service has been removed')
    // An image-only service can't speak.
    expect(() => resolveCharacterVoice({ serviceId: 'comfy' }, s)).toThrow('voice service has been removed')
  })

  it('makes short, unique ids', () => {
    expect(newServiceId('Groq (fast)', [])).toBe('groq-fast')
    expect(newServiceId('Groq', ['groq'])).toBe('groq-2')
    expect(newServiceId('!!!', [])).toBe('service')
  })
})

describe('falling back to the Text model', () => {
  const backend = (impl: Partial<ChatBackend>): ChatBackend => ({
    generate: vi.fn(), generateStream: vi.fn(), getEffectiveMaxContext: vi.fn(async () => 32000), tokenCount: vi.fn(async () => ({ count: 1 })),
    abort: vi.fn(async () => {}), getChatTemplate: vi.fn(async () => null), ...impl,
  })

  it('answers from the Text model once when a job\'s service fails, says so, and records it', async () => {
    const onFallback = vi.fn()
    const own = backend({ generate: vi.fn(async () => { throw new Error('429 quota') }) })
    const main = backend({ generate: vi.fn(async () => 'from text model') })
    const job = new FallbackBackend(own, main, onFallback)
    expect(await job.generate({ prompt: 'x' } as never)).toBe('from text model')
    expect(onFallback).toHaveBeenCalledWith(expect.objectContaining({ message: '429 quota' }))
    expect(servedByLabel({ client: job, label: 'Gemini · gemini-2.5-pro', isMain: false })).toBe("Text model (Gemini · gemini-2.5-pro didn't answer)")
    expect(servedByLabel({ client: main, label: 'OpenAI · gpt-4o', isMain: true })).toBeNull()
  })

  it('streams from the Text model after a failed stream, replacing any partial reply', async () => {
    const seen: string[] = []
    const own = backend({ generateStream: vi.fn(async (_p, onToken) => { onToken('par', 'par'); throw new Error('dropped') }) })
    const main = backend({ generateStream: vi.fn(async (_p, onToken) => { onToken('whole', 'whole'); return 'whole' }) })
    expect(await new FallbackBackend(own, main, () => {}).generateStream({ prompt: 'x' } as never, (_t, full) => seen.push(full))).toBe('whole')
    expect(seen).toEqual(['par', 'whole'])
  })

  it('never retries a call the user stopped', async () => {
    const controller = new AbortController()
    controller.abort()
    const main = backend({ generate: vi.fn(async () => 'x') })
    const own = backend({ generate: vi.fn(async () => { throw new DOMException('stopped', 'AbortError') }) })
    await expect(new FallbackBackend(own, main, () => {}).generate({ prompt: 'x' } as never, controller.signal)).rejects.toThrow('stopped')
    expect(main.generate).not.toHaveBeenCalled()
  })
})
