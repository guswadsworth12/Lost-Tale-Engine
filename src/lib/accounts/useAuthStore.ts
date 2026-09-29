/**
 * Who is signed in, as far as this browser knows. `unknown` until the first status check answers;
 * any API call that comes back 401 flips it to `signedOut`, so the app shows the sign-in screen
 * instead of views that can't load. No imports beyond the contract: `request()` depends on this.
 */
import { create } from 'zustand'
import type { AccountUser, AuthStatus } from '@/lib/accounts/contract'

export type AuthPhase = 'unknown' | 'signedOut' | 'signedIn'

interface AuthState {
  status: AuthPhase
  user: AccountUser | null
  needsSetup: boolean
  setupAllowedHere: boolean
  /** Signed in with a one-time setup code: nothing else works until they choose a password. */
  mustSetPassword: boolean
  /** Apply a GET /api/auth/status answer. */
  setFromStatus: (s: AuthStatus) => void
  signedIn: (user: AccountUser) => void
  signedOut: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'unknown',
  user: null,
  needsSetup: false,
  setupAllowedHere: false,
  mustSetPassword: false,
  setFromStatus: (s) =>
    set({
      status: s.user ? 'signedIn' : 'signedOut',
      user: s.user,
      needsSetup: s.needsSetup,
      setupAllowedHere: s.setupAllowedHere,
      mustSetPassword: Boolean(s.user && (s.mustSetPassword || s.user.mustSetPassword)),
    }),
  signedIn: (user) =>
    set({ status: 'signedIn', user, needsSetup: false, setupAllowedHere: false, mustSetPassword: Boolean(user.mustSetPassword) }),
  signedOut: () =>
    set((s) => (s.status === 'signedOut' && !s.user ? s : { status: 'signedOut', user: null, mustSetPassword: false })),
}))
