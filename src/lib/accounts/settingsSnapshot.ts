/**
 * Pure helpers for moving a user's preferences between the settings store and the server.
 * No store or network imports here, so both the store's persist config and the sync code can use
 * them (and tests can run them) without dragging in either.
 */
import { SECRET_SETTING_KEYS, type AccountUser } from '@/lib/accounts/contract'

/** Nested settings objects merged key-by-key (so new tokens/params backfill) rather than replaced. */
export const NESTED_MERGE_KEYS = ['themeTokensLight', 'themeTokensDark', 'sampler'] as const

const SECRET_KEYS: ReadonlySet<string> = new Set(SECRET_SETTING_KEYS)

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Settings without credentials: what may be written to localStorage (functions included, persist drops them). */
export function omitSecrets<S extends object>(state: S): Partial<S> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (!SECRET_KEYS.has(key)) out[key] = value
  }
  return out as Partial<S>
}

/** What gets sent to the server: every value except credentials and the store's action functions. */
export function settingsSnapshot(state: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (SECRET_KEYS.has(key) || typeof value === 'function') continue
    out[key] = value
  }
  return out
}

/**
 * The patch that applies a server snapshot onto the current state. Only keys the store knows,
 * never a credential, never over an action; nested keys merge the same way the persist merge does.
 * Keys the server doesn't have keep their current value.
 */
export function settingsPatchFromServer<S extends object>(server: unknown, current: S): Partial<S> {
  if (!isPlainObject(server)) return {}
  const cur = current as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(server)) {
    if (SECRET_KEYS.has(key) || !(key in cur)) continue
    if (typeof cur[key] === 'function' || typeof value === 'function' || value === undefined) continue
    if ((NESTED_MERGE_KEYS as readonly string[]).includes(key)) {
      patch[key] = { ...(isPlainObject(cur[key]) ? cur[key] : {}), ...(isPlainObject(value) ? value : {}) }
    } else {
      patch[key] = value
    }
  }
  return patch as Partial<S>
}

/**
 * Whether this browser's current preferences (and any keys still in them) may be handed to `user`:
 * yes if they're already that user's; with no one recorded (an install from before accounts, whose
 * one user was the owner), only to the owner account.
 */
export function inheritsLocalSettings(user: Pick<AccountUser, 'id' | 'role'>, recordedOwner: string | null): boolean {
  return recordedOwner ? recordedOwner === user.id : user.role === 'owner'
}
