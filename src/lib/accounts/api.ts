/**
 * Account endpoints: sign-in, first-run setup, the owner's user list, and this user's synced
 * preferences. Same shape as `request()` in `lib/api/client.ts` (same-origin `/api` + JSON, with a
 * timeout), but errors carry the server's own `{error}` text and status so forms can show them.
 */
import type { AccountRole, AccountUser, AuthStatus, LeftoverAccount, SetupCodeIssued } from '@/lib/accounts/contract'
import { useAuthStore } from '@/lib/accounts/useAuthStore'

const TIMEOUT_MS = 15000

export class AccountApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AccountApiError'
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (e) {
    if (controller.signal.aborted) throw new AccountApiError('The server took too long to answer.', 0)
    throw new AccountApiError("Can't reach the server.", 0)
  } finally {
    clearTimeout(timeout)
  }
  if (res.status === 401 && !path.startsWith('/auth/')) useAuthStore.getState().signedOut()
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let message = ''
    try {
      const parsed = JSON.parse(text) as { error?: unknown }
      if (typeof parsed.error === 'string') message = parsed.error
    } catch {
      message = text
    }
    throw new AccountApiError(message || `Request failed (${res.status})`, res.status)
  }
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const authApi = {
  status: () => call<AuthStatus>('GET', '/auth/status'),
  setup: (username: string, password: string) => call<unknown>('POST', '/auth/setup', { username, password }),
  /** `username` may be a username or an email; `password` may be a one-time setup code. */
  login: (username: string, password: string) => call<unknown>('POST', '/auth/login', { username, password }),
  /** After signing in with a setup code: the first real password. */
  setPassword: (password: string) => call<AuthStatus>('POST', '/auth/set-password', { password }),
  logout: () => call<unknown>('POST', '/auth/logout'),
  changePassword: (current: string, next: string) => call<unknown>('POST', '/auth/password', { current, next }),
}

export const usersApi = {
  list: () => call<AccountUser[]>('GET', '/users'),
  /** Without a password the server issues a one-time setup code (shown once). */
  create: (input: { username: string; email?: string; role?: AccountRole; password?: string }) =>
    call<AccountUser | SetupCodeIssued>('POST', '/users', input),
  /** Replaces their password with a new one-time setup code and signs them out everywhere. */
  issueSetupCode: (id: string) => call<SetupCodeIssued>('POST', `/users/${encodeURIComponent(id)}/setup-code`),
  remove: (id: string) => call<unknown>('DELETE', `/users/${encodeURIComponent(id)}`),
  resetPassword: (id: string, password: string) =>
    call<unknown>('POST', `/users/${encodeURIComponent(id)}/password`, { password }),
}

/** Owner-only housekeeping (server/admin.ts). */
export const adminApi = {
  leftovers: () => call<LeftoverAccount[]>('GET', '/admin/leftovers'),
  /** `adopt`: it all passes to you as it is. `delete`: what only they had is deleted; what others share or use passes to you. */
  cleanUp: (formerOwnerId: string, action: 'adopt' | 'delete') =>
    call<{ adopted: number; deleted: number }>('POST', `/admin/leftovers/${encodeURIComponent(formerOwnerId)}`, { action }),
}

export function isSetupCodeIssued(x: unknown): x is SetupCodeIssued {
  if (typeof x !== 'object' || x === null) return false
  const o = x as Record<string, unknown>
  return typeof o.code === 'string' && typeof o.expiresAt === 'number' && typeof o.user === 'object' && o.user !== null
}

export interface MeSettings {
  settings: Record<string, unknown> | null
  updatedAt?: number
}

export const meSettingsApi = {
  get: () => call<MeSettings>('GET', '/me/settings'),
  put: (settings: Record<string, unknown>) => call<unknown>('PUT', '/me/settings', { settings }),
}
