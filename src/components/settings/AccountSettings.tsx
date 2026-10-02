import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { describeExpiry, newPasswordProblem, newPasswordReady } from '@/components/auth/passwordRules'
import { authApi } from '@/lib/accounts/api'
import type { SetupCodeIssued } from '@/lib/accounts/contract'
import { flushSettingsSync } from '@/lib/accounts/settingsSync'
import { useAuthStore } from '@/lib/accounts/useAuthStore'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'

/** Saves any unsynced settings, ends the session, and returns to the sign-in screen. */
export async function signOut(): Promise<void> {
  await flushSettingsSync()
  try {
    await authApi.logout()
  } catch {
    // Signed out on this side regardless; the session cookie expires on its own.
  }
  useAuthStore.getState().signedOut()
}

export function ChangePassword({ username, onDone }: { username: string; onDone?: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const problem = newPasswordProblem(next, confirm)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current || !newPasswordReady(next, confirm)) return
    setBusy(true)
    try {
      await authApi.changePassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      toastSuccess('Password changed.')
      onDone?.()
    } catch (err) {
      toastError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      {/* For password managers: which account this new password belongs to. */}
      <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
      <TextField label="Current password" type="password" autoComplete="current-password"
        value={current} onChange={(e) => setCurrent(e.target.value)} required />
      <TextField label="New password" type="password" autoComplete="new-password"
        value={next} onChange={(e) => setNext(e.target.value)} required />
      <TextField label="Confirm new password" type="password" autoComplete="new-password"
        value={confirm} onChange={(e) => setConfirm(e.target.value)} required
        hint={problem ?? undefined} />
      <Button type="submit" variant="primary" disabled={busy || !current || !newPasswordReady(next, confirm)}>
        {busy ? 'Saving…' : 'Change password'}
      </Button>
    </form>
  )
}

/** A one-time setup code, shown once right after it's issued. */
export function SetupCodeNotice({ issued, onDone }: { issued: SetupCodeIssued; onDone: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.code)
      setCopied(true)
    } catch {
      toastError("Couldn't copy. Select the code and copy it by hand.")
    }
  }
  return (
    <div role="status" className="rounded-xl border border-accent/40 bg-bg-sunken p-4">
      <p className="text-sm text-text">
        Setup code for <span className="font-semibold">{issued.user.username}</span>
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code className="select-all rounded-lg bg-bg px-3 py-2 font-mono text-base tracking-wider text-text">{issued.code}</code>
        <Button type="button" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
      </div>
      <p className="mt-2 text-xs text-text-muted">
        They sign in with their username{issued.user.email ? ' or email' : ''} and this code, then choose a password.
        Expires {describeExpiry(issued.expiresAt)} ({new Date(issued.expiresAt).toLocaleString()}).
      </p>
      <p className="mt-1 text-xs font-medium text-warning">This code won't be shown again. Copy it now.</p>
      <Button type="button" variant="ghost" className="mt-3" onClick={onDone}>Done</Button>
    </div>
  )
}

export function AccountSettings() {
  const user = useAuthStore((s) => s.user)
  const [signingOut, setSigningOut] = useState(false)
  if (!user) return null

  return (
    <SettingsPage>
      <Section title="Account">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text">
            Signed in as <span className="font-semibold">{user.username}</span>
            <span className="ml-2 text-xs text-text-muted">{user.role === 'owner' ? 'Owner' : 'Member'}</span>
          </p>
          <Button
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true)
              void signOut()
            }}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </Button>
        </div>
      </Section>
      <Section title="Change password">
        <ChangePassword username={user.username} />
      </Section>
    </SettingsPage>
  )
}
