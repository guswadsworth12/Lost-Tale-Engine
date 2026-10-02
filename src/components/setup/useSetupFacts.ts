import { useMemo } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus, type SecretFlags } from '@/lib/accounts/secrets'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chatsApi } from '@/lib/api/client'
import { SERVICE_KINDS, chosen, serviceSecret, type Capability, type ModelChoice, type Service } from '@/lib/api/services'
import { verifiedKey, type SetupFacts } from '@/lib/setup/setup'

/** Whether a chosen model's service has what it needs to answer: its address and, if it takes one, its key. */
export function modelReady(services: Service[], choice: ModelChoice | null | undefined, capability: Capability, secrets: SecretFlags): boolean {
  const resolved = chosen({ services }, choice, capability)
  if (!resolved) return false
  const info = SERVICE_KINDS[resolved.service.kind]
  if (info.address?.required && !resolved.service.baseUrl?.trim()) return false
  if (info.key !== 'required') return true
  const secret = serviceSecret(resolved.service)
  return !!secret && !!secrets[secret]
}

/** What the setup steps are checked against, live. */
export function useSetupFacts(): SetupFacts {
  const services = useSettingsStore((s) => s.services)
  const textModel = useSettingsStore((s) => s.textModel)
  const imageModel = useSettingsStore((s) => s.imageModel)
  const voiceModel = useSettingsStore((s) => s.voiceModel)
  const { saved: secrets } = useSecretStatus()
  const verified = useSettingsStore((s) => s.setupProgress.verified)
  const chats = useApiQuery('chats', () => chatsApi.list(), [])
  return useMemo(() => {
    const hasStory = (chats?.length ?? 0) > 0
    // A model only counts once it has answered: a fresh install's defaults name a local server that may not be running.
    // Having played a story is proof enough. Free voices need no proof.
    const passed = (kind: 'text' | 'voice', choice: ModelChoice | null | undefined) => !!choice && verified?.[kind] === verifiedKey(choice)
    const voiceService = services.find((s) => s.id === voiceModel?.serviceId)
    return {
      textReady: modelReady(services, textModel, 'text', secrets) && (hasStory || passed('text', textModel)),
      voiceReady: modelReady(services, voiceModel, 'voice', secrets) && (hasStory || voiceService?.kind === 'edge' || passed('voice', voiceModel)),
      imagesReady: modelReady(services, imageModel, 'images', secrets),
      hasStory,
    }
  }, [chats, imageModel, secrets, services, textModel, verified, voiceModel])
}
