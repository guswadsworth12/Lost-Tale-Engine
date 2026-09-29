import { describe, expect, it } from 'vitest'
import { describeExpiry, newPasswordProblem, newPasswordReady, PASSWORD_MIN_LENGTH } from './passwordRules'

describe('new password rules', () => {
  const ok = 'x'.repeat(PASSWORD_MIN_LENGTH)

  it('needs the minimum length and a matching confirmation', () => {
    expect(newPasswordReady(ok, ok)).toBe(true)
    expect(newPasswordReady(ok.slice(1), ok.slice(1))).toBe(false)
    expect(newPasswordReady(ok, `${ok}y`)).toBe(false)
  })

  it('explains the first problem, and nothing before anything is typed', () => {
    expect(newPasswordProblem('', '')).toBeNull()
    expect(newPasswordProblem('short', '')).toMatch(/at least 10/i)
    expect(newPasswordProblem(ok, 'nope')).toMatch(/match/i)
    expect(newPasswordProblem(ok, ok)).toBeNull()
  })
})

describe('describeExpiry', () => {
  const now = 1_000_000_000_000
  it('reads in hours, then days', () => {
    expect(describeExpiry(now - 1, now)).toBe('already expired')
    expect(describeExpiry(now + 10 * 60_000, now)).toBe('in under an hour')
    expect(describeExpiry(now + 3_600_000, now)).toBe('in 1 hour')
    expect(describeExpiry(now + 24 * 3_600_000, now)).toBe('in 24 hours')
    expect(describeExpiry(now + 7 * 24 * 3_600_000, now)).toBe('in 7 days')
  })
})
