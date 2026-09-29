import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

/**
 * The temp-data-dir pattern of `campaignRoll.http.test.ts`, shared: the real app on a free port with
 * a throwaway data folder, so a test never opens the database named in `.env`. Import this from a
 * test only; it imports the app, which opens a database.
 */

/** Two different 1x1 images, and a few bytes standing in for a music track (an ID3 header, so it passes as MP3). */
export const RED_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
export const BLUE_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
export const TRACK = `data:audio/mpeg;base64,${Buffer.from('ID3\u0004\u0000 not really an mp3, but bytes all the same').toString('base64')}`

export interface Reply {
  status: number
  body: any
  headers: http.IncomingHttpHeaders
  raw: Buffer
}

export interface TestServer {
  dataDir: string
  /** JSON in, JSON out, as `cookie`. Sends `body` as raw bytes when it's a Buffer. */
  call: (route: string, method: string, opts?: { body?: unknown; cookie?: string; headers?: Record<string, string> }) => Promise<Reply>
  /** Signs in the first account (the owner) and returns its cookie. */
  setupOwner: (username: string, password: string) => Promise<string>
  /** The owner makes a member account; returns the member's cookie. */
  addMember: (ownerCookie: string, username: string, password: string) => Promise<string>
  close: () => Promise<void>
}

export async function startTestServer(prefix: string): Promise<TestServer> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `lost-tales-${prefix}-`))
  const originalDataDir = process.env.LOST_TALES_DATA_DIR
  const originalLoadEnvFile = process.loadEnvFile
  process.env.LOST_TALES_DATA_DIR = dataDir
  // The test provides its own data directory; do not read the checkout's private .env.
  process.loadEnvFile = () => {}
  const { app } = await import('./app.ts')
  const server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const db = await import('./db.ts')
  if (db.dataDir !== dataDir) throw new Error(`Test server opened ${db.dataDir}, not its temp folder`)

  const call: TestServer['call'] = (route, method, opts = {}) => new Promise((resolve, reject) => {
    const raw = Buffer.isBuffer(opts.body)
    const headers: Record<string, string> = { 'Content-Type': raw ? 'application/octet-stream' : 'application/json', ...opts.headers }
    if (opts.cookie) headers.Cookie = opts.cookie
    const req = http.request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: route, method, headers }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (data: Buffer) => chunks.push(data))
      res.on('end', () => {
        const buffer = Buffer.concat(chunks)
        const json = String(res.headers['content-type'] ?? '').includes('json')
        resolve({ status: res.statusCode!, body: json && buffer.length ? JSON.parse(buffer.toString()) : null, headers: res.headers, raw: buffer })
      })
    })
    req.on('error', reject)
    req.end(opts.body === undefined ? undefined : raw ? opts.body as Buffer : JSON.stringify(opts.body))
  })
  const cookieOf = (reply: Reply) => String(reply.headers['set-cookie']?.[0] ?? '').split(';')[0]

  return {
    dataDir,
    call,
    async setupOwner(username, password) {
      const reply = await call('/api/auth/setup', 'POST', { body: { username, password } })
      if (reply.status !== 201) throw new Error(`Setup failed: ${reply.status}`)
      return cookieOf(reply)
    },
    async addMember(ownerCookie, username, password) {
      const made = await call('/api/users', 'POST', { cookie: ownerCookie, body: { username, password } })
      if (made.status !== 201) throw new Error(`Could not add ${username}: ${made.status}`)
      return cookieOf(await call('/api/auth/login', 'POST', { body: { username, password } }))
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      db.db.close()
      process.loadEnvFile = originalLoadEnvFile
      if (originalDataDir === undefined) delete process.env.LOST_TALES_DATA_DIR
      else process.env.LOST_TALES_DATA_DIR = originalDataDir
      fs.rmSync(dataDir, { recursive: true, force: true })
    },
  }
}
