import type { ImageBackend, ImageCapabilities, ImageGenerateParams, ImageGenerateResult } from './imageBackend'
import { ImageGenError, nearestShape, redactKeys, referenceFileName } from './imageBackend'
import { relayFetch } from './relay'

/**
 * OpenAI's image models, offered as suggestions until the account's own list is read; any model
 * name can be typed.
 */
/** The gpt-image models take up to 16 input images on an edit. */
export const OPENAI_MAX_REFERENCES = 16

export const OPENAI_IMAGE_MODELS = [
  'chatgpt-image-latest',
  'dall-e-3',
  'gpt-image-1',
  'gpt-image-1-mini',
  'gpt-image-1.5',
  'gpt-image-2',
  'gpt-image-2-2026-04-21',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-flare-2026-09-08',
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-sunburst-2026-09-08',
]
export const OPENAI_IMAGE_DEFAULT_MODEL = 'gpt-image-2'
const API = 'https://api.openai.com/v1/images'

/** Every model but DALL·E takes the gpt-image options: PNG output, transparency, reference images. */
const isGptImage = (model: string) => !/^dall-e/i.test(model)
const isImageModel = (id: string) => /image|^dall-e/i.test(id)

/** Sizes a model accepts. */
function sizesFor(model: string): string[] {
  return /^dall-e-3/i.test(model) ? ['1024x1024', '1024x1792', '1792x1024'] : ['1024x1024', '1024x1536', '1536x1024']
}

/** The size to ask for: portraits and sprites tall, backgrounds and CGs wide, otherwise the nearest shape. */
export function openaiImageSize(model: string, params: Pick<ImageGenerateParams, 'purpose' | 'width' | 'height'>): string {
  const sizes = sizesFor(model)
  if (params.purpose === 'portrait' || params.purpose === 'sprite') return sizes[1]
  if (params.purpose === 'background' || params.purpose === 'cg') return sizes[2]
  return nearestShape(params.width, params.height, sizes)
}

/** A failed response, as the error a person can act on. */
export async function openaiImageError(res: Response): Promise<ImageGenError> {
  let code = ''
  let message = ''
  try {
    const body = await res.json() as { error?: { code?: string; type?: string; message?: string } }
    code = body.error?.code ?? body.error?.type ?? ''
    message = body.error?.message ?? ''
  } catch {
    // Not JSON: the status says enough.
  }
  const detail = redactKeys(message).slice(0, 240)
  if (res.status === 401) return new ImageGenError('auth', 'OpenAI did not accept the API key. Check it in Settings → Images.', 401)
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return new ImageGenError('quota', 'Your OpenAI account is out of credit or over its spending limit.', res.status)
  if (res.status === 429) return new ImageGenError('rate', 'OpenAI is limiting requests right now. Wait a moment and try again.', 429)
  if (code === 'moderation_blocked' || /safety system|content policy/i.test(message)) return new ImageGenError('safety', 'OpenAI\'s safety system declined this prompt. Try rewording it.', res.status)
  if (res.status === 404 || code === 'model_not_found') return new ImageGenError('unsupported', 'That OpenAI model is not available to this account. Pick another in Settings → Images.', res.status)
  if (res.status === 400) return new ImageGenError('unsupported', `OpenAI could not use these settings${detail ? `: ${detail}` : '.'}`, 400)
  return new ImageGenError('failed', `OpenAI image generation failed (${res.status})${detail ? `: ${detail}` : '.'}`, res.status)
}

/**
 * OpenAI's Images API. `/v1/images/generations` from a prompt, or `/v1/images/edits` when reference
 * images are given, so a character's look carries over. The key is attached by the server's relay.
 */
export class OpenAIImageClient implements ImageBackend {
  constructor(
    private keySaved: boolean,
    private model: string,
    /** `auto`, `low`, `medium` or `high` (gpt-image); `standard` or `hd` (dall-e-3). Blank: the default. */
    private quality = '',
  ) {}

  private get modelName(): string {
    return this.model.trim() || OPENAI_IMAGE_DEFAULT_MODEL
  }

  capabilities(model?: string): ImageCapabilities {
    const gpt = isGptImage(model?.trim() || this.modelName)
    return { transparency: gpt, references: gpt, maxReferences: gpt ? OPENAI_MAX_REFERENCES : 0 }
  }

  async generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult> {
    const model = params.model?.trim() || this.modelName
    const gpt = isGptImage(model)
    if (params.transparent && !gpt) throw new ImageGenError('unsupported', `${model} can't make transparent images. Use a gpt-image model for sprites.`)
    if (!this.keySaved) throw new ImageGenError('auth', 'Add an OpenAI API key in Settings → Images first.')
    const size = openaiImageSize(model, params)
    const references = gpt ? params.referenceImages ?? [] : []
    const options: Record<string, string> = {
      model, prompt: params.prompt, size,
      ...(this.quality ? { quality: this.quality } : {}),
      ...(gpt ? { output_format: 'png', ...(params.transparent ? { background: 'transparent' } : {}) } : { response_format: 'b64_json' }),
    }
    let res: Response
    try {
      if (references.length) {
        const form = new FormData()
        for (const [key, value] of Object.entries(options)) form.append(key, value)
        references.slice(0, OPENAI_MAX_REFERENCES).forEach((ref, i) => {
          const bytes = Uint8Array.from(atob(ref.base64), (c) => c.charCodeAt(0))
          form.append('image[]', new Blob([bytes], { type: ref.mimeType }), referenceFileName(ref, i))
        })
        res = await relayFetch(`${API}/edits`, { method: 'POST', body: form, secret: 'openaiApiKey', auth: 'bearer', signal })
      } else {
        res = await relayFetch(`${API}/generations`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...options, n: 1 }),
          secret: 'openaiApiKey', auth: 'bearer', signal,
        })
      }
    } catch (e) {
      if (signal?.aborted) throw e
      throw new ImageGenError('network', 'Could not reach OpenAI.')
    }
    if (!res.ok) throw await openaiImageError(res)
    const body = await res.json() as { data?: { b64_json?: string }[] }
    const base64 = body.data?.[0]?.b64_json
    if (!base64) throw new ImageGenError('failed', 'OpenAI returned no image.')
    return { base64, mimeType: 'image/png' }
  }

  /** The account's image models in name order, or the fixed list when they can't be read. */
  async listModels(): Promise<string[]> {
    if (!this.keySaved) return [...OPENAI_IMAGE_MODELS]
    try {
      const res = await relayFetch('https://api.openai.com/v1/models', { secret: 'openaiApiKey', auth: 'bearer' })
      if (!res.ok) return [...OPENAI_IMAGE_MODELS]
      const body = await res.json() as { data?: { id?: string }[] }
      const found = (body.data ?? []).map((m) => m.id ?? '').filter(isImageModel).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      return found.length ? found : [...OPENAI_IMAGE_MODELS]
    } catch {
      return [...OPENAI_IMAGE_MODELS]
    }
  }
}
