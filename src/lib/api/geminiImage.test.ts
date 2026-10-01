import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageGenError, type ImageGenerateParams } from './imageBackend'
import { GeminiImageClient, geminiAspectRatio, parseGeminiImage } from './geminiImage'
import { stubRelayedFetch } from './relayTestUtils'

const params = (extra: Partial<ImageGenerateParams> = {}): ImageGenerateParams => ({ prompt: 'a lighthouse', width: 1216, height: 832, steps: 28, cfgScale: 7, ...extra })
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response
const reply = (parts: unknown[], finishReason = 'STOP') => json(200, { candidates: [{ finishReason, content: { parts } }] })

afterEach(() => vi.unstubAllGlobals())

describe('Gemini images', () => {
  it('asks for an image in the slot\'s aspect ratio, with references inline and the key in its header', async () => {
    let seen: { url: string; body: Record<string, any>; relay: unknown } | undefined
    stubRelayedFetch((url, init) => {
      seen = { url, body: JSON.parse(init.body as string), relay: init.relay }
      return reply([{ text: 'Here it is.' }, { inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } }])
    })
    const result = await new GeminiImageClient(true, '').generateImage(params({ purpose: 'portrait', referenceImages: [{ base64: 'cmVm', mimeType: 'image/png' }] }))
    expect(result).toEqual({ base64: 'aGVsbG8=', mimeType: 'image/jpeg' })
    expect(seen!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent')
    expect(seen!.relay).toEqual({ secret: 'geminiApiKey', auth: 'header:x-goog-api-key', username: null })
    expect(seen!.body).toEqual({
      contents: [{ parts: [{ text: 'a lighthouse' }, { inlineData: { mimeType: 'image/png', data: 'cmVm' } }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '2:3' } },
    })
  })

  it('labels each reference image with who or what it shows, just before it', async () => {
    let body: Record<string, any> | undefined
    stubRelayedFetch((_url, init) => { body = JSON.parse(init.body as string); return reply([{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }]) })
    await new GeminiImageClient(true, '').generateImage(params({ purpose: 'cg', referenceImages: [
      { base64: 'YQ==', mimeType: 'image/png', name: 'Emily' },
      { base64: 'Yg==', mimeType: 'image/png', name: 'Underground Cistern (location)' },
    ] }))
    expect(body!.contents[0].parts).toEqual([
      { text: 'a lighthouse' },
      { text: 'Reference: Emily' }, { inlineData: { mimeType: 'image/png', data: 'YQ==' } },
      { text: 'Reference: Underground Cistern (location)' }, { inlineData: { mimeType: 'image/png', data: 'Yg==' } },
    ])
  })

  it('maps each slot and shape to a supported aspect ratio', () => {
    expect(geminiAspectRatio({ purpose: 'cg', width: 1, height: 1 })).toBe('3:2')
    expect(geminiAspectRatio({ width: 1920, height: 1080 })).toBe('16:9')
    expect(geminiAspectRatio({ width: 1000, height: 1000 })).toBe('1:1')
  })

  it('reads either spelling of the image part, and says why there is none', () => {
    expect(parseGeminiImage({ candidates: [{ content: { parts: [{ inline_data: { mime_type: 'image/png', data: 'eA==' } }] } }] })).toEqual({ base64: 'eA==', mimeType: 'image/png' })
    expect(() => parseGeminiImage({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })).toThrow(/blocked this prompt \(prohibited content\)/)
    expect(() => parseGeminiImage({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] })).toThrow(/safety filters/)
    expect(() => parseGeminiImage({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'I can only describe that scene.' }] } }] })).toThrow('Gemini answered without an image: "I can only describe that scene."')
  })

  it('says what went wrong, without the key', async () => {
    const cases: [Response, string][] = [
      [json(400, { error: { status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key. AIzaSyA1234567890abcdefghijkl' } }), 'auth'],
      [json(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' } }), 'quota'],
      [json(404, { error: { status: 'NOT_FOUND', message: 'models/x is not found' } }), 'unsupported'],
      [json(400, { error: { status: 'INVALID_ARGUMENT', message: 'Unsupported aspect ratio' } }), 'unsupported'],
      [json(500, {}), 'failed'],
    ]
    for (const [res, kind] of cases) {
      stubRelayedFetch(() => res)
      const error = await new GeminiImageClient(true, '').generateImage(params()).catch((e) => e)
      expect(error).toBeInstanceOf(ImageGenError)
      expect(error.kind).toBe(kind)
      expect(error.message).not.toContain('AIzaSyA1234567890abcdefghijkl')
    }
  })

  it('can\'t make transparent images, needs a key, and stops when cancelled', async () => {
    expect(new GeminiImageClient(true, '').capabilities()).toEqual({ transparency: false, references: true, maxReferences: 3 })
    expect(new GeminiImageClient(true, 'gemini-3-pro-image-preview').capabilities().maxReferences).toBe(14)
    await expect(new GeminiImageClient(false, '').generateImage(params())).rejects.toMatchObject({ kind: 'auth' })
    const controller = new AbortController()
    stubRelayedFetch((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const pending = new GeminiImageClient(true, '').generateImage(params(), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('lists image models, falling back to the known ones', async () => {
    stubRelayedFetch(() => json(200, { models: [
      { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/imagen-4', supportedGenerationMethods: ['predict'] },
    ] }))
    expect(await new GeminiImageClient(true, '').listModels()).toEqual(['gemini-2.5-flash-image'])
    stubRelayedFetch(() => json(500, {}))
    expect(await new GeminiImageClient(true, '').listModels()).toContain('gemini-2.5-flash-image')
  })
})
