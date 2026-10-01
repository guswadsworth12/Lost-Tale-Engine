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
  /** The chosen text service's key (`api/services.ts`); unset, the long-standing chat key. */
  chatBackendSecret?: SecretName
}

export function createChatBackend(settings: ChatBackendSettings): ChatBackend {
  if (settings.chatBackend === 'openai-compatible') {
    const secret = settings.chatBackendSecret ?? (isOpenMayhem(settings.chatBackendBaseUrl) ? 'openMayhemApiKey' : 'chatBackendApiKey')
    return new OpenAICompatibleClient(settings.chatBackendBaseUrl, !!settings.secrets[secret], settings.chatBackendModel, secret)
  }
  if (settings.chatBackend === 'novelai') {
    // NovelAI has no base URL field — its two hosts are fixed per model (see novelai.ts).
    const secret = settings.chatBackendSecret ?? 'chatBackendApiKey'
    return new NovelAIClient(!!settings.secrets[secret], settings.chatBackendModel, secret)
  }
  return new KoboldClient(settings.baseUrl)
}
