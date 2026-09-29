import { createHash, randomBytes, randomInt, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import { PASSWORD_MIN_LENGTH } from '../src/lib/accounts/contract.ts'

/**
 * Accounts, the pure parts: password hashing, name and password rules, session tokens, the
 * "is this the machine itself?" check that guards first-time setup, the login rate limiter, and
 * the cookie helpers. No database here; `server/auth.ts` wires these to the stores and routes.
 */

// ---- Passwords ----

/** scrypt cost. N = 2^15, r = 8 needs 32 MiB and runs in well under 300ms on ordinary hardware. */
export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const
const KEY_LENGTH = 32
const SALT_BYTES = 16
/** Upper bounds when reading a stored hash back, so a corrupt row can't ask for gigabytes. */
const MAX_N = 2 ** 20
const MAX_R = 32
const MAX_P = 16

function scryptAsync(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

function maxmemFor(N: number, r: number, p: number): number {
  // scrypt uses 128·N·r bytes for V plus 128·r·p for B; leave headroom above Node's check.
  return 128 * N * r + 128 * r * p + 16 * 1024 * 1024
}

/** Hash a password as `scrypt$N$r$p$saltB64$hashB64`. `params` exists so tests can run cheaply. */
export async function hashPassword(password: string, params: { N: number; r: number; p: number } = SCRYPT_PARAMS): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const { N, r, p } = params
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, { N, r, p, maxmem: maxmemFor(N, r, p) })
  return ['scrypt', N, r, p, salt.toString('base64'), key.toString('base64')].join('$')
}

/** Check a password against a stored hash. Any malformed or out-of-bounds hash is simply a mismatch. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = typeof stored === 'string' ? stored.split('$') : []
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [N, r, p] = parts.slice(1, 4).map((v) => Number(v))
  if (![N, r, p].every((v) => Number.isInteger(v) && v > 0)) return false
  if (N > MAX_N || r > MAX_R || p > MAX_P || (N & (N - 1)) !== 0) return false
  const salt = Buffer.from(parts[4], 'base64')
  const expected = Buffer.from(parts[5], 'base64')
  if (salt.length === 0 || expected.length === 0) return false
  let key: Buffer
  try {
    key = await scryptAsync(password.normalize('NFKC'), salt, expected.length, { N, r, p, maxmem: maxmemFor(N, r, p) })
  } catch {
    return false
  }
  return key.length === expected.length && timingSafeEqual(key, expected)
}

// ---- Names and passwords ----

export const USERNAME_MIN = 3
export const USERNAME_MAX = 32
export const PASSWORD_MIN = PASSWORD_MIN_LENGTH
export const PASSWORD_MAX = 200

/** An error message, or null when the name is acceptable. Letters, digits, `.`, `_` and `-`. */
export function validateUsername(name: unknown): string | null {
  if (typeof name !== 'string') return 'A username is required.'
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) return `A username is ${USERNAME_MIN} to ${USERNAME_MAX} characters.`
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return 'A username may use only letters, digits, dots, dashes and underscores.'
  return null
}

/** An error message, or null when the password is acceptable. */
export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string') return 'A password is required.'
  if (password.length < PASSWORD_MIN) return `A password needs at least ${PASSWORD_MIN} characters.`
  if (password.length > PASSWORD_MAX) return `A password is at most ${PASSWORD_MAX} characters.`
  return null
}

/** The case-insensitive lookup key for a username. */
export function usernameKey(name: string): string {
  return name.toLowerCase()
}

// ---- Session tokens ----

/** A fresh session token: 32 random bytes, base64url. Only the browser's cookie ever holds it. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** What the database stores in place of the token (sessions.id). */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
/** A session in use is pushed forward at most once per this interval, so every request isn't a write. */
export const SESSION_RENEW_AFTER_MS = 24 * 60 * 60 * 1000

export function sessionExpiry(now: number): number {
  return now + SESSION_TTL_MS
}

export function sessionIsLive(session: { expiresAt: number }, now: number): boolean {
  return typeof session.expiresAt === 'number' && session.expiresAt > now
}

/** Sliding renewal: a live session last seen more than a day ago gets a fresh 30 days. */
export function sessionNeedsRenewal(session: { lastSeenAt?: number }, now: number): boolean {
  return now - (session.lastSeenAt ?? 0) > SESSION_RENEW_AFTER_MS
}

// ---- Local setup ----

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])
/**
 * Headers any proxy in front of the server adds. A Cloudflare tunnel connects from loopback, so
 * the socket address alone can't tell it from the machine itself: these headers can.
 */
