import { afterEach, describe, expect, it, vi } from 'vitest'
import { ImageGenError, type ImageGenerateParams } from './imageBackend'
import { OPENAI_IMAGE_MODELS, OpenAIImageClient, openaiImageSize } from './openaiImage'
import { stubRelayedFetch } from './relayTestUtils'

const params = (extra: Partial<ImageGenerateParams> = {}): ImageGenerateParams => ({ prompt: 'a lighthouse', width: 832, height: 1216, steps: 28, cfgScale: 7, ...extra })
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response
const image = json(200, { data: [{ b64_json: 'aGVsbG8=' }] })

afterEach(() => vi.unstubAllGlobals())

describe('OpenAI images', () => {
  it('asks for the slot\'s size, as PNG, with the key attached by the relay', async () => {
    let seen: { url: string; body: Record<string, unknown>; relay: unknown } | undefined
    stubRelayedFetch((url, init) => {
      seen = { url, body: JSON.parse(init.body as string), relay: init.relay }
      return image
    })
    const result = await new OpenAIImageClient(true, '', 'high').generateImage(params({ purpose: 'background' }))
    expect(result).toEqual({ base64: 'aGVsbG8=', mimeType: 'image/png' })
    expect(seen).toEqual({
      url: 'https://api.openai.com/v1/images/generations',
      body: { model: 'gpt-image-2', prompt: 'a lighthouse', size: '1536x1024', quality: 'high', output_format: 'png', n: 1 },
      relay: { secret: 'openaiApiKey', auth: 'bearer', username: null },
    })
  })

  it('maps each slot and shape to a size the model accepts', () => {
    expect(openaiImageSize('gpt-image-1', { purpose: 'sprite', width: 1, height: 1 })).toBe('1024x1536')
    expect(openaiImageSize('gpt-image-1', { purpose: 'cg', width: 1, height: 1 })).toBe('1536x1024')
    expect(openaiImageSize('gpt-image-1', { width: 800, height: 790 })).toBe('1024x1024')
    expect(openaiImageSize('dall-e-3', { purpose: 'portrait', width: 1, height: 1 })).toBe('1024x1792')
  })

  it('makes transparent sprites on gpt-image models, and refuses on dall-e-3 before any request', async () => {
    let body: Record<string, unknown> = {}
    const fetchMock = stubRelayedFetch((_url, init) => { body = JSON.parse(init.body as string); return image })
    await new OpenAIImageClient(true, 'gpt-image-1-mini').generateImage(params({ purpose: 'sprite', transparent: true }))
    expect(body).toMatchObject({ model: 'gpt-image-1-mini', background: 'transparent', output_format: 'png' })
    // Blank model: gpt-image-2, which makes them too.
    await new OpenAIImageClient(true, '').generateImage(params({ purpose: 'sprite', transparent: true }))
    expect(body).toMatchObject({ model: 'gpt-image-2', size: '1024x1536', background: 'transparent', output_format: 'png' })
    // So does any other model that isn't DALL·E.
    expect(new OpenAIImageClient(true, 'chatgpt-image-latest').capabilities()).toEqual({ transparency: true, references: true, maxReferences: 16 })
    const dalle = new OpenAIImageClient(true, 'dall-e-3')
    expect(dalle.capabilities()).toEqual({ transparency: false, references: false, maxReferences: 0 })
    await expect(dalle.generateImage(params({ transparent: true }))).rejects.toMatchObject({ kind: 'unsupported' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends reference images to the edits endpoint as a form', async () => {
    let seen: { url: string; form: FormData } | undefined
    stubRelayedFetch((url, init) => { seen = { url, form: init.body as FormData }; return image })
    await new OpenAIImageClient(true, '').generateImage(params({ purpose: 'portrait', referenceImages: [{ base64: 'aGVsbG8=', mimeType: 'image/png' }] }))
    expect(seen!.url).toBe('https://api.openai.com/v1/images/edits')
    expect(seen!.form.get('size')).toBe('1024x1536')
    const file = seen!.form.getAll('image[]')[0] as Blob
    expect(file.type).toBe('image/png')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new TextEncoder().encode('hello'))
    expect((file as File).name).toBe('image-1-reference.png')
  })

  it('names each reference file after who or what it shows', async () => {
    let form: FormData | undefined
    stubRelayedFetch((_url, init) => { form = init.body as FormData; return image })
    await new OpenAIImageClient(true, '').generateImage(params({ purpose: 'cg', referenceImages: [
      { base64: 'aGVsbG8=', mimeType: 'image/png', name: 'Brisa Vale' },
      { base64: 'aGVsbG8=', mimeType: 'image/jpeg', name: 'Underground Cistern (location)' },
    ] }))
    expect(form!.getAll('image[]').map((f) => (f as File).name)).toEqual(['brisa-vale-reference.png', 'underground-cistern-location-reference.jpg'])
  })

  it('says what went wrong, without the key', async () => {
    const cases: [Response, string, RegExp][] = [
      [json(401, { error: { message: 'Incorrect API key provided: sk-abcdefghijkl1234' } }), 'auth', /did not accept the API key/],
      [json(429, { error: { code: 'insufficient_quota', message: 'quota' } }), 'quota', /out of credit/],
      [json(429, { error: { message: 'Rate limit reached' } }), 'rate', /limiting requests/],
      [json(400, { error: { code: 'moderation_blocked', message: 'blocked by our safety system' } }), 'safety', /safety system declined/],
      [json(400, { error: { code: 'invalid_value', message: "Invalid size 'x' for key sk-abcdefghijkl1234" } }), 'unsupported', /could not use these settings: Invalid size 'x' for key \[key hidden\]/],
      [json(404, { error: { code: 'model_not_found', message: 'nope' } }), 'unsupported', /not available/],
    ]
    for (const [res, kind, text] of cases) {
      stubRelayedFetch(() => res)
      const error = await new OpenAIImageClient(true, '').generateImage(params()).catch((e) => e)
      expect(error).toBeInstanceOf(ImageGenError)
      expect(error).toMatchObject({ kind })
      expect(error.message).toMatch(text)
      expect(error.message).not.toContain('sk-abcdefghijkl1234')
    }
  })

  it('asks for a key before calling, and stops when cancelled', async () => {
    await expect(new OpenAIImageClient(false, '').generateImage(params())).rejects.toMatchObject({ kind: 'auth' })
    const controller = new AbortController()
    stubRelayedFetch((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const pending = new OpenAIImageClient(true, '').generateImage(params(), controller.signal)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('lists the account\'s image models in name order, or every known one when it can\'t', async () => {
    const urls: string[] = []
    stubRelayedFetch((url) => {
      urls.push(url)
      return json(200, { data: [{ id: 'gpt-image-2' }, { id: 'gpt-4o' }, { id: 'dall-e-3' }, { id: 'gpt-image-1.5' }, { id: 'whisper-1' }, { id: 'chatgpt-image-latest' }] })
    })
    expect(await new OpenAIImageClient(true, '').listModels()).toEqual(['chatgpt-image-latest', 'dall-e-3', 'gpt-image-1.5', 'gpt-image-2'])
    expect(urls).toEqual(['https://api.openai.com/v1/models'])
    stubRelayedFetch(() => json(401, {}))
    expect(await new OpenAIImageClient(true, '').listModels()).toEqual(OPENAI_IMAGE_MODELS)
    expect(OPENAI_IMAGE_MODELS).toEqual(expect.arrayContaining(['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5', 'gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']))
  })
})
