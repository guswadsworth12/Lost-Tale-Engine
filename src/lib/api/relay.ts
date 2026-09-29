import { RELAY_HEADERS, RELAY_PATH, type RelayAuth, type SecretName } from '@/lib/accounts/contract'
import { useAuthStore } from '@/lib/accounts/useAuthStore'

/**
 * Every call to an outside service (a model provider, an image server, a TTS provider) goes
 * through the server's relay: the browser names which of the signed-in user's saved credentials
 * to attach, and the server attaches it itself. The browser never holds or sends a key.
 *
 * Same-origin paths (`/api/...`) are fetched directly: they are already this server.
 */
export interface RelayInit extends RequestInit {
  /** Which saved credential the server should attach. Only name one the user has actually saved: the relay rejects a missing one (400). */
  secret?: SecretName
  /** How to attach `secret` (default bearer). */
  auth?: RelayAuth
  /** Basic auth's username (not a secret). */
  username?: string
}

function isSameOrigin(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//')
}

/** This server's own sign-in gate answers exactly this; a service's own 401 (a bad API key, passed through the relay) never does. */
const SIGN_IN_REQUIRED = 'Sign in required'

/**
 * If `res` is the server's sign-in gate (not a service's own 401), shows the sign-in screen.
 * Reads a clone, so the caller still gets the untouched response.
 */
export async function noticeSignInGate(res: Response): Promise<void> {
  if (res.status !== 401) return
  try {
    const body = (await res.clone().json()) as { error?: unknown } | null
    if (body?.error === SIGN_IN_REQUIRED) useAuthStore.getState().signedOut()
  } catch {
    // Not JSON: a service's own 401, passed through untouched.
  }
}

export async function relayFetch(url: string, init: RelayInit = {}): Promise<Response> {
  const { secret, auth, username, headers: callerHeaders, ...rest } = init
  const headers = new Headers(callerHeaders)
  // Nothing the caller set may carry a credential of its own.
  headers.delete('authorization')
  if (isSameOrigin(url)) {
    const res = await fetch(url, { ...rest, headers })
    await noticeSignInGate(res)
    return res
  }

  headers.set(RELAY_HEADERS.target, url)
  if (secret) {
    headers.set(RELAY_HEADERS.secret, secret)
    if (auth) headers.set(RELAY_HEADERS.auth, auth)
    if (auth === 'basic' && username !== undefined) headers.set(RELAY_HEADERS.username, username)
  }
  const res = await fetch(RELAY_PATH, { ...rest, headers })
  await noticeSignInGate(res)
  return res
}

