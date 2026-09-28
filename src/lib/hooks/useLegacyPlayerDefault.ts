import { useEffect } from 'react'
import { personasApi } from '@/lib/api/client'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

/**
 * Carries the last-picked persona over to the card it became, once. Personas were folded into
 * cards on the server (`migrations/mergePersonas.ts`), but the "who do I usually play" choice lives
 * in this browser's settings, so it's mapped here through the legacy row's `migratedToCharacterId`.
 */
export function useLegacyPlayerDefault() {
  const activePersonaId = useSettingsStore((s) => s.activePersonaId)
  const activePlayerCharacterId = useSettingsStore((s) => s.activePlayerCharacterId)
  useEffect(() => {
    if (!activePersonaId || activePlayerCharacterId) return
    let cancelled = false
    personasApi
      .get(activePersonaId)
      .then((persona) => {
        if (cancelled) return
        const { setActivePlayerCharacterId, setActivePersonaId } = useSettingsStore.getState()
        if (persona?.migratedToCharacterId) setActivePlayerCharacterId(persona.migratedToCharacterId)
        setActivePersonaId(null)
      })
      .catch(() => {
        /* the legacy row is gone; nothing to carry over */
      })
    return () => {
      cancelled = true
    }
  }, [activePersonaId, activePlayerCharacterId])
}
