import express, { type Request, type RequestHandler, type Response } from 'express'
import { db, newId, removedUserStore, sessionStore, userSecretStore, userSettingsStore, userStore } from './db.ts'
import {
  LoginRateLimiter,
  SESSION_COOKIE,
  clientAddress,
  emailKey,
  generateSetupCode,
  generateToken,
  hashPassword,
  hashSetupCode,
  hashToken,
  isHttpsRequest,
  isLocalSetupRequest,
  looksLikeEmail,
  parseCookies,
  pathAllowedWhileSettingPassword,
  pathRequiresAuth,
  sessionCookie,
  sessionExpiry,
  sessionIsLive,
  sessionNeedsRenewal,
  setupCodeExpiry,
  setupCodeIsLive,
  usernameKey,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
  verifySetupCode,
} from './authPlan.ts'
import type { AccountRole, AccountUser, AuthStatus, SetupCodeIssued } from '../src/lib/accounts/contract.ts'

/**
 * Accounts: sign-in, sessions, and owner-run user management. The whole API (and character art)
 * sits behind `authGate`; worlds, characters and stories stay shared by everyone signed in. First
 * setup is allowed only from the machine itself (see `isLocalSetupRequest`); after that, the
 * owner adds people, or `npm run create-user` does it from a shell.
 *
 * The owner can add someone without choosing their password: the account then gets a one-time
 * setup code (shown once, stored only as a hash, valid 72 hours). Signing in with that code gives
 * a session that can do nothing but choose a password (POST /api/auth/set-password).
 */

type Row = Record<string, unknown>

const WRONG_LOGIN = 'Wrong username or password'
const CODE_EXPIRED = 'This setup code has expired. Ask the owner for a new one.'
const CHOOSE_PASSWORD_FIRST = 'Choose your password first'

const signedIn = new WeakMap<Request, { user: AccountUser; sessionId: string }>()

/** The signed-in user for this request, or undefined. Always set inside routes behind the gate. */
export function currentUser(req: Request): AccountUser | undefined {
  return signedIn.get(req)?.user
}

function currentSessionId(req: Request): string | undefined {
  return signedIn.get(req)?.sessionId
}

export function toAccountUser(row: Row): AccountUser {
  const user: AccountUser = {
    id: String(row.id),
    username: String(row.username),
    role: row.role === 'owner' ? 'owner' : 'member',
    createdAt: Number(row.createdAt),
  }
  if (typeof row.email === 'string' && row.email) user.email = row.email
  if (row.mustSetPassword === true) user.mustSetPassword = true
  return user
}

export function countUsers(): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  return Number(row.n)
}

export function findUserByName(name: string): Row | undefined {
  return userStore.list({ where: 'usernameKey = ?', params: [usernameKey(name)] })[0]
}

export function findUserByEmail(email: string): Row | undefined {
  return userStore.list({ where: 'emailKey = ?', params: [emailKey(email)] })[0]
}

/** The user a sign-in name refers to: an email address if it has an `@`, otherwise a username. */
export function findUserByLogin(identifier: string): Row | undefined {
  return looksLikeEmail(identifier) ? findUserByEmail(identifier) : findUserByName(identifier)
}

/**
 * Create a user. Without a password hash the account starts with no usable password; give it a
 * setup code with `issueSetupCode`. Throws if the name or email is taken (unique indexes).
 */
export function insertUser(input: { username: string; email?: string; role: AccountRole; passwordHash?: string }): Row {
  const email = input.email?.trim() || undefined
  return userStore.insert({
    id: newId(),
    usernameKey: usernameKey(input.username),
    emailKey: email ? emailKey(email) : null,
    createdAt: Date.now(),
    username: input.username,
    email,
    role: input.role,
    passwordHash: input.passwordHash,
  })
}

/** Set or change a user's email (undefined clears it). */
export function setUserEmail(id: string, email: string | undefined): void {
  const clean = email?.trim() || undefined
  userStore.update(id, { email: clean, emailKey: clean ? emailKey(clean) : null })
}

/** Set a real password: clears any setup code and signs out every session but `keepSessionId`. */
export async function setUserPassword(id: string, password: string, keepSessionId?: string): Promise<void> {
  userStore.update(id, {
    passwordHash: await hashPassword(password),
    mustSetPassword: undefined,
    setupCodeHash: undefined,
    setupCodeExpiresAt: undefined,
  })
  revokeSessions(id, keepSessionId)
}

/**
 * Give a user a fresh one-time setup code: their password stops working, they are signed out
 * everywhere, and they must sign in with the code and choose a new password. The code is
 * returned here once and never stored in the clear.
 */
