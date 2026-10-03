import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { useHostedBackendStatus } from '@/lib/hooks/useHostedBackendStatus'
import { CHAT_BACKEND_LABELS } from '@/lib/api/chatBackend'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { isOpenMayhem } from '@/lib/api/openMayhem'

export function ConnectionBadge() {
  const chatBackend = useSettingsStore((s) => s.chatBackend)
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const chatBackendBaseUrl = useSettingsStore((s) => s.chatBackendBaseUrl)
  const { saved: secrets } = useSecretStatus()
  const chatBackendModel = useSettingsStore((s) => s.chatBackendModel)
  const chatBackendSecret = useSettingsStore((s) => s.chatBackendSecret)

  // Both hooks are always called (hook rules), but only one's result is ever shown — the
  // KoboldCpp poll already ran unconditionally before this fix, so leaving it running costs
  // nothing (local, free); the hosted check is the one gated by `enabled`, since firing it in the
  // background on every render regardless of which backend is actually active would mean quietly
  // spending calls against a metered external API for a result nobody sees.
  const kobold = useConnectionStatus(baseUrl)
  const hostedBackend = chatBackend === 'novelai' ? 'novelai' : 'openai-compatible'
  // The same key the chat client sends (`createChatBackend`): the Text service's own, else the long-standing chat key.
  // Checking with a different one asked the provider for its models with no key at all, every time a story opened.
  const chatSecret = chatBackendSecret ?? (chatBackend === 'openai-compatible' && isOpenMayhem(chatBackendBaseUrl) ? 'openMayhemApiKey' : 'chatBackendApiKey')
  const hosted = useHostedBackendStatus(chatBackend !== 'koboldcpp', hostedBackend, chatBackendBaseUrl, !!secrets[chatSecret], chatBackendModel, chatSecret)

  const status = chatBackend === 'koboldcpp' ? kobold.status : hosted.status
  const backendLabel = CHAT_BACKEND_LABELS[chatBackend]
  const endpointLabel = chatBackend === 'koboldcpp' ? baseUrl : chatBackend === 'novelai' ? 'NovelAI' : chatBackendBaseUrl || '(no base URL set)'

  const color = status === 'online' ? 'bg-success' : status === 'offline' ? 'bg-danger' : 'bg-warning'
  const tooltip =
    chatBackend === 'koboldcpp'
      ? status === 'online'
        ? `Connected. ${kobold.model || baseUrl}${kobold.maxContext !== null ? ` (${kobold.maxContext.toLocaleString()} ctx)` : ''}`
        : status === 'offline'
          ? `Not reachable. ${baseUrl}`
          : `Checking ${baseUrl}…`
      : status === 'online'
        ? `Connected. ${backendLabel}${hosted.detail ? ` (${hosted.detail})` : ''}`
        : status === 'offline'
          ? `Not reachable. ${backendLabel}: ${endpointLabel}${hosted.detail ? ` (${hosted.detail})` : ''}`
          : `Checking ${backendLabel}…`

  return (
    <div className="flex h-2.5 w-2.5 items-center justify-center" title={tooltip}>
      <span className={`h-2 w-2 rounded-full ${color}`} />
    </div>
  )
}
