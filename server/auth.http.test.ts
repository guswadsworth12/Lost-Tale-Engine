import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let server: http.Server
let dataDir: string
let originalDataDir: string | undefined
let originalLoadEnvFile: typeof process.loadEnvFile

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-tales-auth-http-'))
  originalDataDir = process.env.LOST_TALES_DATA_DIR
  originalLoadEnvFile = process.loadEnvFile
  process.env.LOST_TALES_DATA_DIR = dataDir
  // The test provides its own data directory; do not read the checkout's private .env.
  process.loadEnvFile = () => {}
  const { app } = await import('./app.ts')
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const db = await import('./db.ts')
  expect(db.dataDir).toBe(dataDir)
})

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  const { db } = await import('./db.ts')
  db.close()
  process.loadEnvFile = originalLoadEnvFile
  if (originalDataDir === undefined) delete process.env.LOST_TALES_DATA_DIR
  else process.env.LOST_TALES_DATA_DIR = originalDataDir
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
})

interface Reply {
  status: number
  body: Record<string, any> | any[] | null
  setCookie: string | undefined
}

function call(route: string, method: string, opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...opts.headers }
    if (opts.cookie) headers.Cookie = opts.cookie
    const req = http.request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: route, method, headers }, (res) => {
      let content = ''
      res.on('data', (data) => { content += data })
      res.on('end', () => {
        const setCookie = res.headers['set-cookie']?.[0]
        resolve({ status: res.statusCode!, body: content ? JSON.parse(content) : null, setCookie })
      })
    })
    req.on('error', reject)
    req.end(opts.body === undefined ? undefined : JSON.stringify(opts.body))
  })
}

/** The `lt_session=...` pair from a Set-Cookie header, ready to send back. */
function cookieOf(reply: Reply): string {
  expect(reply.setCookie).toMatch(/^lt_session=[A-Za-z0-9_-]+;/)
  return reply.setCookie!.split(';')[0]
}

async function login(username: string, password: string, headers?: Record<string, string>): Promise<Reply> {
  return call('/api/auth/login', 'POST', { body: { username, password }, headers })
}

const OWNER = { username: 'OwnerName', password: 'owner-password-1' }
const MEMBER = { username: 'member_one', password: 'member-password-1' }
const TUNNEL = { 'cf-connecting-ip': '203.0.113.7', 'cf-ray': 'test-ray' }