export async function issueSetupCode(id: string): Promise<SetupCodeIssued> {
  const code = generateSetupCode()
  const expiresAt = setupCodeExpiry(Date.now())
  const setupCodeHash = await hashSetupCode(code)
  userStore.update(id, { passwordHash: undefined, mustSetPassword: true, setupCodeHash, setupCodeExpiresAt: expiresAt })
  revokeSessions(id)
  return { user: toAccountUser(userStore.get(id)!), code, expiresAt }
}

/** Sign every session of a user out, except `keepSessionId` when given. */
export function revokeSessions(userId: string, keepSessionId?: string): void {
  for (const s of sessionStore.list({ where: 'userId = ?', params: [userId] })) {
    if (s.id !== keepSessionId) sessionStore.remove(String(s.id))
  }
}

function pruneExpiredSessions(now: number): void {
  db.prepare('DELETE FROM sessions WHERE expiresAt <= ?').run(now)
}

function requestInfo(req: Request) {
  return { remoteAddress: req.socket.remoteAddress, headers: req.headers }
}

function startSession(req: Request, res: Response, userId: string): string {
  const now = Date.now()
  pruneExpiredSessions(now)
  const token = generateToken()
  const id = hashToken(token)
  const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 300) : undefined
  sessionStore.insert({ id, userId, createdAt: now, expiresAt: sessionExpiry(now), lastSeenAt: now, userAgent })
  res.setHeader('Set-Cookie', sessionCookie(token, { secure: isHttpsRequest(req) }))
  return id
}

function clearCookie(req: Request, res: Response): void {
  res.setHeader('Set-Cookie', sessionCookie('', { secure: isHttpsRequest(req) }))
}

/** Resolve the session cookie to a user, sliding its expiry forward when due. */
function loadSession(req: Request, res: Response): void {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE]
  if (!token) return
  const id = hashToken(token)
  const session = sessionStore.get(id)
  if (!session) return
  const now = Date.now()
  if (!sessionIsLive(session as { expiresAt: number }, now)) {
    sessionStore.remove(id)
    return
  }
  const user = userStore.get(String(session.userId))
  if (!user) {
    sessionStore.remove(id)
    return
  }
  if (sessionNeedsRenewal(session as { lastSeenAt?: number }, now)) {
    sessionStore.update(id, { lastSeenAt: now, expiresAt: sessionExpiry(now) })
    res.setHeader('Set-Cookie', sessionCookie(token, { secure: isHttpsRequest(req) }))
  }
  signedIn.set(req, { user: toAccountUser(user), sessionId: id })
}

/**
 * Mounted before every API router and the /avatars files: loads the session, then refuses
 * anything under /api (bar status, setup and login) or /avatars without one. A session signed in
 * with a setup code may only reach status, logout and set-password until a password is chosen.
 */
export const authGate: RequestHandler = (req, res, next) => {
  loadSession(req, res)
  const user = currentUser(req)
  if (!user && pathRequiresAuth(req.path)) {
    res.status(401).json({ error: 'Sign in required' })
    return
  }
  if (user?.mustSetPassword && !pathAllowedWhileSettingPassword(req.path)) {
    res.status(403).json({ error: CHOOSE_PASSWORD_FIRST })
    return
  }
  next()
}

export const requireUser: RequestHandler = (req, res, next) => {
  const user = currentUser(req)
  if (!user) {
    res.status(401).json({ error: 'Sign in required' })
    return
  }
  if (user.mustSetPassword) {
    res.status(403).json({ error: CHOOSE_PASSWORD_FIRST })
    return
  }
  next()
}

export const requireOwner: RequestHandler = (req, res, next) => {
  const user = currentUser(req)
  if (!user) {
    res.status(401).json({ error: 'Sign in required' })
    return
  }
  if (user.role !== 'owner' || user.mustSetPassword) {
    res.status(403).json({ error: 'Only the owner can do that' })
    return
  }
  next()
}

function statusFor(req: Request): AuthStatus {
  const needsSetup = countUsers() === 0
  const user = currentUser(req) ?? null
  const status: AuthStatus = {
    user,
    needsSetup,
    setupAllowedHere: needsSetup && isLocalSetupRequest(requestInfo(req)),
  }
  if (user?.mustSetPassword) status.mustSetPassword = true
  return status
}

const loginLimiter = new LoginRateLimiter()

function tooMany(res: Response, retryMs: number): void {
  const seconds = Math.ceil(retryMs / 1000)
  res.setHeader('Retry-After', String(seconds))
  res.status(429).json({ error: `Too many attempts. Try again in ${seconds} seconds.` })
}

