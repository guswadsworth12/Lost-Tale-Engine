import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { authApi } from '@/lib/accounts/api'
import { useAuthStore, type AuthPhase } from '@/lib/accounts/useAuthStore'
import { endSettingsSession, startSettingsSync } from '@/lib/accounts/settingsSync'
import { errorMessage } from '@/lib/store/useToastStore'
import { ChoosePasswordScreen, LoginScreen, SetupElsewhereScreen, SetupScreen, StatusErrorScreen } from './AuthScreens'

export type GateScreen = 'loading' | 'error' | 'setup' | 'setupElsewhere' | 'login' | 'choosePassword' | 'app'

/**
 * Which screen the gate shows. `ready`: the signed-in user's preferences have been loaded.
 * `mustSetPassword` comes first for a signed-in user: until then every other call is refused.
 */
export function gateScreen(s: {
  status: AuthPhase
  needsSetup: boolean
  setupAllowedHere: boolean
  mustSetPassword?: boolean
  error: string | null
  ready: boolean
}): GateScreen {
  if (s.status === 'unknown') return s.error ? 'error' : 'loading'
  if (s.status === 'signedIn') return s.mustSetPassword ? 'choosePassword' : s.ready ? 'app' : 'loading'
  if (s.needsSetup) return s.setupAllowedHere ? 'setup' : 'setupElsewhere'
  return 'login'
}

/**
 * Shows the app only to a signed-in user, after their preferences are in place; otherwise the
 * first-run setup, a "finish setup on the host" note, or the sign-in screen. Nothing of the app
 * renders (not even a flash) before the server has said who this is.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status)
  const user = useAuthStore((s) => s.user)
  const needsSetup = useAuthStore((s) => s.needsSetup)
  const setupAllowedHere = useAuthStore((s) => s.setupAllowedHere)
  const mustSetPassword = useAuthStore((s) => s.mustSetPassword)
  const [error, setError] = useState<string | null>(null)
  const [readyFor, setReadyFor] = useState<string | null>(null)

  const checkStatus = useCallback(() => {
    setError(null)
    authApi
      .status()
      .then((s) => useAuthStore.getState().setFromStatus(s))
      .catch((e) => setError(errorMessage(e)))
  }, [])

  useEffect(checkStatus, [checkStatus])

  // Leaving a signed-in session (sign-out, an expired session, another user) ends preference sync
  // and resets this browser's preferences; so does landing signed-out on a browser that still
  // holds someone's (their session expired while the tab was closed).
  useEffect(
    () =>
      useAuthStore.subscribe((next, prev) => {
        const left = prev.status === 'signedIn' && (next.status !== 'signedIn' || next.user?.id !== prev.user?.id)
        const landedSignedOut = prev.status === 'unknown' && next.status === 'signedOut'
        if (left || landedSignedOut) {
          endSettingsSession()
          setReadyFor(null)
        }
      }),
    [],
  )

  const userId = user?.id ?? null
  const role = user?.role ?? null
  // Preferences and key migration wait until a setup-code sign-in has chosen a password (they'd be refused).
  useEffect(() => {
    if (status !== 'signedIn' || mustSetPassword || !userId || !role) return
    let cancelled = false
    startSettingsSync({ id: userId, role }).finally(() => {
      if (!cancelled) setReadyFor(userId)
    })
    return () => {
      cancelled = true
    }
  }, [status, mustSetPassword, userId, role])

  const screen = gateScreen({
    status, needsSetup, setupAllowedHere, mustSetPassword, error, ready: readyFor !== null && readyFor === userId,
  })
  return (
    <GateView screen={screen} error={error} onRetry={checkStatus} username={user?.username ?? ''}>
      {children}
    </GateView>
  )
}

/** Renders one gate screen; the app itself only for `app`. */
export function GateView({ screen, error, onRetry, username = '', children }: {
  screen: GateScreen
  error: string | null
  onRetry: () => void
  /** The signed-in user's name, for the choose-password screen. */
  username?: string
  children: ReactNode
}) {
  switch (screen) {
    case 'app':
      return <>{children}</>
    case 'loading':
      return <div className="h-full w-full bg-bg" aria-busy="true" />
    case 'error':
      return <StatusErrorScreen message={error ?? ''} onRetry={onRetry} />
    case 'setup':
      return <SetupScreen />
    case 'setupElsewhere':
      return <SetupElsewhereScreen onRetry={onRetry} />
    case 'login':
      return <LoginScreen />
    case 'choosePassword':
      return <ChoosePasswordScreen username={username} />
  }
}
