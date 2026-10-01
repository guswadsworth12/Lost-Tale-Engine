import { describe, expect, it } from 'vitest'
import { adoptLegacyText, migrateToServices, type PreServiceSettings } from './servicesMigration'

const base = {
  chatBackend: 'koboldcpp', baseUrl: 'http://127.0.0.1:5001', chatBackendBaseUrl: '', chatBackendModel: '',
  imageBackend: 'a1111', imageBackendBaseUrl: '', imageBackendUsername: '', imageBackendModel: '',
  ttsProvider: 'luxtts', ttsBaseUrl: '', ttsRegion: '', ttsModel: '',
} satisfies PreServiceSettings

describe('moving to services', () => {
  it('turns a local setup into services, skipping an image backend never set up', () => {
    const { settings, keyMoves } = migrateToServices(base, {})
    expect(settings.services).toEqual([
      { id: 'koboldcpp', name: 'KoboldCpp', kind: 'koboldcpp', baseUrl: 'http://127.0.0.1:5001' },
      { id: 'luxtts-your-voice-server', name: 'LuxTTS (your voice server)', kind: 'luxtts' },
    ])
    expect(settings.textModel).toEqual({ serviceId: 'koboldcpp', model: '' })
    expect(settings.imageModel).toBeUndefined()
    expect(settings.voiceModel).toEqual({ serviceId: 'luxtts-your-voice-server', model: '' })
    expect(keyMoves).toEqual([])
  })

  it('makes one OpenAI service out of chat, images and voice, moving the key once and never over a saved one', () => {
    const old: PreServiceSettings = {
      ...base,
      chatBackend: 'openai-compatible', chatBackendBaseUrl: 'https://api.openai.com/v1', chatBackendModel: 'gpt-4o',
      imageBackend: 'openai-image', imageBackendModel: 'gpt-image-2',
      ttsProvider: 'openai-compatible', ttsBaseUrl: 'https://api.openai.com', ttsModel: 'tts-1',
    }
    const moved = migrateToServices(old, { chatBackendApiKey: true, ttsApiKey: true })
    expect(moved.settings.services).toEqual([{ id: 'openai', name: 'OpenAI', kind: 'openai' }])
    expect(moved.settings).toMatchObject({ textModel: { serviceId: 'openai', model: 'gpt-4o' }, imageModel: { serviceId: 'openai', model: 'gpt-image-2' }, voiceModel: { serviceId: 'openai', model: 'tts-1' } })
    expect(moved.keyMoves).toEqual([{ from: 'chatBackendApiKey', to: 'openaiApiKey' }])
    // The OpenAI key saved for images already: nothing moves over it.
    expect(migrateToServices(old, { chatBackendApiKey: true, openaiApiKey: true }).keyMoves).toEqual([])
  })

  it('names an OpenAI-compatible service after its known provider, and gives it its own key', () => {
    const { settings, keyMoves } = migrateToServices({ ...base, chatBackend: 'openai-compatible', chatBackendBaseUrl: 'https://openrouter.ai/api/v1/', chatBackendModel: 'anthropic/claude' }, { chatBackendApiKey: true })
    expect(settings.services[0]).toEqual({ id: 'openrouter', name: 'OpenRouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1' })
    expect(keyMoves).toEqual([{ from: 'chatBackendApiKey', to: 'service:openrouter' }])
  })

  it('shares one NovelAI service for text and images, and keeps a local image server\'s password with it', () => {
    const nai = migrateToServices({ ...base, chatBackend: 'novelai', chatBackendModel: 'kayra-v1', imageBackend: 'novelai-image', imageBackendModel: 'nai-diffusion-4-5-full' }, { chatBackendApiKey: true, imageBackendPassword: true })
    expect(nai.settings.services.filter((s) => s.kind === 'novelai')).toHaveLength(1)
    expect(nai.keyMoves).toEqual([{ from: 'chatBackendApiKey', to: 'service:novelai' }])
    const a1111 = migrateToServices({ ...base, imageBackendBaseUrl: 'http://127.0.0.1:7860', imageBackendUsername: 'me' }, { imageBackendPassword: true })
    expect(a1111.settings.services).toContainEqual({ id: 'automatic1111-forge', name: 'Automatic1111 / Forge', kind: 'a1111', baseUrl: 'http://127.0.0.1:7860', username: 'me' })
    expect(a1111.keyMoves).toEqual([{ from: 'imageBackendPassword', to: 'service:automatic1111-forge' }])
  })

  it('carries over this branch\'s earlier connections and job choices', () => {
    const { settings } = migrateToServices({
      ...base,
      connections: [{ id: 'gemini', name: 'Gemini', kind: 'gemini', baseUrl: '', model: 'gemini-2.5-pro' }],
      modelJobs: { gm: { connectionId: 'gemini' }, images: { connectionId: 'gemini', model: 'gemini-2.5-flash' }, story: { connectionId: 'main' } },
    }, {})
    expect(settings.modelJobs).toEqual({
      story: { serviceId: 'koboldcpp', model: '' },
      gm: { serviceId: 'gemini', model: 'gemini-2.5-pro' },
      images: { serviceId: 'gemini', model: 'gemini-2.5-flash' },
    })
  })

  it('adopts a first-run text choice as the Text model, reusing a matching service', () => {
    const services = [{ id: 'openai', name: 'OpenAI', kind: 'openai' as const }, { id: 'koboldcpp', name: 'KoboldCpp', kind: 'koboldcpp' as const, baseUrl: 'http://127.0.0.1:5001' }]
    expect(adoptLegacyText({ ...base, chatBackend: 'openai-compatible', chatBackendBaseUrl: 'https://api.openai.com/v1', chatBackendModel: 'gpt-4o', services }))
      .toEqual({ services, textModel: { serviceId: 'openai', model: 'gpt-4o' } })
    // KoboldCpp found at another address: the same service, moved.
    const moved = adoptLegacyText({ ...base, baseUrl: 'http://192.168.1.5:5001', services, textModel: { serviceId: 'koboldcpp', model: '' } })
    expect(moved?.services).toEqual([services[0], { ...services[1], baseUrl: 'http://192.168.1.5:5001' }])
    // A new provider is added once.
    const groq = adoptLegacyText({ ...base, chatBackend: 'openai-compatible', chatBackendBaseUrl: 'https://api.groq.com/openai/v1', chatBackendModel: 'llama', services })
    expect(groq?.services[groq.services.length - 1]).toEqual({ id: 'groq', name: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' })
    // Not complete yet: nothing is made.
    expect(adoptLegacyText({ ...base, chatBackend: 'openai-compatible', chatBackendBaseUrl: '', services })).toBeUndefined()
  })
})
