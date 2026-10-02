import {
  FIXED_RELAY_HOST_SUFFIXES,
  FIXED_RELAY_ORIGINS,
  SERVICE_URL_SETTING_KEYS,
  type RelayAuth,
} from '../src/lib/accounts/contract.ts'

/**
 * The relay's rules, kept pure so they can be tested without a network: where it may forward to,
 * how a credential is attached, and which headers cross in each direction.
 */

const MAX_SETTINGS_DEPTH = 6

/**
 * Every service address saved in the user's settings, as an origin. Collected from any depth, since
 * per-provider profiles keep their own `ttsBaseUrl` etc. Non-URL and non-http(s) values are ignored.
 */
export function savedServiceOrigins(savedSettings: unknown): Set<string> {
  const origins = new Set<string>()
  const urlKeys = SERVICE_URL_SETTING_KEYS as readonly string[]
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || depth > MAX_SETTINGS_DEPTH) return
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (urlKeys.includes(key) && typeof child === 'string') {
        const url = parseHttpUrl(child.trim())
        if (url) origins.add(url.origin)
      } else if (child && typeof child === 'object') visit(child, depth + 1)
    }
  }
  visit(savedSettings, 0)
  return origins
}

function parseHttpUrl(text: string): URL | undefined {
  if (!text) return undefined
  try {
    const url = new URL(text)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch { return undefined }
}

/** Parses the x-relay-target header: an absolute http(s) URL without embedded credentials. */
export function parseRelayTarget(raw: unknown): URL | undefined {
  if (typeof raw !== 'string' || raw.length > 8192) return undefined
  const url = parseHttpUrl(raw.trim())
  if (!url || url.username || url.password) return undefined
  return url
}

export function relayTargetAllowed(target: URL, savedSettings: object | null): boolean {
  if (!(target instanceof URL)) return false
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false
  if (target.username || target.password) return false
  if (target.protocol === 'https:') {
    if ((FIXED_RELAY_ORIGINS as readonly string[]).includes(target.origin)) return true
    const host = target.hostname.toLowerCase()
    if (FIXED_RELAY_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)) return true
  }
  return savedServiceOrigins(savedSettings).has(target.origin)
}

/** RFC 9110 token characters. */
const HEADER_TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
/** Header names a credential may never be written into. */
const FORBIDDEN_AUTH_HEADERS = new Set(['cookie', 'host', 'content-length', 'transfer-encoding', 'connection', 'set-cookie'])

export function parseRelayAuth(raw: unknown): RelayAuth | undefined {
  if (raw === undefined || raw === '') return 'bearer'
  if (typeof raw !== 'string') return undefined
  if (raw === 'bearer' || raw === 'basic') return raw
  if (raw.startsWith('header:')) {
    const name = raw.slice('header:'.length)
    if (name.length <= 100 && HEADER_TOKEN.test(name) && !FORBIDDEN_AUTH_HEADERS.has(name.toLowerCase()) && !name.toLowerCase().startsWith('x-relay-')) {
      return raw as RelayAuth
    }
  }
  return undefined
}

/** The header that carries the credential upstream. Throws on an invalid `header:` name. */
export function authHeaderFor(auth: RelayAuth, secret: string, username?: string): [string, string] {
  if (auth === 'bearer') return ['Authorization', `Bearer ${secret}`]
  if (auth === 'basic') return ['Authorization', `Basic ${Buffer.from(`${username ?? ''}:${secret}`, 'utf8').toString('base64')}`]
  if (parseRelayAuth(auth) !== auth || !auth.startsWith('header:')) throw new Error('Invalid relay auth')
  return [auth.slice('header:'.length), secret]
}

/**
 * Request headers copied from the browser's request. Everything else — cookies, the browser's own
 * Authorization, Origin/Referer, x-relay-*, hop-by-hop headers — stays behind.
 */
export const FORWARDED_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'accept-language',
  'cache-control',
  'anthropic-version',
  'anthropic-beta',
  'openai-organization',
  'openai-project',
  // Fish Audio names the voice engine in a `model` header.
  'model',
  'x-stainless-helper-method',
] as const

/** Response headers passed back to the browser. Upstream cookies and CORS headers never are. */
export const PASSED_RESPONSE_HEADERS = ['content-type', 'cache-control', 'content-disposition', 'retry-after'] as const

export function forwardedRequestHeaders(incoming: Record<string, string | string[] | undefined>): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming[name]
    if (typeof value === 'string' && value) headers[name] = value
    else if (Array.isArray(value) && value.length) headers[name] = value.join(', ')
  }
  return headers
}

export function passedResponseHeaders(upstream: Headers): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const name of PASSED_RESPONSE_HEADERS) {
    const value = upstream.get(name)
    if (value) headers[name] = value
  }
  return headers
}