// A hash to verify against when the username doesn't exist, so a wrong name costs the same time
// as a wrong password and the response doesn't reveal which names exist.
let dummyHash: Promise<string> | undefined
function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword('not-a-real-password-just-timing')
  return dummyHash
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** An optional email from a request body: '' / missing means none; otherwise it must look valid. */
function optionalEmail(v: unknown): { email?: string; error?: string } {
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) return {}
  const email = str(v).trim()
  const error = validateEmail(email)
  return error ? { error } : { email }
}

export const authRouter = express.Router()
// Sign-in bodies are tiny; this parser runs before the app's large global one.
authRouter.use(['/api/auth', '/api/users'], express.json({ limit: '16kb' }))

authRouter.get('/api/auth/status', (req, res) => {
  res.json(statusFor(req))
})

authRouter.post('/api/auth/setup', async (req, res) => {
  if (!isLocalSetupRequest(requestInfo(req))) {
    return res.status(403).json({ error: 'The first account can only be created on the machine running Lost Tales.' })
  }
  if (countUsers() > 0) return res.status(409).json({ error: 'Setup is already done.' })
  const username = str(req.body?.username).trim()
  const password = str(req.body?.password)
  const { email, error: emailError } = optionalEmail(req.body?.email)
  const problem = validateUsername(username) ?? emailError ?? validatePassword(password)
  if (problem) return res.status(400).json({ error: problem })
  const passwordHash = await hashPassword(password)
  // Checked again after the (async) hash: two setup requests racing must not both create an owner.
  if (countUsers() > 0) return res.status(409).json({ error: 'Setup is already done.' })
  const user = insertUser({ username, email, passwordHash, role: 'owner' })
  const sessionId = startSession(req, res, String(user.id))
  signedIn.set(req, { user: toAccountUser(user), sessionId })
  res.status(201).json(statusFor(req))
})

/**
 * Sign in with a username or email. For an account waiting on its first password, `password`
 * is the setup code, and the session it opens can only choose a password.
 */
authRouter.post('/api/auth/login', async (req, res) => {
  const identifier = str(req.body?.username).trim()
  const password = str(req.body?.password)
  if (!identifier || !password) return res.status(400).json({ error: 'Enter a username and password.' })
  const user = identifier.length <= 254 ? findUserByLogin(identifier) : undefined
  // Keyed by the account when there is one, so switching between its name and email doesn't reset the count.
  const key = LoginRateLimiter.key(user ? `id:${String(user.id)}` : identifier, clientAddress(requestInfo(req)))
  const wait = loginLimiter.retryAfter(key, Date.now())
  if (wait > 0) return tooMany(res, wait)

  let ok = false
  if (!user) {
    await verifyPassword(password, await dummyPasswordHash())
  } else if (user.mustSetPassword === true) {
    ok = typeof user.setupCodeHash === 'string' && (await verifySetupCode(password, user.setupCodeHash))
    // Only someone holding the right code learns that it has expired.
    if (ok && !setupCodeIsLive(user.setupCodeExpiresAt, Date.now())) {
      return res.status(401).json({ error: CODE_EXPIRED })
    }
  } else {
    ok = typeof user.passwordHash === 'string' && (await verifyPassword(password, user.passwordHash))
  }
  if (!ok || !user) {
    loginLimiter.fail(key, Date.now())
    return res.status(401).json({ error: WRONG_LOGIN })
  }
  loginLimiter.succeed(key)
  const sessionId = startSession(req, res, String(user.id))
  signedIn.set(req, { user: toAccountUser(user), sessionId })
  res.json(statusFor(req))
})

authRouter.post('/api/auth/logout', (req, res) => {
  const sessionId = currentSessionId(req)
  if (sessionId) sessionStore.remove(sessionId)
  clearCookie(req, res)
  res.status(204).end()
})

/** First password, after signing in with a setup code. Keeps this session; signs out any other. */
authRouter.post('/api/auth/set-password', async (req, res) => {
  const me = currentUser(req)
  if (!me) return res.status(401).json({ error: 'Sign in required' })
  if (!me.mustSetPassword) return res.status(409).json({ error: 'Your password is already set. Change it with your current password.' })
  const password = str(req.body?.password)
  const problem = validatePassword(password)
  if (problem) return res.status(400).json({ error: problem })
  await setUserPassword(me.id, password, currentSessionId(req))
  signedIn.set(req, { user: toAccountUser(userStore.get(me.id)!), sessionId: currentSessionId(req)! })
  res.json(statusFor(req))
})

