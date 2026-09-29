import { describe, expect, it } from 'vitest'
import { isSetupCodeIssued } from './api'

describe('isSetupCodeIssued', () => {
  const user = { id: 'u1', username: 'someone', role: 'member' as const, createdAt: 0 }
  it('tells a setup-code answer from a plain user', () => {
    expect(isSetupCodeIssued({ user, code: 'ABCD-EFGH-JKLM', expiresAt: 1 })).toBe(true)
    expect(isSetupCodeIssued(user)).toBe(false)
    expect(isSetupCodeIssued(null)).toBe(false)
  })
})
