import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { dataDir, userSecretStore } from './db.ts'
import { MASTER_KEY_BYTES, openSecret, parseMasterKey, sealSecret, type SealedValue } from './vaultCrypto.ts'
import { SECRET_SETTING_KEYS, isServiceSecretName, isSecretName, type SecretName, type SecretStatus } from '../src/lib/accounts/contract.ts'

/**
 * Per-user credential vault. Values are sealed with AES-256-GCM (see vaultCrypto.ts) under a
 * master key that never enters the database: `LOST_TALES_SECRET_KEY` when set, otherwise
 * `<dataDir>/secret.key`, created on first use. Nothing here returns a stored value to a route
 * except `revealSecretForOutgoingRequest`, which exists only so the server can attach a credential
 * to a call it is making itself.
 */

export const MAX_SECRET_LENGTH = 8000
export const SECRET_KEY_FILE = 'secret.key'

export class SecretInputError extends Error {}

/** Reads (or on first use creates) the master key. The key's value is never logged. */
export function loadMasterKey(options: { env?: NodeJS.ProcessEnv; dir?: string } = {}): Buffer {
  const env = options.env ?? process.env
  const configured = env.LOST_TALES_SECRET_KEY
  if (configured && configured.trim()) {
    try { return parseMasterKey(configured) } catch {
      throw new Error('LOST_TALES_SECRET_KEY must decode to 32 bytes (64 hex characters or base64).')
    }
  }
  const file = path.join(options.dir ?? dataDir, SECRET_KEY_FILE)
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    try {
      // `wx`: if two processes race here, exactly one writes and the other reads that one's key.
      fs.writeFileSync(file, `${randomBytes(MASTER_KEY_BYTES).toString('base64')}\n`, { flag: 'wx', mode: 0o600 })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  try { fs.chmodSync(file, 0o600) } catch { /* not supported on every filesystem */ }
  try { return parseMasterKey(fs.readFileSync(file, 'utf8')) } catch {
    throw new Error(`${file} does not hold a valid 32-byte vault key.`)
  }
}

let cachedKey: Buffer | undefined
function masterKey(): Buffer {
  cachedKey ??= loadMasterKey()
  return cachedKey
}

interface SecretRow extends SealedValue {
  userId: string
  name: SecretName
  updatedAt: number
}

const rowId = (userId: string, name: SecretName) => `${userId}:${name}`

function validName(name: string): SecretName {
  if (!isSecretName(name)) throw new SecretInputError('Unknown secret name')
  return name
}

/** Saves (encrypted) or, for an empty string, removes the user's credential. */
export function setSecret(userId: string, name: string, value: string): void {
  const secretName = validName(name)
  if (typeof value !== 'string') throw new SecretInputError('The value must be text')
  if (value === '') { deleteSecret(userId, secretName); return }
  if (value.length > MAX_SECRET_LENGTH) throw new SecretInputError(`The value must be at most ${MAX_SECRET_LENGTH} characters`)
  const sealed = sealSecret(masterKey(), userId, secretName, value)
  const now = Date.now()
  const id = rowId(userId, secretName)
  const fields = { userId, name: secretName, ...sealed, updatedAt: now }
  if (userSecretStore.get(id)) userSecretStore.update(id, fields)
  else userSecretStore.insert({ id, createdAt: now, ...fields })
}

export function deleteSecret(userId: string, name: string): void {
  userSecretStore.remove(rowId(userId, validName(name)))
}

/** Whether each known credential is saved, and every service key that is. Never the value, or any part of it. */
export function secretStatuses(userId: string): SecretStatus[] {
  const fixed = SECRET_SETTING_KEYS.map((name): SecretStatus => {
    const row = userSecretStore.get(rowId(userId, name)) as unknown as SecretRow | undefined
    return row && row.userId === userId ? { name, set: true, updatedAt: row.updatedAt } : { name, set: false }
  })
  const services = (userSecretStore.list({ where: 'userId = ?', params: [userId] }) as unknown as SecretRow[])
    .filter((row) => isServiceSecretName(row.name))
    .map((row): SecretStatus => ({ name: row.name, set: true, updatedAt: row.updatedAt }))
  return [...fixed, ...services]
}

/**
 * Moves a saved key to another name, re-encrypted there: when a credential's owner changes, like a
 * chat key becoming a service's own. Never overwrites a key already saved under `to`. The value
 * never leaves the server.
 */
export function moveSecret(userId: string, from: string, to: string): void {
  const source = validName(from)
  const target = validName(to)
  if (source === target) return
  if (userSecretStore.get(rowId(userId, target))) throw new SecretInputError('A key is already saved under that name')
  const value = revealSecretForOutgoingRequest(userId, source)
  if (value === undefined) throw new SecretInputError('There is no saved key to move')
  setSecret(userId, target, value)
  deleteSecret(userId, source)
}

/**
 * The only decrypt path. Call it only to attach the credential to an outgoing request the server
 * itself is making; never put the result in a response, a log, or an error message.
 */
export function revealSecretForOutgoingRequest(userId: string, name: SecretName): string | undefined {
  if (!isSecretName(name)) return undefined
  const row = userSecretStore.get(rowId(userId, name)) as unknown as SecretRow | undefined
  if (!row || row.userId !== userId) return undefined
  try {
    return openSecret(masterKey(), userId, name, row)
  } catch {
    console.warn(`[vault] A saved ${name} could not be decrypted (was the vault key changed?). Ask the user to save it again.`)
    return undefined
  }
}