export const PROXY_HEADERS = [
  'cf-connecting-ip',
  'cf-ray',
  'cf-visitor',
  'cdn-loop',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'true-client-ip',
  'forwarded',
  'via',
] as const

type Headers = Record<string, string | string[] | undefined>

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

function hostnameOf(host: string | undefined): string | undefined {
  if (!host) return undefined
  try {
    return new URL(`http://${host}`).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * True only for a request made on the machine the server runs on: a loopback socket, no proxy
 * headers, and a Host naming loopback. First-time setup is allowed only from here.
 */
export function isLocalSetupRequest(req: { remoteAddress: string | undefined; headers: Headers }): boolean {
  if (!req.remoteAddress || !LOOPBACK_ADDRESSES.has(req.remoteAddress)) return false
  for (const name of PROXY_HEADERS) if (req.headers[name] !== undefined) return false
  const hostname = hostnameOf(firstHeader(req.headers.host))
  return !!hostname && LOCAL_HOSTNAMES.has(hostname)
}

/**
 * The client address used for rate limiting. Behind a Cloudflare tunnel every request arrives
 * from loopback, so the visitor's address comes from cf-connecting-ip, which Cloudflare sets
 * itself. Direct requests use the socket address.
 */
export function clientAddress(req: { remoteAddress: string | undefined; headers: Headers }): string {
  return firstHeader(req.headers['cf-connecting-ip'])?.trim() || req.remoteAddress || 'unknown'
}

// ---- Login rate limiting ----

export const LOGIN_FREE_FAILURES = 5
export const LOGIN_FIRST_LOCK_MS = 60_000
export const LOGIN_MAX_LOCK_MS = 15 * 60_000
const LIMITER_MAX_ENTRIES = 10_000

interface LimitEntry {
  failures: number
  lockedUntil: number
  lastFailureAt: number
}

/**
 * In-memory login throttle keyed by username + address. Five failures lock the key for a minute;
 * each further failure doubles the lock, up to fifteen minutes. A success clears the key.
 */
export class LoginRateLimiter {
  private entries = new Map<string, LimitEntry>()

  static key(username: string, address: string): string {
    return `${usernameKey(username)}\u0000${address}`
  }

  /** Milliseconds until this key may try again; 0 when it may try now. */
  retryAfter(key: string, now: number): number {
    const entry = this.entries.get(key)
    if (!entry) return 0
    return Math.max(0, entry.lockedUntil - now)
  }

  fail(key: string, now: number): void {
    const entry = this.entries.get(key) ?? { failures: 0, lockedUntil: 0, lastFailureAt: 0 }
    entry.failures += 1
    entry.lastFailureAt = now
    if (entry.failures >= LOGIN_FREE_FAILURES) {
      const lock = Math.min(LOGIN_MAX_LOCK_MS, LOGIN_FIRST_LOCK_MS * 2 ** (entry.failures - LOGIN_FREE_FAILURES))
      entry.lockedUntil = now + lock
    }
    this.entries.set(key, entry)
    if (this.entries.size > LIMITER_MAX_ENTRIES) this.prune(now)
  }

  succeed(key: string): void {
    this.entries.delete(key)
  }

  /** Forget keys whose lock is over and whose last failure is older than the longest lock. */
  prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= now && now - entry.lastFailureAt > LOGIN_MAX_LOCK_MS) this.entries.delete(key)
    }
  }

  get size(): number {
    return this.entries.size
  }
}

// ---- Cookies ----

export const SESSION_COOKIE = 'lt_session'

/** Parse a Cookie header. The first occurrence of a name wins; malformed pairs are skipped. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) continue
    const name = part.slice(0, eq).trim()
    if (!name || name in out) continue
    let value = part.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1)
    try {
      out[name] = decodeURIComponent(value)
    } catch {
      out[name] = value
    }
  }
  return out
}

/** Whether the browser reached us over https, directly or through a proxy / Cloudflare. */
export function isHttpsRequest(req: { secure: boolean; headers: Headers }): boolean {
  if (req.secure) return true
  if (firstHeader(req.headers['x-forwarded-proto'])?.split(',')[0].trim().toLowerCase() === 'https') return true
  return /https/i.test(firstHeader(req.headers['cf-visitor']) ?? '')
}