/** Change your own password. Signs out every other browser of yours; this one stays signed in. */
authRouter.post('/api/auth/password', requireUser, async (req, res) => {
  const me = currentUser(req)!
  const current = str(req.body?.current)
  const next = str(req.body?.next)
  const problem = validatePassword(next)
  if (problem) return res.status(400).json({ error: problem })
  const key = LoginRateLimiter.key(`id:${me.id}`, clientAddress(requestInfo(req)))
  const wait = loginLimiter.retryAfter(key, Date.now())
  if (wait > 0) return tooMany(res, wait)
  const row = userStore.get(me.id)
  if (!row || typeof row.passwordHash !== 'string' || !(await verifyPassword(current, row.passwordHash))) {
    loginLimiter.fail(key, Date.now())
    return res.status(400).json({ error: 'Your current password is wrong.' })
  }
  loginLimiter.succeed(key)
  await setUserPassword(me.id, next, currentSessionId(req))
  res.status(204).end()
})

// ---- Owner-only user management ----

authRouter.get('/api/users', requireOwner, (_req, res) => {
  res.json(userStore.list({ orderBy: 'createdAt' }).map(toAccountUser))
})

/**
 * Add a user. With `password`, responds 201 AccountUser. Without one, the account gets a setup
 * code instead and the response is 201 SetupCodeIssued: the only time the code is shown.
 */
authRouter.post('/api/users', requireOwner, async (req, res) => {
  const username = str(req.body?.username).trim()
  const rawPassword = req.body?.password
  const withCode = rawPassword === undefined || rawPassword === null || rawPassword === ''
  const password = str(rawPassword)
  const role = req.body?.role === undefined ? 'member' : req.body.role
  if (role !== 'owner' && role !== 'member') return res.status(400).json({ error: 'The role is owner or member.' })
  const { email, error: emailError } = optionalEmail(req.body?.email)
  const problem = validateUsername(username) ?? emailError ?? (withCode ? null : validatePassword(password))
  if (problem) return res.status(400).json({ error: problem })
  const taken = () =>
    findUserByName(username) ? 'That username is taken.' : email && findUserByEmail(email) ? 'That email address is already in use.' : null
  if (taken()) return res.status(409).json({ error: taken() })
  const passwordHash = withCode ? undefined : await hashPassword(password)
  if (taken()) return res.status(409).json({ error: taken() })
  const user = insertUser({ username, email, role, passwordHash })
  if (withCode) return res.status(201).json(await issueSetupCode(String(user.id)))
  res.status(201).json(toAccountUser(user))
})

/** A fresh setup code for someone: their password stops working and they are signed out. Not yourself. */
authRouter.post('/api/users/:id/setup-code', requireOwner, async (req, res) => {
  const id = String(req.params.id)
  if (id === currentUser(req)!.id) return res.status(400).json({ error: 'Change your own password from your account instead.' })
  if (!userStore.get(id)) return res.status(404).json({ error: 'Not found' })
  res.json(await issueSetupCode(id))
})

/** Delete a user with their sessions, stored credentials and preferences. Not yourself. */
authRouter.delete('/api/users/:id', requireOwner, (req, res) => {
  const id = String(req.params.id)
  if (id === currentUser(req)!.id) return res.status(400).json({ error: 'You cannot delete your own account.' })
  if (!userStore.get(id)) return res.status(404).json({ error: 'Not found' })
  const removed = userStore.get(id)!
  db.exec('BEGIN')
  try {
    // Kept so what they leave behind can still be named in Admin (admin.ts).
    removedUserStore.remove(id)
    removedUserStore.insert({ id, username: removed.username, ...(removed.email ? { email: removed.email } : {}), createdAt: Date.now() })
    revokeSessions(id)
    for (const s of userSecretStore.list({ where: 'userId = ?', params: [id] })) userSecretStore.remove(String(s.id))
    userSettingsStore.remove(id)
    userStore.remove(id)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  res.status(204).end()
})

/** The owner sets a new password for someone; that user is signed out everywhere. */
authRouter.post('/api/users/:id/password', requireOwner, async (req, res) => {
  const id = String(req.params.id)
  const password = str(req.body?.password)
  const problem = validatePassword(password)
  if (problem) return res.status(400).json({ error: problem })
  if (!userStore.get(id)) return res.status(404).json({ error: 'Not found' })
  await setUserPassword(id, password, id === currentUser(req)!.id ? currentSessionId(req) : undefined)
  res.status(204).end()
})
