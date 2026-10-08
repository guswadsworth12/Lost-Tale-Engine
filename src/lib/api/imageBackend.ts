/**
 * Section 11's "image/asset generation backends" — the same "one interface, many providers" shape
 * as `ChatBackend`/`ttsProviders.ts`, this time for generating an image into a slot (character
 * avatar, VN sprite, world background, gallery CG) that today only accepts an upload. Deliberately
 * minimal: one call to generate, one to list what models/checkpoints are available (best-effort —
 * a backend with no such introspection, or one that's unreachable, returns an empty list rather
 * than throwing, since the picker just falls back to a free-text field in that case).
 */
export interface ImageGenerateParams {
  prompt: string
  negativePrompt?: string
  width: number
  height: number
  steps: number
  cfgScale: number
  /** Omit (or -1) for a random seed — every backend here treats that the same way. */
  seed?: number
  /** Checkpoint/model name — meaning is backend-specific; omit to use whatever's already loaded. */
  model?: string
  sampler?: string
  /** Which slot the image is for; decides its shape on backends with fixed sizes. */
  purpose?: ImagePurpose
  /** A transparent background (a sprite), on backends that can; see `ImageCapabilities`. */
  transparent?: boolean
  /** Images whose look should carry over (a character's portrait), on backends that take them. */
  /** `name`: who or what it shows ("Brisa Vale", "Underground Cistern (location)"); sent with the image so the model can tell them apart. */
  referenceImages?: { base64: string; mimeType: string; name?: string }[]
}

/** The app's image slots. */
export type ImagePurpose = 'portrait' | 'sprite' | 'background' | 'cg'

/** The shape each slot asks for, before a backend fits it to what it supports. */
export const SLOT_SIZES: Record<ImagePurpose, { width: number; height: number }> = {
  portrait: { width: 832, height: 1216 },
  sprite: { width: 832, height: 1216 },
  background: { width: 1216, height: 832 },
  cg: { width: 1216, height: 832 },
}

/** What a backend can do with a model. A backend that doesn't say can do none of it. */
export interface ImageCapabilities {
  transparency: boolean
  references: boolean
  /** How many reference images the model takes at once; 0 when it takes none. */
  maxReferences: number
}

export const NO_IMAGE_CAPABILITIES: ImageCapabilities = { transparency: false, references: false, maxReferences: 0 }

/** Of `options` ("1024x1536" sizes, or "3:4" ratios), the one whose shape is nearest `width`×`height`. */
export function nearestShape(width: number, height: number, options: readonly string[]): string {
  const target = Math.log(width / height)
  const ratio = (option: string) => {
    const [a, b] = option.split(/[x:]/).map(Number)
    return Math.log(a / b)
  }
  return [...options].sort((x, y) => Math.abs(ratio(x) - target) - Math.abs(ratio(y) - target))[0]
}

export type ImageGenErrorKind = 'auth' | 'quota' | 'rate' | 'safety' | 'unsupported' | 'network' | 'failed'

/**
 * A generation failure every backend reports the same way, in words a person can act on. Never
 * carries a key: providers' error bodies are summarized, not echoed.
 */
export class ImageGenError extends Error {
  constructor(public readonly kind: ImageGenErrorKind, message: string, public readonly status?: number) {
    super(message)
    this.name = 'ImageGenError'
  }
}

/** Strips anything that looks like a key from a provider's message before it is shown. */
export function redactKeys(text: string): string {
  return text.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,})\b/g, '[key hidden]')
}

export interface ImageGenerateResult {
  /** Base64-encoded image bytes, no `data:` prefix — callers wrap it into a data URL themselves (matches how `decodeImageDataUrl` on the server already expects one). */
  base64: string
  mimeType?: string
  /** The seed actually used, when the backend reports it — useful since `params.seed` is often left unset for a random one. */
  seed?: number
}

export interface ImageBackend {
  generateImage(params: ImageGenerateParams, signal?: AbortSignal): Promise<ImageGenerateResult>
  listModels(): Promise<string[]>
  /** What this backend can do with `model`. Unset: nothing beyond a plain image. */
  capabilities?(model?: string): ImageCapabilities
}

export function capabilitiesOf(backend: ImageBackend, model?: string): ImageCapabilities {
  return backend.capabilities?.(model) ?? NO_IMAGE_CAPABILITIES
}

export type ImageBackendId = 'a1111' | 'comfyui' | 'swarmui' | 'novelai-image' | 'openmayhem' | 'openai-image' | 'gemini-image'

export const IMAGE_BACKEND_LABELS: Record<ImageBackendId, string> = {
  openmayhem: 'OpenMayhem (hosted)',
  a1111: 'Automatic1111 / Forge (local)',
  comfyui: 'ComfyUI (local)',
  swarmui: 'SwarmUI (local)',
  'novelai-image': 'NovelAI (hosted, subscription)',
  'openai-image': 'OpenAI (hosted)',
  'gemini-image': 'Google Gemini (hosted)',
}

/** A reference image's file name from what it shows: "Brisa Vale" → `brisa-vale-reference.png`. */
export function referenceFileName(ref: { mimeType: string; name?: string }, index: number): string {
  const slug = (ref.name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${slug || `image-${index + 1}`}-reference.${ref.mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png'}`
}