describe('accounts over HTTP', () => {
  let ownerCookie: string
  let memberCookie: string
  let memberId: string

  it('reports that setup is needed, and only allows it here', async () => {
    const status = await call('/api/auth/status', 'GET')
    expect(status.status).toBe(200)
    expect(status.body).toEqual({ user: null, needsSetup: true, setupAllowedHere: true })
    const viaTunnel = await call('/api/auth/status', 'GET', { headers: TUNNEL })
    expect(viaTunnel.body).toEqual({ user: null, needsSetup: true, setupAllowedHere: false })
  })

  it('gates the API and character art before anyone signs in', async () => {
    expect((await call('/api/chats', 'GET')).status).toBe(401)
    expect((await call('/api/chats', 'GET')).body).toEqual({ error: 'Sign in required' })
    expect((await call('/API/chats', 'GET')).status).toBe(401)
    expect((await call('/avatars/anything.png', 'GET')).status).toBe(401)
    expect((await call('/api/backup', 'GET')).status).toBe(401)
  })

  it('refuses setup through a tunnel', async () => {
    const reply = await call('/api/auth/setup', 'POST', { body: OWNER, headers: TUNNEL })
    expect(reply.status).toBe(403)
    expect(reply.setCookie).toBeUndefined()
    expect((await call('/api/auth/setup', 'POST', { body: OWNER, headers: { 'x-forwarded-for': '203.0.113.7' } })).status).toBe(403)
    expect((await call('/api/auth/setup', 'POST', { body: OWNER, headers: { host: 'play.example.com' } })).status).toBe(403)
  })

  it('validates the first account', async () => {
    expect((await call('/api/auth/setup', 'POST', { body: { username: 'ab', password: OWNER.password } })).status).toBe(400)
    expect((await call('/api/auth/setup', 'POST', { body: { username: OWNER.username, password: 'short' } })).status).toBe(400)
  })

  it('sets up the owner locally, once', async () => {
    const reply = await call('/api/auth/setup', 'POST', { body: OWNER })
    expect(reply.status).toBe(201)
    expect(reply.setCookie).toMatch(/; Path=\/; Max-Age=2592000; HttpOnly; SameSite=Lax$/)
    expect(reply.body).toMatchObject({ user: { username: OWNER.username, role: 'owner' }, needsSetup: false, setupAllowedHere: false })
    ownerCookie = cookieOf(reply)
    expect((await call('/api/auth/setup', 'POST', { body: { username: 'second_owner', password: 'another-password' } })).status).toBe(409)
  })

  it('lets a signed-in request through the gate', async () => {
    const chats = await call('/api/chats', 'GET', { cookie: ownerCookie })
    expect(chats.status).toBe(200)
    expect(Array.isArray(chats.body)).toBe(true)
    const status = await call('/api/auth/status', 'GET', { cookie: ownerCookie })
    expect(status.body).toMatchObject({ user: { username: OWNER.username, role: 'owner' }, needsSetup: false })
    expect((await call('/api/chats', 'GET', { cookie: 'lt_session=not-a-real-token' })).status).toBe(401)
  })

  it('signs in case-insensitively, and out again', async () => {
    const wrong = await login(OWNER.username, 'not-the-password')
    expect(wrong.status).toBe(401)
    expect(wrong.body).toEqual({ error: 'Wrong username or password' })
    const unknown = await login('nobody_here', 'not-the-password')
    expect(unknown.body).toEqual({ error: 'Wrong username or password' })

    const reply = await login(OWNER.username.toUpperCase(), OWNER.password)
    expect(reply.status).toBe(200)
    const cookie = cookieOf(reply)
    expect((await call('/api/chats', 'GET', { cookie })).status).toBe(200)
    const out = await call('/api/auth/logout', 'POST', { cookie })
    expect(out.status).toBe(204)
    expect(out.setCookie).toMatch(/^lt_session=; .*Max-Age=0/)
    expect((await call('/api/chats', 'GET', { cookie })).status).toBe(401)
    // The owner's other session is untouched.
    expect((await call('/api/chats', 'GET', { cookie: ownerCookie })).status).toBe(200)
  })

  it('marks the cookie Secure when the browser came over https', async () => {
    const reply = await login(OWNER.username, OWNER.password, { 'x-forwarded-proto': 'https' })
    expect(reply.setCookie).toMatch(/; Secure$/)
  })

  it('lets the owner manage users, and nobody else', async () => {
    const created = await call('/api/users', 'POST', { cookie: ownerCookie, body: MEMBER })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ username: MEMBER.username, role: 'member' })
    expect(created.body).not.toHaveProperty('passwordHash')
    memberId = (created.body as Record<string, any>).id
    expect((await call('/api/users', 'POST', { cookie: ownerCookie, body: { ...MEMBER, username: MEMBER.username.toUpperCase() } })).status).toBe(409)
    expect((await call('/api/users', 'POST', { cookie: ownerCookie, body: { ...MEMBER, username: 'other', role: 'admin' } })).status).toBe(400)

    const list = await call('/api/users', 'GET', { cookie: ownerCookie })
    expect((list.body as any[]).map((u) => u.username)).toEqual([OWNER.username, MEMBER.username])
    expect(JSON.stringify(list.body)).not.toMatch(/scrypt/)

    memberCookie = cookieOf(await login(MEMBER.username, MEMBER.password))
    expect((await call('/api/chats', 'GET', { cookie: memberCookie })).status).toBe(200)
    expect((await call('/api/users', 'GET', { cookie: memberCookie })).status).toBe(403)
    expect((await call('/api/users', 'POST', { cookie: memberCookie, body: { username: 'sneaky', password: 'sneaky-password' } })).status).toBe(403)
    // Backup and restore cover everyone's shared data: owner only.
    expect((await call('/api/backup', 'GET', { cookie: memberCookie })).status).toBe(403)
    expect((await call('/api/restore', 'POST', { cookie: memberCookie, body: { version: 1, data: {} } })).status).toBe(403)
    expect((await call(`/api/users/${memberId}`, 'DELETE', { cookie: memberCookie })).status).toBe(403)
  })

  it('changes your own password and signs out your other browsers', async () => {
    const second = cookieOf(await login(MEMBER.username, MEMBER.password))
    expect((await call('/api/auth/password', 'POST', { cookie: memberCookie, body: { current: 'wrong-password', next: 'member-password-2' } })).status).toBe(400)
    expect((await call('/api/auth/password', 'POST', { cookie: memberCookie, body: { current: MEMBER.password, next: 'member-password-2' } })).status).toBe(204)
    expect((await call('/api/chats', 'GET', { cookie: memberCookie })).status).toBe(200)
    expect((await call('/api/chats', 'GET', { cookie: second })).status).toBe(401)
    expect((await login(MEMBER.username, MEMBER.password)).status).toBe(401)
    expect((await login(MEMBER.username, 'member-password-2')).status).toBe(200)
  })

  it('lets the owner reset a password, which signs that user out', async () => {
    expect((await call(`/api/users/${memberId}/password`, 'POST', { cookie: ownerCookie, body: { password: 'member-password-3' } })).status).toBe(204)
    expect((await call('/api/chats', 'GET', { cookie: memberCookie })).status).toBe(401)
    memberCookie = cookieOf(await login(MEMBER.username, 'member-password-3'))
  })

  it('rate limits repeated failures, even with the right password', async () => {
    const headers = { 'cf-connecting-ip': '198.51.100.44' }
    for (let i = 0; i < 5; i++) expect((await login(MEMBER.username, 'wrong-password', headers)).status).toBe(401)
    const locked = await login(MEMBER.username, 'member-password-3', headers)
    expect(locked.status).toBe(429)
    expect((locked.body as Record<string, any>).error).toMatch(/Too many attempts/)
    // Another address is not held up by it.
    expect((await login(MEMBER.username, 'member-password-3', { 'cf-connecting-ip': '198.51.100.45' })).status).toBe(200)
  })

  it('deletes a user with their sessions, but never yourself', async () => {
    const owner = (await call('/api/auth/status', 'GET', { cookie: ownerCookie })).body as Record<string, any>
    expect((await call(`/api/users/${owner.user.id}`, 'DELETE', { cookie: ownerCookie })).status).toBe(400)
    expect((await call('/api/chats', 'GET', { cookie: memberCookie })).status).toBe(200)
    expect((await call(`/api/users/${memberId}`, 'DELETE', { cookie: ownerCookie })).status).toBe(204)
    expect((await call('/api/chats', 'GET', { cookie: memberCookie })).status).toBe(401)
    expect((await call(`/api/users/${memberId}`, 'DELETE', { cookie: ownerCookie })).status).toBe(404)
    const { sessionStore } = await import('./db.ts')
    expect(sessionStore.list({ where: 'userId = ?', params: [memberId] })).toEqual([])
  })

  it('keeps accounts out of backups and restores', async () => {
    const backup = await call('/api/backup', 'GET', { cookie: ownerCookie })
    expect(backup.status).toBe(200)
    const data = (backup.body as Record<string, any>).data
    for (const key of ['users', 'sessions', 'userSecrets', 'userSettings', 'user_secrets', 'user_settings']) expect(data).not.toHaveProperty(key)
    expect(JSON.stringify(backup.body)).not.toMatch(/scrypt\$/)
    const restored = await call('/api/restore', 'POST', { cookie: ownerCookie, body: { ...(backup.body as object), data: { ...data, users: [] } } })
    expect(restored.status).toBe(204)
    expect((await call('/api/chats', 'GET', { cookie: ownerCookie })).status).toBe(200)
    expect((await login(OWNER.username, OWNER.password)).status).toBe(200)
  })
})

