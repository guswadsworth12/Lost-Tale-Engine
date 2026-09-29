import { PASSWORD_MIN_LENGTH } from '@/lib/accounts/contract'

export { PASSWORD_MIN_LENGTH }

/** Why a new password can't be submitted yet, or null. `confirm` is only judged once something is typed. */
export function newPasswordProblem(password: string, confirm: string): string | null {
  if (password.length > 0 && password.length < PASSWORD_MIN_LENGTH) return `At least ${PASSWORD_MIN_LENGTH} characters.`
  if (confirm.length > 0 && confirm !== password) return "Passwords don't match."
  return null
}

/** Whether a new password + confirmation is ready to submit. */
export function newPasswordReady(password: string, confirm: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password === confirm
}

/** "in 3 days" style phrase for a setup code's expiry, falling back to the date. */
export function describeExpiry(expiresAt: number, now: number = Date.now()): string {
  const ms = expiresAt - now
  if (ms <= 0) return 'already expired'
  const hours = Math.round(ms / 3_600_000)
  if (hours < 1) return 'in under an hour'
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`
  return `in ${Math.round(hours / 24)} days`
}