/** The Set-Cookie value for a session token, or for clearing it when `token` is empty. */
export function sessionCookie(token: string, opts: { secure: boolean }): string {
  const maxAge = token ? Math.floor(SESSION_TTL_MS / 1000) : 0
  const parts = [`${SESSION_COOKIE}=${token}`, 'Path=/', `Max-Age=${maxAge}`, 'HttpOnly', 'SameSite=Lax']
  if (opts.secure) parts.push('Secure')
  return parts.join('; ')
}

// ---- The gate ----

const PUBLIC_API_PATHS = new Set(['/api/auth/status', '/api/auth/setup', '/api/auth/login'])

/**
 * Paths are compared the way Express matches routes: case-insensitively and ignoring a trailing
 * slash; decoding and collapsing repeated slashes on top only ever widens what is gated.
 */
function normalizeGatePath(rawPath: string): string {
  let p = rawPath
  try {
    p = decodeURIComponent(rawPath)
  } catch {
    // Keep the raw path; a malformed escape can't match an allowed path anyway.
  }
  p = p.toLowerCase().replace(/\/{2,}/g, '/')
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}

/** Whether a request needs a signed-in user: everything under /api (bar status, setup, login) and /avatars. */
export function pathRequiresAuth(rawPath: string): boolean {
  const p = normalizeGatePath(rawPath)
  if (PUBLIC_API_PATHS.has(p)) return false
  return p === '/api' || p.startsWith('/api/') || p === '/avatars' || p.startsWith('/avatars/')
}

/** What a session signed in with a setup code may reach, besides the public paths: signing out and choosing a password. */
const SETTING_PASSWORD_PATHS = new Set(['/api/auth/logout', '/api/auth/set-password'])

export function pathAllowedWhileSettingPassword(rawPath: string): boolean {
  const p = normalizeGatePath(rawPath)
  return PUBLIC_API_PATHS.has(p) || SETTING_PASSWORD_PATHS.has(p) || !pathRequiresAuth(rawPath)
}

// ---- Email ----

export const EMAIL_MAX = 254

/** An error message, or null when the address looks like one. Only the basic shape is checked. */
export function validateEmail(email: unknown): string | null {
  if (typeof email !== 'string' || !email) return 'An email address is required.'
  if (email.length > EMAIL_MAX) return `An email address is at most ${EMAIL_MAX} characters.`
  if (!/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email)) return 'That does not look like an email address.'
  return null
}

/** The case-insensitive lookup key for an email address. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase()
}

/** Whether a sign-in name is an email address rather than a username (usernames never hold `@`). */
export function looksLikeEmail(identifier: string): boolean {
  return identifier.includes('@')
}

// ---- Setup codes ----

/** No 0/O, 1/I/L: the code is read off a screen and typed or said aloud. */
export const SETUP_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const SETUP_CODE_LENGTH = 12
export const SETUP_CODE_TTL_MS = 72 * 60 * 60 * 1000

/** A fresh one-time setup code, displayed as XXXX-XXXX-XXXX. */
export function generateSetupCode(): string {
  let raw = ''
  for (let i = 0; i < SETUP_CODE_LENGTH; i++) raw += SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)]
  return formatSetupCode(raw)
}

export function formatSetupCode(raw: string): string {
  return raw.match(/.{1,4}/g)!.join('-')
}

/** The code's canonical form (12 upper-case characters, no dashes or spaces), or null if it can't be one. */
export function normalizeSetupCode(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const raw = input.replace(/[\s-]/g, '').toUpperCase()
  if (raw.length !== SETUP_CODE_LENGTH) return null
  for (const ch of raw) if (!SETUP_CODE_ALPHABET.includes(ch)) return null
  return raw
}

/** Stored like a password: a scrypt hash of the canonical form. */
export async function hashSetupCode(code: string, params?: { N: number; r: number; p: number }): Promise<string> {
  const raw = normalizeSetupCode(code)
  if (!raw) throw new Error('Not a setup code')
  return hashPassword(raw, params)
}

/** Checks a typed code against the stored hash. Anything not shaped like a code still costs a hash, then fails. */
export async function verifySetupCode(input: unknown, stored: string): Promise<boolean> {
  const raw = normalizeSetupCode(input)
  const ok = await verifyPassword(raw ?? 'not-a-setup-code', stored)
  return ok && raw !== null
}

export function setupCodeExpiry(now: number): number {
  return now + SETUP_CODE_TTL_MS
}

export function setupCodeIsLive(expiresAt: unknown, now: number): boolean {
  return typeof expiresAt === 'number' && expiresAt > now
}