describe('setup codes over HTTP', () => {
  let ownerCookie: string
  let guest: { id: string; code: string }
  const GUEST = { username: 'guest_player', email: 'Guest.Player@Example.com' }

  beforeAll(async () => {
    ownerCookie = cookieOf(await login(OWNER.username, OWNER.password))
  })

  it('creates a user with a one-time code when no password is given', async () => {
    const reply = await call('/api/users', 'POST', { cookie: ownerCookie, body: GUEST })
    expect(reply.status).toBe(201)
    const issued = reply.body as Record<string, any>
    expect(issued.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(issued.expiresAt).toBeGreaterThan(Date.now() + 71 * 3600 * 1000)
    expect(issued.user).toMatchObject({ username: GUEST.username, email: GUEST.email, role: 'member', mustSetPassword: true })
    guest = { id: issued.user.id, code: issued.code }

    const list = (await call('/api/users', 'GET', { cookie: ownerCookie })).body as any[]
    expect(list.find((u) => u.id === guest.id)).toMatchObject({ email: GUEST.email, mustSetPassword: true })
    expect(JSON.stringify(list)).not.toContain(guest.code)
    expect((await call('/api/users', 'POST', { cookie: ownerCookie, body: { username: 'other_guest', email: GUEST.email.toUpperCase() } })).status).toBe(409)
    expect((await call('/api/users', 'POST', { cookie: ownerCookie, body: { username: 'other_guest', email: 'not-an-email' } })).status).toBe(400)
  })

  it('signs in with the code, then allows nothing but choosing a password', async () => {
    const reply = await login(GUEST.username, guest.code.toLowerCase().replace(/-/g, ''))
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({ user: { username: GUEST.username, mustSetPassword: true }, mustSetPassword: true })
    const cookie = cookieOf(reply)
    const status = await call('/api/auth/status', 'GET', { cookie })
    expect(status.body).toMatchObject({ mustSetPassword: true })
    for (const route of ['/api/chats', '/api/me/settings', '/avatars/x.png', '/api/users']) {
      const blocked = await call(route, 'GET', { cookie })
      expect(blocked.status).toBe(403)
      expect(blocked.body).toEqual({ error: 'Choose your password first' })
    }
    expect((await call('/api/auth/password', 'POST', { cookie, body: { current: guest.code, next: 'guest-password-1' } })).status).toBe(403)
    expect((await call('/api/auth/set-password', 'POST', { cookie, body: { password: 'short' } })).status).toBe(400)

    const set = await call('/api/auth/set-password', 'POST', { cookie, body: { password: 'guest-password-1' } })
    expect(set.status).toBe(200)
    expect(set.body).toMatchObject({ user: { username: GUEST.username }, needsSetup: false })
    expect((set.body as Record<string, any>).mustSetPassword).toBeUndefined()
    expect((set.body as Record<string, any>).user.mustSetPassword).toBeUndefined()
    expect((await call('/api/chats', 'GET', { cookie })).status).toBe(200)
    expect((await call('/api/auth/set-password', 'POST', { cookie, body: { password: 'guest-password-2' } })).status).toBe(409)
    // The code is spent; the new password works.
    expect((await login(GUEST.username, guest.code)).status).toBe(401)
    expect((await login(GUEST.username, 'guest-password-1')).status).toBe(200)
  })

  it('signs in by email, in any case', async () => {
    const reply = await login(GUEST.email.toLowerCase(), 'guest-password-1')
    expect(reply.status).toBe(200)
    expect(reply.body).toMatchObject({ user: { username: GUEST.username } })
    expect((await login('nobody@example.com', 'guest-password-1')).body).toEqual({ error: 'Wrong username or password' })
  })

  it('lets the owner issue a new code, which signs the user out and retires the password', async () => {
    const cookie = cookieOf(await login(GUEST.username, 'guest-password-1'))
    const issued = await call(`/api/users/${guest.id}/setup-code`, 'POST', { cookie: ownerCookie })
    expect(issued.status).toBe(200)
    expect(issued.body).toMatchObject({ user: { id: guest.id, mustSetPassword: true } })
    guest.code = (issued.body as Record<string, any>).code
    expect((await call('/api/chats', 'GET', { cookie })).status).toBe(401)
    expect((await login(GUEST.username, 'guest-password-1')).status).toBe(401)
    expect((await login(GUEST.username, guest.code)).status).toBe(200)
    const owner = (await call('/api/auth/status', 'GET', { cookie: ownerCookie })).body as Record<string, any>
    expect((await call(`/api/users/${owner.user.id}/setup-code`, 'POST', { cookie: ownerCookie })).status).toBe(400)
    expect((await call('/api/users/no-such-user/setup-code', 'POST', { cookie: ownerCookie })).status).toBe(404)
  })

  it('refuses an expired code with its own message', async () => {
    const { userStore } = await import('./db.ts')
    userStore.update(guest.id, { setupCodeExpiresAt: Date.now() - 1000 })
    const reply = await login(GUEST.username, guest.code)
    expect(reply.status).toBe(401)
    expect(reply.body).toEqual({ error: 'This setup code has expired. Ask the owner for a new one.' })
    expect(reply.setCookie).toBeUndefined()
    // A wrong code still gets the generic answer.
    expect((await login(GUEST.username, 'AAAA-BBBB-CCCC')).body).toEqual({ error: 'Wrong username or password' })
  })

  it('rate limits wrong codes', async () => {
    const issued = await call(`/api/users/${guest.id}/setup-code`, 'POST', { cookie: ownerCookie })
    guest.code = (issued.body as Record<string, any>).code
    const headers = { 'cf-connecting-ip': '198.51.100.77' }
    for (let i = 0; i < 5; i++) expect((await login(GUEST.username, 'AAAA-BBBB-CCCC', headers)).status).toBe(401)
    expect((await login(GUEST.email, guest.code, headers)).status).toBe(429)
  })
})
