import express from 'express'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { currentUser } from './auth.ts'
import { userSettingsStore } from './db.ts'
import { revealSecretForOutgoingRequest } from './vault.ts'
import {
  authHeaderFor,
  forwardedRequestHeaders,
  parseRelayAuth,
  parseRelayTarget,
  passedResponseHeaders,
  relayTargetAllowed,
} from './relayPlan.ts'
import { RELAY_HEADERS, RELAY_PATH, isSecretName } from '../src/lib/accounts/contract.ts'

/**
 * The relay: the browser asks the server to make a service call on its behalf, so a saved
 * credential can be attached without ever reaching the browser. The target must be one of the
 * user's saved service addresses (or a fixed provider); the request body passes through untouched
 * and the reply streams back as it arrives (SSE token streams included).
 *
 * Mount before any global JSON body parser so the body arrives byte-for-byte.
 */

export const MAX_RELAY_BODY = '25mb'
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])

export const relayRouter = express.Router()

const rawBody = express.raw({ type: () => true, limit: MAX_RELAY_BODY })

function fail(res: express.Response, status: number, error: string) {
  res.status(status).json({ error })
}

/** The body exactly as sent, or — if a JSON parser already consumed it — its re-serialization. */
function outgoingBody(req: express.Request): Buffer | string | undefined {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  if (Buffer.isBuffer(req.body)) return req.body.length ? req.body : undefined
  if ((req as { _body?: boolean })._body && req.body !== undefined) return JSON.stringify(req.body)
  return undefined
}

function unreachableMessage(host: string, error: unknown): string {
  const cause = (error as { cause?: { code?: string } })?.cause
  const code = cause?.code ?? (error as { code?: string })?.code
  const reason = code === 'ECONNREFUSED' ? 'the connection was refused — is it running?'
    : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'that address could not be found'
    : code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT' ? 'the connection timed out'
    : code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' ? 'the connection was dropped'
    : typeof code === 'string' && /CERT|SSL|TLS/i.test(code) ? 'its security certificate was not accepted'
    : 'the request failed'
  return `Could not reach ${host}: ${reason}.`
}

relayRouter.all(RELAY_PATH, rawBody, async (req, res) => {
  const user = currentUser(req)
  if (!user) { fail(res, 401, 'Sign in first'); return }
  if (!METHODS.has(req.method)) { fail(res, 405, 'The relay does not forward this method'); return }

  const target = parseRelayTarget(req.get(RELAY_HEADERS.target))
  if (!target) { fail(res, 400, `Send the service address as an absolute http(s) URL in ${RELAY_HEADERS.target}`); return }

  const saved = userSettingsStore.get(user.id)?.settings
  const settings = saved && typeof saved === 'object' ? saved as object : null
  if (!relayTargetAllowed(target, settings)) {
    fail(res, 403, `${target.origin} isn't one of your saved service addresses. Add this address in Settings first.`)
    return
  }

  const auth = parseRelayAuth(req.get(RELAY_HEADERS.auth))
  if (!auth) { fail(res, 400, `Unsupported ${RELAY_HEADERS.auth}`); return }

  const headers = forwardedRequestHeaders(req.headers)
  const secretName = req.get(RELAY_HEADERS.secret)
  if (secretName) {
    if (!isSecretName(secretName)) { fail(res, 400, `Unknown ${RELAY_HEADERS.secret}`); return }
    const secret = revealSecretForOutgoingRequest(user.id, secretName)
    if (!secret) { fail(res, 400, `No ${secretName} saved for your account`); return }
    const [name, value] = authHeaderFor(auth, secret, req.get(RELAY_HEADERS.username) ?? undefined)
    headers[name] = value
  }

  const controller = new AbortController()
  const abort = () => { if (!res.writableFinished) controller.abort() }
  res.on('close', abort)
  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: outgoingBody(req),
      redirect: 'manual',
      signal: controller.signal,
    })
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.has('location')) {
      await upstream.body?.cancel().catch(() => {})
      fail(res, 502, `${target.host} answered with a redirect (${upstream.status}). Save the address it redirects to in Settings instead.`)
      return
    }
    res.status(upstream.status)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Accel-Buffering', 'no')
    for (const [name, value] of Object.entries(passedResponseHeaders(upstream.headers))) res.setHeader(name, value)
    if (!upstream.body || req.method === 'HEAD') { await upstream.body?.cancel().catch(() => {}); res.end(); return }
    res.flushHeaders()
    await pipeline(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]), res)
  } catch (error) {
    if (controller.signal.aborted) { if (!res.destroyed) res.destroy(); return }
    if (!res.headersSent && !res.destroyed) fail(res, 502, unreachableMessage(target.host, error))
    else if (!res.destroyed) res.destroy()
  } finally {
    res.off('close', abort)
  }
})

// Body-parser failures on this route (too large, aborted upload) answer in the relay's JSON shape.
// Scoped to RELAY_PATH: this router is mounted at the root, and an unscoped error handler here
// would also catch errors from unrelated routes that happen to pass through it.
relayRouter.use(RELAY_PATH, (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) { next(error); return }
  const status = (error as { status?: number })?.status
  if (status === 413) { fail(res, 413, `The request body is larger than the relay allows (${MAX_RELAY_BODY}).`); return }
  if (typeof status === 'number' && status >= 400 && status < 500) { fail(res, status, 'The request body could not be read.'); return }
  next(error)
})
