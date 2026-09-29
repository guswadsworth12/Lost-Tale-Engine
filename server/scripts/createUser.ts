/**
 * Create or reset an account from a shell, for headless setup and for recovery when nobody can
 * sign in:
 *
 *   npm run create-user -- --username someone [--email a@b.c] [--role owner|member] [--setup-code]
 *
 * With --setup-code the account gets a one-time setup code (printed once, valid 72 hours) and
 * chooses its own password on first sign-in; this is also how to make the very first owner on a
 * headless machine. Without it, prompts for the password (not echoed) or reads LT_NEW_PASSWORD.
 * An existing user is reset (new password or code, role/email when given) and signed out
 * everywhere. A new user defaults to member, or to owner when there are no accounts yet. Uses the
 * same data directory as the server (LOST_TALES_DATA_DIR / .env).
 */
import { parseArgs } from 'node:util'
import { validateEmail, validatePassword, validateUsername } from '../authPlan.ts'
import { countUsers, findUserByEmail, findUserByName, insertUser, issueSetupCode, setUserEmail, setUserPassword, toAccountUser } from '../auth.ts'
import { db, userStore } from '../db.ts'

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

let piped: Promise<string[]> | undefined
/** Piped (non-terminal) stdin, read once and handed out a line at a time. */
function pipedLines(): Promise<string[]> {
  piped ??= new Promise((resolve) => {
    let buf = ''
    process.stdin.on('data', (chunk: Buffer) => { buf += chunk.toString('utf8') })
    process.stdin.on('end', () => resolve(buf.split(/\r?\n/)))
  })
  return piped
}

/** Read one line from stdin; on a terminal, without echoing what is typed. */
function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin
  process.stdout.write(prompt)
  if (!stdin.isTTY) {
    return pipedLines().then((lines) => {
      process.stdout.write('\n')
      return lines.shift() ?? ''
    })
  }
  return new Promise((resolve) => {
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') {
          stdin.off('data', onData)
          stdin.setRawMode(false)
          stdin.pause()
          process.stdout.write('\n')
          resolve(value)
          return
        }
        if (ch === '\u0003') {
          stdin.setRawMode(false)
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1)
        else if (ch >= ' ') value += ch
      }
    }
    stdin.on('data', onData)
  })
}

const USAGE = 'Usage: npm run create-user -- --username NAME [--email ADDRESS] [--role owner|member] [--setup-code]'

const { values } = parseArgs({
  options: {
    username: { type: 'string', short: 'u' },
    email: { type: 'string', short: 'e' },
    role: { type: 'string', short: 'r' },
    'setup-code': { type: 'boolean' },
  },
})

const username = (values.username ?? '').trim()
const usernameProblem = validateUsername(username)
if (usernameProblem) fail(`${usernameProblem} ${USAGE}`)
const role = values.role
if (role !== undefined && role !== 'owner' && role !== 'member') fail(`--role is owner or member. ${USAGE}`)
const email = values.email?.trim() || undefined
if (email) {
  const emailProblem = validateEmail(email)
  if (emailProblem) fail(emailProblem)
}
const withCode = values['setup-code'] === true

let password: string | undefined
if (!withCode) {
  password = process.env.LT_NEW_PASSWORD
  if (password === undefined) {
    password = await readSecret('Password: ')
    const again = await readSecret('Same password again: ')
    if (again !== password) fail('The two passwords differ.')
  }
  const passwordProblem = validatePassword(password)
  if (passwordProblem) fail(passwordProblem)
}

const existing = findUserByName(username)
const emailOwner = email ? findUserByEmail(email) : undefined
if (emailOwner && emailOwner.id !== existing?.id) fail('That email address is already in use by another account.')

let id: string
if (existing) {
  id = String(existing.id)
  if (role) userStore.update(id, { role })
  if (email) setUserEmail(id, email)
} else {
  const firstAccount = countUsers() === 0
  id = String(insertUser({ username, email, role: role ?? (firstAccount ? 'owner' : 'member') }).id)
}

if (withCode) {
  const issued = await issueSetupCode(id)
  console.log(`${existing ? 'Reset' : 'Created'} ${issued.user.username} (${issued.user.role}) with a one-time setup code.`)
  console.log('')
  console.log(`  Setup code: ${issued.code}`)
  console.log(`  Expires:    ${new Date(issued.expiresAt).toLocaleString()}`)
  console.log('')
  const names = issued.user.email ? `${issued.user.username} or ${issued.user.email}` : issued.user.username
  console.log(`Sign in as ${names} with this code as the password, then choose a password. The code is shown only now.`)
} else {
  await setUserPassword(id, password!)
  const user = toAccountUser(userStore.get(id)!)
  console.log(existing ? `Reset the password of ${user.username} (${user.role}) and signed them out everywhere.` : `Created ${user.username} (${user.role}).`)
}
db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
db.close()
