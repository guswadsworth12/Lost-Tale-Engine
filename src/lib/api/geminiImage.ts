import type { ImageBackend, ImageCapabilities, ImageGenerateParams, ImageGenerateResult } from './imageBackend'
import { ImageGenError, nearestShape, redactKeys } from './imageBackend'
import { relayFetch } from './relay'

export const GEMINI_IMAGE_DEFAULT_MODEL = 'gemini-2.5-flash-image'
/** Offered when the model list can't be read. */
export const GEMINI_IMAGE_MODELS = ['gemini-2.5-flash-image', 'gemini-2.0-flash-preview-image-generation']

/** Reference images a Gemini image model takes at once: the Pro (Gemini 3) image models up to 14, the Flash ones about 3. */
export function geminiMaxReferences(model: string): number {
  return /gemini-3|pro-image/i.test(model) ? 14 : 3
}
const API = 'https://generativelanguage.googleapis.com/v1beta'
const AUTH = { secret: 'geminiApiKey' as const, auth: 'header:x-goog-api-key' as const }

/** Aspect ratios Gemini's image models accept. */
export const GEMINI_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const SAFETY_FINISH = new Set(['SAFETY', 'IMAGE_SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'])

/** The aspect ratio to ask for: portraits and sprites 2:3, backgrounds and CGs 3:2, otherwise the nearest. */
export function geminiAspectRatio(params: Pick<ImageGenerateParams, 'purpose' | 'width' | 'height'>): string {
  if (params.purpose === 'portrait' || params.purpose === 'sprite') return '2:3'
  if (params.purpose === 'background' || params.purpose === 'cg') return '3:2'
  return nearestShape(params.width, params.height, GEMINI_ASPECT_RATIOS)
}

/** A failed response, as the error a person can act on. */
export async function geminiImageError(res: Response): Promise<ImageGenError> {
  let status = ''
  let message = ''
  try {
    const body = await res.json() as { error?: { status?: string; message?: string } }
    status = body.error?.status ?? ''
    message = body.error?.message ?? ''
  } catch {
    // Not JSON: the status code says enough.
  }
  const detail = redactKeys(message).slice(0, 240)
  if (res.status === 401 || res.status === 403 || /api key not valid|API_KEY_INVALID/i.test(message)) return new ImageGenError('auth', 'Google did not accept the Gemini API key. Check it in Settings → Images.', res.status)
  if (res.status === 429 || status === 'RESOURCE_EXHAUSTED') return new ImageGenError('quota', 'The Gemini API quota is used up or requests are being limited. Wait, or check the plan on your Google account.', res.status)
  if (res.status === 404) return new ImageGenError('unsupported', 'That Gemini model is not available, or can\'t make images. Pick another in Settings → Images.', 404)
  if (res.status === 400) return new ImageGenError('unsupported', `Gemini could not use these settings${detail ? `: ${detail}` : '.'}`, 400)
  return new ImageGenError('failed', `Gemini image generation failed (${res.status})${detail ? `: ${detail}` : '.'}`, res.status)
}

interface GeminiPart { text?: string; inlineData?: { mimeType?: string; data?: string }; inline_data?: { mime_type?: string; data?: string } }
interface GeminiResponse {
  promptFeedback?: { blockReason?: string }
  candidates?: { finishReason?: string; content?: { parts?: GeminiPart[] } }[]
}

/** The image in a reply, or the reason there is none. */
export function parseGeminiImage(body: GeminiResponse): ImageGenerateResult {
  if (body.promptFeedback?.blockReason) throw new ImageGenError('safety', `Gemini blocked this prompt (${body.promptFeedback.blockReason.toLowerCase().replace(/_/g, ' ')}). Try rewording it.`)
  const candidate = body.candidates?.[0]
  const parts = candidate?.content?.parts ?? []
  for (const part of parts) {
    const data = part.inlineData?.data ?? part.inline_data?.data
    if (data) return { base64: data, mimeType: part.inlineData?.mimeType ?? part.inline_data?.mime_type ?? 'image/png' }
  }
  if (candidate?.finishReason && SAFETY_FINISH.has(candidate.finishReason)) throw new ImageGenError('safety', 'Gemini\'s safety filters stopped this image. Try rewording the prompt.')
  const said = parts.map((p) => p.text?.trim()).filter(Boolean).join(' ')
  throw new ImageGenError('failed', said ? `Gemini answered without an image: "${said.slice(0, 300)}"` : 'Gemini returned no image.')
}

/**
 * Gemini's image-capable models, through `generateContent` asking for an image back. Reference
 * images go in as inline data. Gemini can't make transparent images; the caller says so and asks
 * for a plain background instead. The key is attached by the server's relay.
 */
export class GeminiImageClient implements ImageBackend {
  constructor(private keySaved: boolean, private model: string) {}

  capabilities(model?: string): ImageCapabilities {
    return { transparency: false, references: true, maxReferences: geminiMaxReferences(model?.trim() || this.model.trim() || GEMINI_IMAGE_DEFAULT_MODEL) }
  }

  async generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult> {
    if (!this.keySaved) throw new ImageGenError('auth', 'Add a Gemini API key in Settings → Images first.')
    const model = (params.model?.trim() || this.model.trim() || GEMINI_IMAGE_DEFAULT_MODEL).replace(/^models\//, '')
    let res: Response
    try {
      res = await relayFetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Each image right after a label naming it, so the model knows who or what it shows.
          contents: [{ parts: [{ text: params.prompt }, ...(params.referenceImages ?? []).slice(0, geminiMaxReferences(model)).flatMap((ref) => [
            ...(ref.name?.trim() ? [{ text: `Reference: ${ref.name.trim()}` }] : []),
            { inlineData: { mimeType: ref.mimeType, data: ref.base64 } },
          ])] }],
          generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: geminiAspectRatio(params) } },
        }),
        ...AUTH,
        signal,
      })
    } catch (e) {
      if (signal?.aborted) throw e
      throw new ImageGenError('network', 'Could not reach Gemini.')
    }
    if (!res.ok) throw await geminiImageError(res)
    return parseGeminiImage(await res.json() as GeminiResponse)
  }

  /** Models that can make images, best effort: the fixed list when the key is missing or the list can't be read. */
  async listModels(): Promise<string[]> {
    if (!this.keySaved) return [...GEMINI_IMAGE_MODELS]
    try {
      const res = await relayFetch(`${API}/models?pageSize=200`, { ...AUTH })
      if (!res.ok) return [...GEMINI_IMAGE_MODELS]
      const body = await res.json() as { models?: { name?: string; supportedGenerationMethods?: string[] }[] }
      const found = (body.models ?? [])
        .filter((m) => m.name && /image/i.test(m.name) && (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m) => m.name!.replace(/^models\//, ''))
      return found.length ? found : [...GEMINI_IMAGE_MODELS]
    } catch {
      return [...GEMINI_IMAGE_MODELS]
    }
  }
}
