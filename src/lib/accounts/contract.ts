/**
 * Accounts: what the server and the browser agree on. Worlds, characters, and stories stay shared
 * by everyone signed in; what belongs to a user is their preferences and their credentials.
 * Credentials are stored encrypted on the server and never sent back to any browser: the server
 * attaches them to outgoing service calls itself, through the relay.
 */

/** Settings that are credentials. Stored encrypted per user, write-only from the browser's side. */
export const SECRET_SETTING_KEYS = ['chatBackendApiKey', 'openMayhemApiKey', 'ttsApiKey', 'imageBackendPassword'] as const
export type SecretName = (typeof SECRET_SETTING_KEYS)[number]

export function isSecretName(name: string): name is SecretName {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(name)
}

/** Settings holding service addresses. The relay only forwards to these origins (and the fixed ones below). */
export const SERVICE_URL_SETTING_KEYS = ['baseUrl', 'chatBackendBaseUrl', 'ttsBaseUrl', 'imageBackendBaseUrl'] as const

/** Provider origins the relay may reach without a saved address: their hosts are fixed, not settings. */
export const FIXED_RELAY_ORIGINS = [
  'https://text.novelai.net',
  'https://image.novelai.net',
  'https://api.novelai.net',
  'https://api.elevenlabs.io',
] as const
/** Host suffixes the relay may reach (Azure speech is per region: eastus.tts.speech.microsoft.com). */
export const FIXED_RELAY_HOST_SUFFIXES = ['.tts.speech.microsoft.com'] as const

/**
 * The relay: the browser asks the server to make a service call for it. The server checks the
 * target against the user's saved addresses, attaches the named credential, and streams the reply.
 */
export const RELAY_PATH = '/api/relay'
export const RELAY_HEADERS = {
  /** Absolute URL of the real request. */
  target: 'x-relay-target',
  /** Which of the user's secrets to attach, if any. */
  secret: 'x-relay-secret',
  /** How to attach it (default bearer). */
  auth: 'x-relay-auth',
  /** Basic auth's username (not a secret), when auth is basic. */
  username: 'x-relay-username',
} as const
/** `bearer`: Authorization: Bearer <secret>. `basic`: Basic user:secret. `header:X-Api-Key`: that header set to the secret. */
export type RelayAuth = 'bearer' | 'basic' | `header:${string}`

export type AccountRole = 'owner' | 'member'

/** Shortest password the server accepts; the browser checks it too, only to explain it before submitting. */
export const PASSWORD_MIN_LENGTH = 10

export interface AccountUser {
  id: string
  username: string
  /** Optional; they can sign in with it instead of the username. */
  email?: string
  role: AccountRole
  createdAt: number
  /** Created with a one-time setup code and has not chosen a password yet. */
  mustSetPassword?: boolean
}

/** GET /api/auth/status. `setupAllowedHere`: no account exists yet and this request comes from the machine itself, not a tunnel or the network. */
export interface AuthStatus {
  user: AccountUser | null
  needsSetup: boolean
  setupAllowedHere: boolean
  /** Signed in with a one-time setup code: the only thing they can do is choose their password (POST /api/auth/set-password). */
  mustSetPassword?: boolean
}

/** Returned once, when the owner creates a user with a setup code or issues a new one. Never retrievable again. */
export interface SetupCodeIssued {
  user: AccountUser
  code: string
  expiresAt: number
}

/** GET /api/me/secrets. Never the value itself. */
export interface SecretStatus {
  name: SecretName
  set: boolean
  updatedAt?: number
}
