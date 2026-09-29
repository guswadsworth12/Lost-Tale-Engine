import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM for the credential vault. Each value gets a fresh 12-byte IV, and the owner and
 * setting name are bound in as additional authenticated data (`${userId}:${name}`), so a stored
 * ciphertext copied onto another user's row, or onto another setting, fails to decrypt.
 * Pure: the caller supplies the 32-byte master key.
 */

export interface SealedValue {
  /** base64, 12 bytes */
  iv: string
  /** base64, 16-byte GCM auth tag */
  tag: string
  /** base64 */
  ciphertext: string
}

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const TAG_BYTES = 16
export const MASTER_KEY_BYTES = 32

function aadFor(userId: string, name: string): Buffer {
  return Buffer.from(`${userId}:${name}`, 'utf8')
}

function assertKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== MASTER_KEY_BYTES) throw new Error('Vault master key must be 32 bytes')
}

export function sealSecret(key: Buffer, userId: string, name: string, value: string): SealedValue {
  assertKey(key)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(aadFor(userId, name))
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }
}

/** Throws when the key, owner, name, IV, tag, or ciphertext don't match what was sealed. */
export function openSecret(key: Buffer, userId: string, name: string, sealed: SealedValue): string {
  assertKey(key)
  const iv = Buffer.from(sealed.iv, 'base64')
  const tag = Buffer.from(sealed.tag, 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('Malformed sealed value')
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
  decipher.setAAD(aadFor(userId, name))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8')
}

/**
 * Parses a configured master key: 64 hex characters, or base64/base64url that decodes to exactly
 * 32 bytes. Throws without echoing the input.
 */
export function parseMasterKey(text: string): Buffer {
  const trimmed = text.trim()
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex')
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (decoded.length === MASTER_KEY_BYTES) return decoded
  }
  throw new Error('Vault master key must be 32 bytes, written as 64 hex characters or base64')
}
