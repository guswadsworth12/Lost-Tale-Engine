import { A1111Client } from './a1111Image'
import { ComfyUIClient } from './comfyuiImage'
import { SwarmUIClient } from './swarmuiImage'
import { NovelAIImageClient } from './novelaiImage'
import { OpenMayhemImageClient } from './openMayhemMedia'
import { OpenAIImageClient } from './openaiImage'
import { GeminiImageClient } from './geminiImage'
import type { ImageBackend, ImageBackendId } from './imageBackend'
import type { SecretName } from '@/lib/accounts/contract'

export interface ImageBackendSettings {
  imageBackend: ImageBackendId
  /** a1111 / comfyui / swarmui only. */
  imageBackendBaseUrl: string
  /** a1111's optional --api-auth username. */
  imageBackendUsername: string
  imageBackendModel: string
  /** OpenAI only: its quality option. Blank: the model's default. */
  imageBackendQuality?: string
  /**
   * Which credentials the user has saved (`useSecretStatus().saved`). The browser never holds a
   * key; the server's relay attaches it. `imageBackendPassword` is a1111's --api-auth password, or
   * NovelAI's image key; `openMayhemApiKey` is OpenMayhem's.
   */
  secrets: Record<SecretName, boolean>
}

/** Section 11's image-backend factory — the `createChatBackend` pattern applied to image generation. */
export function createImageBackend(settings: ImageBackendSettings): ImageBackend {
  switch (settings.imageBackend) {
    case 'openmayhem':
      return new OpenMayhemImageClient(settings.secrets.openMayhemApiKey, settings.imageBackendModel)
    case 'comfyui':
      return new ComfyUIClient(settings.imageBackendBaseUrl)
    case 'swarmui':
      return new SwarmUIClient(settings.imageBackendBaseUrl)
    case 'openai-image':
      return new OpenAIImageClient(settings.secrets.openaiApiKey, settings.imageBackendModel, settings.imageBackendQuality ?? '')
    case 'gemini-image':
      return new GeminiImageClient(settings.secrets.geminiApiKey, settings.imageBackendModel)
    case 'novelai-image':
      return new NovelAIImageClient(settings.secrets.imageBackendPassword, settings.imageBackendModel)
    case 'a1111':
    default:
      return new A1111Client(settings.imageBackendBaseUrl, settings.imageBackendUsername || undefined, settings.secrets.imageBackendPassword)
  }
}
