import express from 'express'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// The real session gate keeps its users in a WeakMap; here the test names the signed-in user.
vi.mock('./auth.ts', () => ({
  currentUser: (req: http.IncomingMessage) => {
    const id = req.headers['x-test-user']
    return typeof id === 'string' ? { id, username: id, role: 'member', createdAt: 0 } : undefined
  },
}))

const ALICE = 'user-alice'
const BOB = 'user-bob'
const ALICE_KEY = 'sk-alice-very-secret-0123456789'

let server: http.Server
let upstream: http.Server
let upstreamOrigin: string
let dataDir: string
let originalDataDir: string | undefined
let originalSecretKey: string | undefined
let originalLoadEnvFile: typeof process.loadEnvFile
let db: typeof import('./db.ts')

interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; body: Buffer }
const seen: Seen[] = []
let releaseStream: () => void = () => {}
let hangClosed: Promise<void> = Promise.resolve()

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-tales-vault-http-'))
  originalDataDir = process.env.LOST_TALES_DATA_DIR
  originalSecretKey = process.env.LOST_TALES_SECRET_KEY
  originalLoadEnvFile = process.loadEnvFile
  process.env.LOST_TALES_DATA_DIR = dataDir
  delete process.env.LOST_TALES_SECRET_KEY
  process.loadEnvFile = () => {}

  db = await import('./db.ts')
  expect(db.dataDir).toBe(dataDir)
  for (const id of [ALICE, BOB]) db.userStore.insert({ id, usernameKey: id, createdAt: Date.now(), username: id, role: 'member' })
  const { meRouter } = await import('./me.ts')
  const { relayRouter } = await import('./relay.ts')
  const app = express()
  app.use(relayRouter)
  app.use(express.json({ limit: '150mb' }))
  app.use(meRouter)
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))

  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      seen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) })
      if (req.url === '/sse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Set-Cookie': 'upstream=1' })
        res.write('data: first\n\n')
        releaseStream = () => { res.write('data: second\n\n'); res.end() }
        return
      }
      if (req.url === '/hang') {
        hangClosed = new Promise<void>((resolve) => res.on('close', () => resolve()))
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('data: waiting\n\n')
        return
      }
      if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://169.254.169.254/latest' }); res.end(); return }
      res.writeHead(201, { 'Content-Type': 'application/octet-stream', 'Retry-After': '3', 'Set-Cookie': 'upstream=1', 'Access-Control-Allow-Origin': '*' })
      res.end(Buffer.concat(chunks))
    })
  })
  upstream.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => upstream.once('listening', resolve))
  upstreamOrigin = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`
})

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  if (upstream) { upstream.closeAllConnections(); await new Promise<void>((resolve) => upstream.close(() => resolve())) }
  db?.db.close()
  process.loadEnvFile = originalLoadEnvFile
  if (originalDataDir === undefined) delete process.env.LOST_TALES_DATA_DIR
  else process.env.LOST_TALES_DATA_DIR = originalDataDir
  if (originalSecretKey !== undefined) process.env.LOST_TALES_SECRET_KEY = originalSecretKey
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
})

interface Reply { status: number; headers: http.IncomingHttpHeaders; body: Buffer; text: string; json: any }

function call(route: string, method: string, options: { user?: string; headers?: Record<string, string>; body?: unknown; raw?: Buffer } = {}): Promise<Reply> {
  const payload = options.raw ?? (options.body === undefined ? undefined : Buffer.from(JSON.stringify(options.body)))
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: route, method,
      headers: { 'Content-Type': 'application/json', ...(options.user ? { 'x-test-user': options.user } : {}), ...options.headers } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        const body = Buffer.concat(chunks)
        const text = body.toString('utf8')
        let json: unknown
        try { json = JSON.parse(text) } catch { json = undefined }
        resolve({ status: res.statusCode!, headers: res.headers, body, text, json })
      })
    })
    req.on('error', reject)
    req.end(payload)
  })
}

function allTableText(): string {
  return JSON.stringify([db.userSecretStore.list(), db.userSettingsStore.list()])
}

describe('credential vault routes', () => {
  it('stores credentials encrypted and only ever reports whether they are set', async () => {
    const initial = await call('/api/me/secrets', 'GET', { user: ALICE })
    expect(initial.status).toBe(200)
    expect(initial.json).toEqual([
      { name: 'chatBackendApiKey', set: false }, { name: 'openMayhemApiKey', set: false },
      { name: 'ttsApiKey', set: false }, { name: 'imageBackendPassword', set: false },
      { name: 'openaiApiKey', set: false }, { name: 'geminiApiKey', set: false },
    ])

    const put = await call('/api/me/secrets/chatBackendApiKey', 'PUT', { user: ALICE, body: { value: ALICE_KEY } })
    expect(put.status).toBe(204)
    expect(put.text).toBe('')
    const after = await call('/api/me/secrets', 'GET', { user: ALICE })
    expect(after.json[0]).toEqual({ name: 'chatBackendApiKey', set: true, updatedAt: expect.any(Number) })
    expect(after.text).not.toContain(ALICE_KEY)
    expect(after.text).not.toContain(ALICE_KEY.slice(-4))
    expect(after.headers['cache-control']).toBe('no-store')
    expect(allTableText()).not.toContain(ALICE_KEY)
    const row = db.userSecretStore.get(`${ALICE}:chatBackendApiKey`)!
    expect(row).toMatchObject({ userId: ALICE, name: 'chatBackendApiKey', iv: expect.any(String), tag: expect.any(String), ciphertext: expect.any(String) })

    // The master key was created in the data directory, readable only by its owner.
    const keyFile = path.join(dataDir, 'secret.key')
    expect(fs.existsSync(keyFile)).toBe(true)
    if (process.platform !== 'win32') expect(fs.statSync(keyFile).mode & 0o777).toBe(0o600)

    // Bob has his own vault.
    expect((await call('/api/me/secrets', 'GET', { user: BOB })).json[0].set).toBe(false)
  })

  it('validates names and values, and deletes on empty or DELETE', async () => {
    expect((await call('/api/me/secrets/password', 'PUT', { user: ALICE, body: { value: 'x' } })).status).toBe(404)
    expect((await call('/api/me/secrets/password', 'DELETE', { user: ALICE })).status).toBe(404)
    expect((await call('/api/me/secrets/ttsApiKey', 'PUT', { user: ALICE, body: { value: 'x'.repeat(8001) } })).status).toBe(400)
    expect((await call('/api/me/secrets/ttsApiKey', 'PUT', { user: ALICE, body: { value: 42 } })).status).toBe(400)
    expect((await call('/api/me/secrets/ttsApiKey', 'PUT', { user: ALICE, body: { value: 'tts-key' } })).status).toBe(204)
    expect((await call('/api/me/secrets/ttsApiKey', 'PUT', { user: ALICE, body: { value: '' } })).status).toBe(204)
    expect((await call('/api/me/secrets', 'GET', { user: ALICE })).json[2]).toEqual({ name: 'ttsApiKey', set: false })
    expect((await call('/api/me/secrets/ttsApiKey', 'PUT', { user: ALICE, body: { value: 'tts-key' } })).status).toBe(204)
    expect((await call('/api/me/secrets/ttsApiKey', 'DELETE', { user: ALICE })).status).toBe(204)
    expect((await call('/api/me/secrets', 'GET', { user: ALICE })).json[2].set).toBe(false)
    expect((await call('/api/me/secrets', 'GET')).status).toBe(401)
  })

  it('saves settings per user and strips every credential field, at any depth', async () => {
    expect((await call('/api/me/settings', 'GET', { user: BOB })).json).toEqual({ settings: null })
    const settings = {
      baseUrl: 'http://localhost:5001', chatBackendApiKey: 'leak-1', theme: 'dark',
      ttsProfiles: { eleven: { ttsBaseUrl: 'https://api.elevenlabs.io', ttsApiKey: 'leak-2' } },
      list: [{ imageBackendPassword: 'leak-3', keep: true }],
    }
    const put = await call('/api/me/settings', 'PUT', { user: BOB, body: { settings } })
    expect(put.status).toBe(200)
    expect(put.json).toEqual({ updatedAt: expect.any(Number) })
    const got = await call('/api/me/settings', 'GET', { user: BOB })
    expect(got.json).toEqual({
      settings: { baseUrl: 'http://localhost:5001', theme: 'dark', ttsProfiles: { eleven: { ttsBaseUrl: 'https://api.elevenlabs.io' } }, list: [{ keep: true }] },
      updatedAt: put.json.updatedAt,
    })
    expect(allTableText()).not.toMatch(/leak-/)
    expect((await call('/api/me/settings', 'GET', { user: ALICE })).json).toEqual({ settings: null })
    expect((await call('/api/me/settings', 'PUT', { user: BOB, body: { settings: [1, 2] } })).status).toBe(400)
    expect((await call('/api/me/settings', 'PUT', { user: BOB, body: { settings: { big: 'x'.repeat(1_100_000) } } })).status).toBe(413)
  })
})

describe('service relay', () => {
  const relay = (user: string, target: string, headers: Record<string, string> = {}, options: { body?: unknown; raw?: Buffer; method?: string } = {}) =>
    call('/api/relay', options.method ?? 'POST', { user, headers: { 'x-relay-target': target, ...headers }, body: options.body, raw: options.raw })

  it('refuses addresses the user has not saved', async () => {
    const before = seen.length
    const reply = await relay(ALICE, `${upstreamOrigin}/echo`)
    expect(reply.status).toBe(403)
    expect(reply.json.error).toContain('Add this address in Settings first')
    expect((await relay(ALICE, '/relative')).status).toBe(400)
    expect((await relay(ALICE, 'file:///etc/passwd')).status).toBe(400)
    expect(seen.length).toBe(before)
  })

  it('attaches the saved credential, forwards the body unchanged and keeps the browser\'s cookie', async () => {
    await call('/api/me/settings', 'PUT', { user: ALICE, body: { settings: { chatBackendBaseUrl: `${upstreamOrigin}/v1` } } })
    const binary = Buffer.from(Array.from({ length: 300_000 }, (_, i) => (i * 7) % 256))
    const reply = await relay(ALICE, `${upstreamOrigin}/echo?x=1`, {
      'x-relay-secret': 'chatBackendApiKey', 'Content-Type': 'application/octet-stream', Cookie: 'lt_session=private',
      Authorization: 'Bearer browser-key', Accept: 'application/octet-stream', Origin: 'http://localhost:5173',
    }, { raw: binary })
    expect(reply.status).toBe(201)
    expect(reply.body.equals(binary)).toBe(true)
    expect(reply.headers['retry-after']).toBe('3')
    expect(reply.headers['set-cookie']).toBeUndefined()
    expect(reply.headers['access-control-allow-origin']).toBeUndefined()
    const request = seen.at(-1)!
    expect(request.url).toBe('/echo?x=1')
    expect(request.headers.authorization).toBe(`Bearer ${ALICE_KEY}`)
    expect(request.headers.cookie).toBeUndefined()
    expect(request.headers.origin).toBeUndefined()
    expect(request.headers['x-test-user']).toBeUndefined()
    expect(Object.keys(request.headers).filter((name) => name.startsWith('x-relay'))).toEqual([])
    expect(request.headers['content-type']).toBe('application/octet-stream')
    expect(request.body.equals(binary)).toBe(true)
  })

  it('passes large JSON through byte-for-byte and supports header and basic credentials', async () => {
    const json = Buffer.from(`{ "prompt" : ${JSON.stringify('y'.repeat(3_000_000))},  "n":1 }`)
    const reply = await relay(ALICE, `${upstreamOrigin}/echo`, { 'x-relay-secret': 'chatBackendApiKey', 'x-relay-auth': 'header:xi-api-key' }, { raw: json })
    expect(reply.status).toBe(201)
    expect(seen.at(-1)!.body.equals(json)).toBe(true)
    expect(seen.at(-1)!.headers['xi-api-key']).toBe(ALICE_KEY)
    expect(seen.at(-1)!.headers.authorization).toBeUndefined()

    await relay(ALICE, `${upstreamOrigin}/echo`, { 'x-relay-secret': 'chatBackendApiKey', 'x-relay-auth': 'basic', 'x-relay-username': 'me' }, { method: 'GET' })
    expect(seen.at(-1)!.method).toBe('GET')
    expect(seen.at(-1)!.headers.authorization).toBe(`Basic ${Buffer.from(`me:${ALICE_KEY}`).toString('base64')}`)

    expect((await relay(ALICE, `${upstreamOrigin}/echo`, { 'x-relay-secret': 'chatBackendApiKey', 'x-relay-auth': 'header:Cookie' })).status).toBe(400)
  })

  it('keeps a key per service, and reaches a service saved in the settings list', async () => {
    const GROQ_KEY = 'gsk-alice-connection-key-0123456789'
    expect((await call('/api/me/secrets/service:BAD', 'PUT', { user: ALICE, body: { value: 'x' } })).status).toBe(404)
    expect((await call('/api/me/secrets/service:groq', 'PUT', { user: ALICE, body: { value: GROQ_KEY } })).status).toBe(204)
    const listed = (await call('/api/me/secrets', 'GET', { user: ALICE })).json as { name: string; set: boolean }[]
    expect(listed).toContainEqual(expect.objectContaining({ name: 'service:groq', set: true }))
    expect(JSON.stringify(listed)).not.toContain(GROQ_KEY)
    expect((await call('/api/me/secrets', 'GET', { user: BOB })).json.some((s: { name: string }) => s.name === 'service:groq')).toBe(false)

    // Only in the services list, not the text model's own address field.
    await call('/api/me/settings', 'PUT', { user: ALICE, body: { settings: { chatBackendBaseUrl: 'https://example.invalid/v1', services: [{ id: 'groq', name: 'Groq', kind: 'openai-compatible', baseUrl: `${upstreamOrigin}/v1` }] } } })
    const reply = await relay(ALICE, `${upstreamOrigin}/v1/chat/completions`, { 'x-relay-secret': 'service:groq', 'Content-Type': 'application/json' }, { body: { model: 'llama' } })
    expect(reply.status).toBe(201)
    expect(seen.at(-1)!.headers.authorization).toBe(`Bearer ${GROQ_KEY}`)
    expect((await relay(ALICE, `${upstreamOrigin}/v1/chat/completions`, { 'x-relay-secret': 'service:other' })).status).toBe(400)
    // A key moves to another name on the server, never over one already saved.
    expect((await call('/api/me/secrets/service:groq/move', 'POST', { user: ALICE, body: { to: 'ttsApiKey' } })).status).toBe(204)
    const moved = (await call('/api/me/secrets', 'GET', { user: ALICE })).json as { name: string; set: boolean }[]
    expect(moved.find((s) => s.name === 'ttsApiKey')?.set).toBe(true)
    expect(moved.some((s) => s.name === 'service:groq')).toBe(false)
    await call('/api/me/secrets/service:groq', 'PUT', { user: ALICE, body: { value: GROQ_KEY } })
    expect((await call('/api/me/secrets/service:groq/move', 'POST', { user: ALICE, body: { to: 'ttsApiKey' } })).status).toBe(409)
    expect((await call('/api/me/secrets/service:nothing/move', 'POST', { user: ALICE, body: { to: 'service:else' } })).status).toBe(409)
    await call('/api/me/secrets/ttsApiKey', 'DELETE', { user: ALICE })
    expect((await call('/api/me/secrets/service:groq', 'DELETE', { user: ALICE })).status).toBe(204)
    expect((await call('/api/me/secrets', 'GET', { user: ALICE })).json.some((s: { name: string }) => s.name === 'service:groq')).toBe(false)
  })

  it('explains a missing credential and never uses another user\'s', async () => {
    await call('/api/me/settings', 'PUT', { user: BOB, body: { settings: { baseUrl: upstreamOrigin } } })
    const before = seen.length
    const reply = await relay(BOB, `${upstreamOrigin}/echo`, { 'x-relay-secret': 'chatBackendApiKey' })
    expect(reply.status).toBe(400)
    expect(reply.json).toEqual({ error: 'No chatBackendApiKey saved for your account' })
    expect((await relay(BOB, `${upstreamOrigin}/echo`, { 'x-relay-secret': 'somethingElse' })).status).toBe(400)
    expect(seen.length).toBe(before)
    // Without a named secret the call goes out with no credential at all.
    await relay(BOB, `${upstreamOrigin}/echo`, {}, { body: { a: 1 } })
    expect(seen.at(-1)!.headers.authorization).toBeUndefined()
    expect(seen.at(-1)!.body.toString()).toBe('{"a":1}')
  })

  it('streams server-sent events as they arrive', async () => {
    const port = (server.address() as AddressInfo).port
    const firstChunk = await new Promise<{ status: number; type?: string; chunk: string; rest: Promise<string> }>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/api/relay', method: 'POST',
        headers: { 'x-test-user': ALICE, 'x-relay-target': `${upstreamOrigin}/sse`, 'x-relay-secret': 'chatBackendApiKey', 'Content-Type': 'application/json', Accept: 'text/event-stream' } }, (res) => {
        let text = ''
        let first = true
        let finish: (value: string) => void
        const rest = new Promise<string>((done) => { finish = done })
        res.on('data', (data) => {
          text += data
          if (first) { first = false; resolve({ status: res.statusCode!, type: res.headers['content-type'], chunk: text, rest }) }
        })
        res.on('end', () => finish(text))
      })
      req.on('error', reject)
      req.end('{"stream":true}')
    })
    // The upstream has not finished; the first event already reached the browser.
    expect(firstChunk.status).toBe(200)
    expect(firstChunk.type).toBe('text/event-stream')
    expect(firstChunk.chunk).toBe('data: first\n\n')
    releaseStream()
    expect(await firstChunk.rest).toBe('data: first\n\ndata: second\n\n')
  })

  it('does not follow redirects and reports unreachable services readably', async () => {
    const redirect = await relay(ALICE, `${upstreamOrigin}/redirect`, {}, { method: 'GET' })
    expect(redirect.status).toBe(502)
    expect(redirect.json.error).toContain('redirect')

    const closed = http.createServer()
    closed.listen(0, '127.0.0.1')
    await new Promise<void>((resolve) => closed.once('listening', resolve))
    const deadOrigin = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`
    await new Promise<void>((resolve) => closed.close(() => resolve()))
    await call('/api/me/settings', 'PUT', { user: ALICE, body: { settings: { chatBackendBaseUrl: upstreamOrigin, ttsBaseUrl: deadOrigin } } })
    const refused = await relay(ALICE, `${deadOrigin}/v1/audio/speech`, { 'x-relay-secret': 'chatBackendApiKey' })
    expect(refused.status).toBe(502)
    expect(refused.json.error).toMatch(/^Could not reach 127\.0\.0\.1:\d+: the connection was refused/)
    expect(refused.text).not.toContain(ALICE_KEY)
  })

  it('stops the upstream call when the browser goes away', async () => {
    const port = (server.address() as AddressInfo).port
    await new Promise<void>((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: '/api/relay', method: 'GET',
        headers: { 'x-test-user': ALICE, 'x-relay-target': `${upstreamOrigin}/hang` } }, (res) => {
        res.once('data', () => { req.destroy(); resolve() })
      })
      req.on('error', () => {})
      req.on('timeout', reject)
      req.end()
    })
    await hangClosed
  })
})
