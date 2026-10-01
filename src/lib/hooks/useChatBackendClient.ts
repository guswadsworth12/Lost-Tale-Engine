import { useMemo } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { createChatBackend } from '@/lib/api/createChatBackend'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { invalidateTokenCache } from '@/lib/tokenCache'
import type { ChatBackend } from '@/lib/api/chatBackend'

/**
 * Section 8's "additional model backends" — the shared hook every generation call site (the main
 * chat loop, character generation, field regeneration, world info suggestions, outreach messages,
 * new-chat greeting) uses to get a `ChatBackend` that respects the user's Settings choice, instead
 * of each one separately reading `baseUrl` and constructing `new KoboldClient(baseUrl)` directly.
 * Defaults to `koboldcpp` (unaffected behavior) until the user opts into `'openai-compatible'` from
 * Settings.
 */
export function useChatBackendClient(): ChatBackend {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const chatBackend = useSettingsStore((s) => s.chatBackend)
  const chatBackendBaseUrl = useSettingsStore((s) => s.chatBackendBaseUrl)
  const { saved: secrets } = useSecretStatus()
  const chatBackendModel = useSettingsStore((s) => s.chatBackendModel)
  const chatBackendSecret = useSettingsStore((s) => s.chatBackendSecret)
  return useMemo(() => {
    // A different backend or model means a different tokenizer, so every memoized token count from
    // the previous one is now wrong.
    invalidateTokenCache()
    return createChatBackend({ chatBackend, baseUrl, chatBackendBaseUrl, chatBackendModel, chatBackendSecret, secrets })
  }, [chatBackend, baseUrl, chatBackendBaseUrl, chatBackendModel, chatBackendSecret, secrets])
}
