import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

const state = {
  services: [
    { id: 'openai', name: 'OpenAI', kind: 'openai' },
    { id: 'groq', name: 'Groq', kind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', models: { text: ['llama-3.3-70b', 'mixtral'] } },
    { id: 'elevenlabs', name: 'ElevenLabs', kind: 'elevenlabs' },
  ],
  textModel: { serviceId: 'groq', model: 'llama-3.3-70b' },
  imageModel: { serviceId: 'openai', model: 'gpt-image-2' },
  voiceModel: null,
  modelJobs: { gm: { serviceId: 'openai', model: 'gpt-4o' } },
  imageBackendQuality: '',
  instructTemplateId: 'chatml',
  addService: () => {}, updateService: () => {}, removeService: () => {}, setModelChoice: () => {}, setModelJob: () => {},
  setImageBackendConfig: () => {}, setInstructTemplateId: () => {},
}
vi.mock('@/lib/store/useSettingsStore', () => ({
  useSettingsStore: Object.assign((select?: (s: typeof state) => unknown) => (select ? select(state) : state), { getState: () => state }),
}))

const { ModelsAndServicesSettings } = await import('./ModelsAndServicesSettings')

describe('Settings → Models and services', () => {
  it('lists each service once with what it offers, and picks models from them', () => {
    const html = renderToStaticMarkup(createElement(ModelsAndServicesSettings))
    // Services: once each, with what they offer and whether a key is needed.
    expect(html.match(/<button aria-expanded="false" class="flex w-full items-center gap-2 p-3/g)).toHaveLength(3)
    expect(html).toContain('api.groq.com/openai/v1')
    expect(html).toContain('Needs a key')
    // Models: the Text model from Groq's loaded list, images from OpenAI with its quality, and a job of its own.
    expect(html).toMatch(/<option value="groq" selected="">Groq<\/option>/)
    expect(html).toMatch(/<option value="llama-3.3-70b" selected="">llama-3.3-70b<\/option>/)
    expect(html).toMatch(/<option value="gpt-image-2" selected="">gpt-image-2<\/option>/)
    expect(html).toContain('Quality: the model&#x27;s default')
    expect(html).toContain('Use a different text model for a job')
    expect(html).toContain('· 1 set')
    // A voice-only service isn't offered for text.
    const textServices = html.match(/aria-label="Text model: service"[^>]*>(.*?)<\/select>/)?.[1] ?? ''
    expect(textServices).toContain('value="groq"')
    expect(textServices).not.toContain('value="elevenlabs"')
  })
})

describe('picking a model', () => {
  it('picks the service first, then one of its models, the chosen one always listed', async () => {
    const { ModelPicker } = await import('./ModelPicker')
    const html = renderToStaticMarkup(createElement(ModelPicker, { capability: 'text', value: { serviceId: 'openai', model: 'gpt-4.1' }, onChange: () => {} }))
    expect(html).toMatch(/<option value="openai" selected="">OpenAI<\/option>/)
    expect(html).toMatch(/<option value="gpt-4.1" selected="">gpt-4.1<\/option>/)
    // Only this service's models: none of Groq's.
    expect(html).not.toContain('llama-3.3-70b')
    expect(html).not.toContain('Type a model name')
    // A service set but no model yet asks for one.
    const blank = renderToStaticMarkup(createElement(ModelPicker, { capability: 'text', value: { serviceId: 'openai', model: '' }, onChange: () => {} }))
    expect(blank).toMatch(/<option value="" disabled="" selected="">Choose a model<\/option>/)
    // "None of my own" sits with the services.
    const none = renderToStaticMarkup(createElement(ModelPicker, { capability: 'text', value: null, emptyLabel: 'Same as Story replies', onChange: () => {} }))
    expect(none).toMatch(/<option value="" selected="">Same as Story replies<\/option>/)
    expect(none.match(/<select/g)).toHaveLength(1)
  })
})
