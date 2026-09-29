import { describe, expect, it } from 'vitest'
import {
  LOGIN_FIRST_LOCK_MS,
  LOGIN_MAX_LOCK_MS,
  LoginRateLimiter,
  SESSION_RENEW_AFTER_MS,
  SESSION_TTL_MS,
  SETUP_CODE_ALPHABET,
  SETUP_CODE_TTL_MS,
  clientAddress,
  emailKey,
  generateSetupCode,
  generateToken,
  hashSetupCode,
  looksLikeEmail,
  normalizeSetupCode,
  pathAllowedWhileSettingPassword,
  setupCodeExpiry,
  setupCodeIsLive,
  validateEmail,
  verifySetupCode,
  hashPassword,
  hashToken,
  isHttpsRequest,
  isLocalSetupRequest,
  parseCookies,
  pathRequiresAuth,
  sessionCookie,
  sessionExpiry,
  sessionIsLive,
  sessionNeedsRenewal,
  usernameKey,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './authPlan.ts'

const CHEAP = { N: 1024, r: 8, p: 1 }

describe('password hashing', () => {
  it('round-trips and rejects a wrong password', async () => {
    const stored = await hashPassword('correct horse battery', CHEAP)
    expect(stored).toMatch(/^scrypt\$1024\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
    expect(await verifyPassword('correct horse battery', stored)).toBe(true)
    expect(await verifyPassword('correct horse batterx', stored)).toBe(false)
  })

  it('salts every hash', async () => {
    expect(await hashPassword('same password here', CHEAP)).not.toBe(await hashPassword('same password here', CHEAP))
  })

  it('uses the default cost in a reasonable time', async () => {
    const started = Date.now()
    const stored = await hashPassword('a default-cost password')
    expect(stored.startsWith('scrypt$32768$8$1$')).toBe(true)
    expect(await verifyPassword('a default-cost password', stored)).toBe(true)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('treats malformed or oversized hashes as a mismatch', async () => {
    for (const bad of ['', 'plain', 'bcrypt$1$2$3$4$5', 'scrypt$1000$8$1$c2FsdA==$aGFzaA==', 'scrypt$2097152$8$1$c2FsdA==$aGFzaA==', 'scrypt$1024$8$1$$']) {
      expect(await verifyPassword('anything at all', bad)).toBe(false)
    }
  })
})

describe('usernames and passwords', () => {
  it('accepts plain names and rejects the rest', () => {
    expect(validateUsername('some_user.name-1')).toBeNull()
    expect(validateUsername('ab')).toMatch(/3 to 32/)
    expect(validateUsername('x'.repeat(33))).toMatch(/3 to 32/)
    expect(validateUsername('has space')).toMatch(/letters/)
    expect(validateUsername('ünicode')).toMatch(/letters/)
    expect(validateUsername(undefined)).toMatch(/required/)
  })

  it('bounds password length', () => {
    expect(validatePassword('x'.repeat(10))).toBeNull()
    expect(validatePassword('x'.repeat(9))).toMatch(/at least 10/)
    expect(validatePassword('x'.repeat(201))).toMatch(/at most 200/)
    expect(validatePassword(42)).toMatch(/required/)
  })

  it('looks names up case-insensitively', () => {
    expect(usernameKey('SomeUser')).toBe('someuser')
  })
})

describe('tokens and sessions', () => {
  it('makes distinct url-safe tokens and hashes them to hex', () => {
    const a = generateToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generateToken()).not.toBe(a)
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(a)).toBe(hashToken(a))
  })

  it('expires after thirty days and renews once a day', () => {
    const now = 1_000_000_000_000
    expect(sessionExpiry(now)).toBe(now + SESSION_TTL_MS)
    expect(SESSION_TTL_MS).toBe(30 * 24 * 3600 * 1000)
    expect(sessionIsLive({ expiresAt: now + 1 }, now)).toBe(true)
    expect(sessionIsLive({ expiresAt: now }, now)).toBe(false)
    expect(sessionNeedsRenewal({ lastSeenAt: now - 1000 }, now)).toBe(false)
    expect(sessionNeedsRenewal({ lastSeenAt: now - SESSION_RENEW_AFTER_MS - 1 }, now)).toBe(true)
  })
})

describe('isLocalSetupRequest', () => {
  const local = { remoteAddress: '127.0.0.1', headers: { host: 'localhost:5173' } }

  it('allows loopback with a loopback Host', () => {
    expect(isLocalSetupRequest(local)).toBe(true)
    expect(isLocalSetupRequest({ remoteAddress: '::1', headers: { host: '[::1]:3001' } })).toBe(true)
    expect(isLocalSetupRequest({ remoteAddress: '::ffff:127.0.0.1', headers: { host: '127.0.0.1' } })).toBe(true)
  })

  it('refuses other socket addresses', () => {
    expect(isLocalSetupRequest({ ...local, remoteAddress: '192.168.1.20' })).toBe(false)
    expect(isLocalSetupRequest({ ...local, remoteAddress: undefined })).toBe(false)
  })

  it('refuses a tunnel or proxy even from loopback', () => {
    for (const header of ['cf-connecting-ip', 'cf-ray', 'x-forwarded-for', 'x-real-ip', 'forwarded']) {
      expect(isLocalSetupRequest({ ...local, headers: { ...local.headers, [header]: '203.0.113.9' } })).toBe(false)
    }
  })

  it('refuses a public Host name or none', () => {
    expect(isLocalSetupRequest({ ...local, headers: { host: 'play.example.com' } })).toBe(false)
    expect(isLocalSetupRequest({ ...local, headers: { host: 'localhost.example.com' } })).toBe(false)
    expect(isLocalSetupRequest({ ...local, headers: {} })).toBe(false)
  })
})

describe('clientAddress', () => {
  it('prefers the address Cloudflare reports', () => {
    expect(clientAddress({ remoteAddress: '127.0.0.1', headers: { 'cf-connecting-ip': '203.0.113.9' } })).toBe('203.0.113.9')
    expect(clientAddress({ remoteAddress: '127.0.0.1', headers: {} })).toBe('127.0.0.1')
  })
})

describe('LoginRateLimiter', () => {
  it('locks after five failures, doubles, caps, and clears on success', () => {
    const limiter = new LoginRateLimiter()
    const key = LoginRateLimiter.key('SomeUser', '203.0.113.9')
    expect(key).toBe(LoginRateLimiter.key('someuser', '203.0.113.9'))
    let now = 0
    for (let i = 0; i < 4; i++) limiter.fail(key, now)
    expect(limiter.retryAfter(key, now)).toBe(0)
    limiter.fail(key, now)
    expect(limiter.retryAfter(key, now)).toBe(LOGIN_FIRST_LOCK_MS)
    now += LOGIN_FIRST_LOCK_MS
    expect(limiter.retryAfter(key, now)).toBe(0)
    limiter.fail(key, now)
    expect(limiter.retryAfter(key, now)).toBe(2 * LOGIN_FIRST_LOCK_MS)
    for (let i = 0; i < 10; i++) limiter.fail(key, now)
    expect(limiter.retryAfter(key, now)).toBe(LOGIN_MAX_LOCK_MS)
    limiter.succeed(key)
    expect(limiter.retryAfter(key, now)).toBe(0)
  })

  it('keeps keys apart and prunes stale ones', () => {
    const limiter = new LoginRateLimiter()
    const a = LoginRateLimiter.key('one', '198.51.100.1')
    const b = LoginRateLimiter.key('one', '198.51.100.2')
    for (let i = 0; i < 5; i++) limiter.fail(a, 0)
    expect(limiter.retryAfter(b, 0)).toBe(0)
    limiter.fail(b, 0)
    limiter.prune(LOGIN_MAX_LOCK_MS + 1)
    expect(limiter.size).toBe(0)
  })
})

describe('cookies', () => {
  it('parses a Cookie header', () => {
    expect(parseCookies('a=1; lt_session=abc%2Fdef; b="quoted"; broken; =x; a=2')).toEqual({ a: '1', lt_session: 'abc/def', b: 'quoted' })
    expect(parseCookies(undefined)).toEqual({})
  })

  it('writes the session cookie', () => {
    expect(sessionCookie('tok', { secure: false })).toBe('lt_session=tok; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax')
    expect(sessionCookie('tok', { secure: true })).toMatch(/; Secure$/)
    expect(sessionCookie('', { secure: false })).toMatch(/Max-Age=0/)
  })

  it('detects https directly or through a proxy', () => {
    expect(isHttpsRequest({ secure: true, headers: {} })).toBe(true)
    expect(isHttpsRequest({ secure: false, headers: { 'x-forwarded-proto': 'https' } })).toBe(true)
    expect(isHttpsRequest({ secure: false, headers: { 'cf-visitor': '{"scheme":"https"}' } })).toBe(true)
    expect(isHttpsRequest({ secure: false, headers: {} })).toBe(false)
  })
})

describe('pathRequiresAuth', () => {
  it('gates the API and character art but not the sign-in endpoints or the app shell', () => {
    for (const p of ['/api/chats', '/API/Chats', '/api', '/api/', '//api/chats', '/%61pi/chats', '/avatars/x/avatar.png', '/api/auth/logout', '/api/auth/login/../chats', '/api/users'])
      expect(pathRequiresAuth(p)).toBe(true)
    for (const p of ['/api/auth/status', '/API/auth/status/', '/api/auth/setup', '/api/auth/login', '/', '/index.html', '/assets/app.js'])
      expect(pathRequiresAuth(p)).toBe(false)
  })
})

describe('pathAllowedWhileSettingPassword', () => {
  it('lets a setup-code session reach only status, logout and set-password', () => {
    for (const p of ['/api/auth/status', '/api/auth/logout', '/API/auth/set-password/', '/api/auth/login', '/'])
      expect(pathAllowedWhileSettingPassword(p)).toBe(true)
    for (const p of ['/api/chats', '/api/auth/password', '/api/me/settings', '/api/users', '/avatars/x.png', '/api/relay'])
      expect(pathAllowedWhileSettingPassword(p)).toBe(false)
  })
})

describe('email', () => {
  it('checks the basic shape and folds case', () => {
    expect(validateEmail('someone@example.com')).toBeNull()
    expect(validateEmail('some.one+tag@mail.example.org')).toBeNull()
    for (const bad of ['', 'plain', 'no@dot', '@example.com', 'a b@example.com', 'a@@example.com', 'a@example.', `${'x'.repeat(250)}@example.com`])
      expect(validateEmail(bad)).not.toBeNull()
    expect(validateEmail(undefined)).toMatch(/required/)
    expect(emailKey('  Some.One@Example.COM ')).toBe('some.one@example.com')
    expect(looksLikeEmail('someone@example.com')).toBe(true)
    expect(looksLikeEmail('someone')).toBe(false)
  })
})

describe('setup codes', () => {
  it('are twelve unambiguous characters shown in groups of four', () => {
    expect(SETUP_CODE_ALPHABET).not.toMatch(/[01OIL]/)
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const code = generateSetupCode()
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
      expect(code).not.toMatch(/[01OIL]/)
      seen.add(code)
    }
    expect(seen.size).toBe(50)
  })

  it('normalize case, dashes and spaces, and reject anything else', () => {
    expect(normalizeSetupCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN')
    expect(normalizeSetupCode(' ABCD EFGH JKMN ')).toBe('ABCDEFGHJKMN')
    expect(normalizeSetupCode('ABCDEFGHJKMN')).toBe('ABCDEFGHJKMN')
    expect(normalizeSetupCode('ABCD-EFGH-JKM')).toBeNull()
    expect(normalizeSetupCode('ABCD-EFGH-JKM0')).toBeNull()
    expect(normalizeSetupCode('ABCD-EFGH-JKMI')).toBeNull()
    expect(normalizeSetupCode(42)).toBeNull()
  })

  it('hash like passwords and verify in any accepted spelling', async () => {
    const code = generateSetupCode()
    const stored = await hashSetupCode(code, CHEAP)
    expect(stored.startsWith('scrypt$1024$8$1$')).toBe(true)
    expect(stored).not.toContain(code.replace(/-/g, ''))
    expect(await verifySetupCode(code, stored)).toBe(true)
    expect(await verifySetupCode(code.toLowerCase().replace(/-/g, ''), stored)).toBe(true)
    expect(await verifySetupCode(generateSetupCode(), stored)).toBe(false)
    expect(await verifySetupCode('not a code', stored)).toBe(false)
    await expect(hashSetupCode('bad')).rejects.toThrow()
  })

  it('expire after 72 hours', () => {
    const now = 1_000_000_000_000
    expect(SETUP_CODE_TTL_MS).toBe(72 * 3600 * 1000)
    expect(setupCodeExpiry(now)).toBe(now + SETUP_CODE_TTL_MS)
    expect(setupCodeIsLive(now + 1, now)).toBe(true)
    expect(setupCodeIsLive(now, now)).toBe(false)
    expect(setupCodeIsLive(undefined, now)).toBe(false)
  })
})
