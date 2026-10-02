import type { SecretName } from '@/lib/accounts/contract'
import { createImageBackend } from './createImageBackend'
import { loadOpenMayhemImageModels, loadOpenMayhemModels } from './openMayhem'
import { OpenAICompatibleClient } from './openaiCompatible'
import { serviceSecret, textBaseUrl, type Capability, type Service } from './services'

/** OpenAI's and Gemini's single model lists, sorted by what each model is for. */
const IMAGE_MODEL = /image|dall-e|imagen/i
const VOICE_MODEL = /tts/i
const SPEECH_SERVER_MODEL = /tts|kokoro|speech/i
const NOT_A_CHAT_MODEL = /image|dall-e|imagen|tts|whisper|embedding|moderation|transcribe|audio|realtime|aqa|search/i

/**
 * A service's own model lists, per capability, for the model pickers. Whatever it can't list stays
 * unset, and the pickers fall back to suggested models. Throws when the service can't be reached.
 */
export async function loadServiceModels(service: Service, secrets: Partial<Record<SecretName, boolean>>): Promise<Partial<Record<Capability, string[]>>> {
  const secret = serviceSecret(service)
  const keySaved = !!secret && !!secrets[secret]
  switch (service.kind) {
    case 'openai':
    case 'gemini':
    case 'openai-compatible': {
      const all = await new OpenAICompatibleClient(textBaseUrl(service), keySaved, '', secret).listModels()
      // A voice server (Kokoro) lists its speech models with the rest.
      if (service.kind === 'openai-compatible') return { text: all, ...(all.some((m) => SPEECH_SERVER_MODEL.test(m)) ? { voice: all.filter((m) => SPEECH_SERVER_MODEL.test(m)) } : {}) }
      return {
        text: all.filter((m) => !NOT_A_CHAT_MODEL.test(m)),
        images: all.filter((m) => IMAGE_MODEL.test(m)),
        ...(service.kind === 'openai' ? { voice: all.filter((m) => VOICE_MODEL.test(m)) } : {}),
      }
    }
    case 'openmayhem': {
      const [text, images, voice] = await Promise.all([
        loadOpenMayhemModels(true, 'CHAT'), loadOpenMayhemImageModels(true), loadOpenMayhemModels(true, 'AUDIO_SPEECH'),
      ])
      return { text: text.map((m) => m.id), images: images.map((m) => m.id), voice: voice.map((m) => m.id) }
    }
    case 'a1111':
    case 'comfyui':
    case 'swarmui': {
      const models = await createImageBackend({
        imageBackend: service.kind, imageBackendBaseUrl: service.baseUrl ?? '', imageBackendUsername: service.username ?? '',
        imageBackendModel: '', imageBackendSecret: secret, secrets: secrets as Record<SecretName, boolean>,
      }).listModels()
      return { images: models }
    }
    default:
      return {}
  }
}
