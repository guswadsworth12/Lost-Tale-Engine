import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from './useSettingsStore'

describe('services in the settings store', () => {
  beforeEach(() => useSettingsStore.setState(useSettingsStore.getInitialState(), true))

  it('writes each model choice through to the fields the chat, image and voice code reads', () => {
    const s = useSettingsStore.getState()
    s.addService({ id: 'openai', name: 'OpenAI', kind: 'openai' })
    s.addService({ id: 'groq', name: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1' })
    useSettingsStore.getState().setModelChoice('text', { serviceId: 'groq', model: 'llama-3.3-70b' })
    useSettingsStore.getState().setModelChoice('images', { serviceId: 'openai', model: 'gpt-image-2' })
    expect(useSettingsStore.getState()).toMatchObject({
      chatBackend: 'openai-compatible', chatBackendBaseUrl: 'https://api.groq.com/openai/v1', chatBackendModel: 'llama-3.3-70b', chatBackendSecret: 'service:groq',
      imageBackend: 'openai-image', imageBackendModel: 'gpt-image-2', imageBackendSecret: 'openaiApiKey',
    })
    // A changed address follows through as well.
    useSettingsStore.getState().updateService('groq', { baseUrl: 'https://example.test/v1' })
    expect(useSettingsStore.getState().chatBackendBaseUrl).toBe('https://example.test/v1')
  })

  it('clears every choice made from a removed service', () => {
    const s = useSettingsStore.getState()
    s.addService({ id: 'gemini', name: 'Gemini', kind: 'gemini' })
    useSettingsStore.getState().setModelChoice('text', { serviceId: 'gemini', model: 'gemini-2.5-pro' })
    useSettingsStore.getState().setModelJob('gm', { serviceId: 'gemini', model: 'gemini-2.5-pro' })
    useSettingsStore.getState().removeService('gemini')
    expect(useSettingsStore.getState()).toMatchObject({ services: [], textModel: null, modelJobs: {} })
  })

  it('takes the one-time move from earlier settings, and marks it done', () => {
    useSettingsStore.getState().applyServices({ services: [{ id: 'koboldcpp', name: 'KoboldCpp', kind: 'koboldcpp', baseUrl: 'http://127.0.0.1:5002' }], textModel: { serviceId: 'koboldcpp', model: '' } })
    expect(useSettingsStore.getState()).toMatchObject({ servicesMigrated: true, chatBackend: 'koboldcpp', baseUrl: 'http://127.0.0.1:5002' })
  })
})
