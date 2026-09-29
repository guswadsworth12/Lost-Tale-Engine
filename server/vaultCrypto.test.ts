import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { openSecret, parseMasterKey, sealSecret } from './vaultCrypto'

const key = randomBytes(32)

function flip(base64: string): string {
  const bytes = Buffer.from(base64, 'base64')
  bytes[0] ^= 0x01
  return bytes.toString('base64')
}

describe('vault crypto', () => {
  it('round-trips a value and uses a fresh IV each time', () => {
    const a = sealSecret(key, 'user-1', 'chatBackendApiKey', 'sk-test-ünïcode')
    const b = sealSecret(key, 'user-1', 'chatBackendApiKey', 'sk-test-ünïcode')
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(Buffer.from(a.iv, 'base64')).toHaveLength(12)
    expect(a.ciphertext).not.toContain('sk-test')
    expect(openSecret(key, 'user-1', 'chatBackendApiKey', a)).toBe('sk-test-ünïcode')
  })

  it('detects tampering with the tag, ciphertext, or IV', () => {
    const sealed = sealSecret(key, 'user-1', 'ttsApiKey', 'value')
    expect(() => openSecret(key, 'user-1', 'ttsApiKey', { ...sealed, tag: flip(sealed.tag) })).toThrow()
    expect(() => openSecret(key, 'user-1', 'ttsApiKey', { ...sealed, ciphertext: flip(sealed.ciphertext) })).toThrow()
    expect(() => openSecret(key, 'user-1', 'ttsApiKey', { ...sealed, iv: flip(sealed.iv) })).toThrow()
  })

  it('binds the value to its owner and name', () => {
    const sealed = sealSecret(key, 'user-1', 'ttsApiKey', 'value')
    expect(() => openSecret(key, 'user-2', 'ttsApiKey', sealed)).toThrow()
    expect(() => openSecret(key, 'user-1', 'openMayhemApiKey', sealed)).toThrow()
  })

  it('fails with the wrong key and rejects keys of the wrong size', () => {
    const sealed = sealSecret(key, 'user-1', 'ttsApiKey', 'value')
    expect(() => openSecret(randomBytes(32), 'user-1', 'ttsApiKey', sealed)).toThrow()
    expect(() => sealSecret(randomBytes(16), 'user-1', 'ttsApiKey', 'value')).toThrow()
  })

  it('parses hex and base64 master keys of exactly 32 bytes', () => {
    expect(parseMasterKey(key.toString('hex')).equals(key)).toBe(true)
    expect(parseMasterKey(key.toString('base64')).equals(key)).toBe(true)
    expect(parseMasterKey(`${key.toString('base64url')}\n`).equals(key)).toBe(true)
    expect(() => parseMasterKey(randomBytes(16).toString('base64'))).toThrow()
    expect(() => parseMasterKey('not a key!')).toThrow()
  })
})
