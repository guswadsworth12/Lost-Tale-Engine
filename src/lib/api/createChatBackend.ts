import { KoboldClient } from './kobold'
import { OpenAICompatibleClient } from './openaiCompatible'
import { NovelAIClient } from './novelai'
import { isOpenMayhem } from './openMayhem'
import type { ChatBackend, ChatBackendId } from './chatBackend'
import type { SecretName } from '@/lib/accounts/contract'

// Picks which `ChatBackend` implementation to use based on the user's Settings choice.

export interface ChatBackendSettings {
  chatBackend: ChatBackendId
  /** KoboldCpp's own connection URL (Settings → Connection) — used when `chatBackend` is `'koboldcpp'`. */
  baseUrl: string
  chatBackendBaseUrl: string
  chatBackendModel: string
  /** Which credentials the user has saved (`useSecretStatus().saved`). The browser never holds a key; the server's relay attaches it. */
  secrets: Record<SecretName, boolean>
}

export function createChatBackend(settings: ChatBackendSettings): ChatBackend {
  if (settings.chatBackend === 'openai-compatible') {
    return new OpenAICompatibleClient(
      settings.chatBackendBaseUrl,
      isOpenMayhem(settings.chatBackendBaseUrl) ? settings.secrets.openMayhemApiKey : settings.secrets.chatBackendApiKey,
      settings.chatBackendModel,
    )
  }
  if (settings.chatBackend === 'novelai') {
    // NovelAI has no base URL field — its two hosts are fixed per model (see novelai.ts).
    return new NovelAIClient(settings.secrets.chatBackendApiKey, settings.chatBackendModel)
  }
  return new KoboldClient(settings.baseUrl)
}
