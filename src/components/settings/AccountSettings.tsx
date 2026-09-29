import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { describeExpiry, newPasswordProblem, newPasswordReady, PASSWORD_MIN_LENGTH } from '@/components/auth/passwordRules'
import { authApi, isSetupCodeIssued, usersApi } from '@/lib/accounts/api'
import type { AccountRole, AccountUser, SetupCodeIssued } from '@/lib/accounts/contract'
import { flushSettingsSync } from '@/lib/accounts/settingsSync'
import { useAuthStore } from '@/lib/accounts/useAuthStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'

async function signOut(): Promise<void> {
  await flushSettingsSync()
  try {
    await authApi.logout()
  } catch {
    // Signed out on this side regardless; the session cookie expires on its own.
  }
  useAuthStore.getState().signedOut()
}

function ChangePassword({ username }: { username: string }) {
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

type PasswordMode = 'code' | 'password'

function AddUser({ onAdded, onCodeIssued }: { onAdded: () => void; onCodeIssued: (issued: SetupCodeIssued) => void }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [mode, setMode] = useState<PasswordMode>('code')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AccountRole>('member')
  const [busy, setBusy] = useState(false)
  const passwordOk = mode === 'code' || password.length >= PASSWORD_MIN_LENGTH

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !passwordOk) return
    setBusy(true)
    try {
      const result = await usersApi.create({
        username: username.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        role,
        ...(mode === 'password' ? { password } : {}),
      })
      if (isSetupCodeIssued(result)) onCodeIssued(result)
      else toastSuccess(`Added ${username.trim()}.`)
      setUsername('')
      setEmail('')
      setPassword('')
      setRole('member')
      onAdded()
    } catch (err) {
      toastError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} autoComplete="off">
      <TextField label="Username" autoComplete="off" autoCapitalize="none" spellCheck={false}
        value={username} onChange={(e) => setUsername(e.target.value)} required />
      <TextField label="Email (optional)" type="email" autoComplete="off" autoCapitalize="none" spellCheck={false}
        hint="They can sign in with it instead of the username."
        value={email} onChange={(e) => setEmail(e.target.value)} />
      <div className="mb-3">
        <span className="mb-1 block text-xs font-medium text-text-muted">Password</span>
        <SegmentedControl<PasswordMode>
          fill
          value={mode}
          onChange={setMode}
          options={[
            { value: 'code', label: 'They choose it (setup code)' },
            { value: 'password', label: 'Set a temporary password' },
          ]}
        />
      </div>
      {mode === 'password' && (
        <TextField label="Temporary password" type="password" autoComplete="new-password"
          hint={password.length > 0 && password.length < PASSWORD_MIN_LENGTH
            ? `At least ${PASSWORD_MIN_LENGTH} characters.`
            : 'Share it with them; they can change it in Settings → Account.'}
          value={password} onChange={(e) => setPassword(e.target.value)} required />
      )}
      <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value as AccountRole)}>
        <option value="member">Member</option>
        <option value="owner">Owner (can manage accounts)</option>
      </SelectField>
      <Button type="submit" variant="primary" disabled={busy || !username.trim() || !passwordOk}>
        {busy ? 'Adding…' : 'Add user'}
      </Button>
    </form>
  )
}

function UserRow({ user, isSelf, onChanged, onCodeIssued }: {
  user: AccountUser
  isSelf: boolean
  onChanged: () => void
  onCodeIssued: (issued: SetupCodeIssued) => void
}) {
  const [resetting, setResetting] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < PASSWORD_MIN_LENGTH) return
    setBusy(true)
    try {
      await usersApi.resetPassword(user.id, password)
      toastSuccess(`Password reset for ${user.username}.`)
      setPassword('')
      setResetting(false)
      onChanged()
    } catch (err) {
      toastError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const newSetupCode = async () => {
    const ok = await confirmDialog({
      title: `New setup code for ${user.username}?`,
      body: 'This signs them out everywhere and replaces their password. They sign in with the new code and choose a password again.',
      confirmLabel: 'Issue code',
      tone: 'danger',
    })
    if (!ok) return
    try {
      onCodeIssued(await usersApi.issueSetupCode(user.id))
      setResetting(false)
      onChanged()
    } catch (err) {
      toastError(errorMessage(err))
    }
  }

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Remove ${user.username}?`,
      body: 'They can no longer sign in, and their own settings are deleted. Shared worlds, characters and stories stay.',
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await usersApi.remove(user.id)
      toastSuccess(`Removed ${user.username}.`)
      onChanged()
    } catch (err) {
      toastError(errorMessage(err))
    }
  }

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm text-text">{user.username}</span>
            <span className="text-xs text-text-muted">
              {user.role === 'owner' ? 'Owner' : 'Member'}
              {isSelf && ' · you'}
            </span>
            {user.mustSetPassword && (
              <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium text-warning">
                Waiting for first sign-in
              </span>
            )}
          </div>
          {user.email && <div className="mt-0.5 truncate text-xs text-text-muted">{user.email}</div>}
        </div>
        {!isSelf && (
          <div className="flex flex-wrap gap-1">
            <Button variant="ghost" onClick={newSetupCode}>
              New setup code
            </Button>
            <Button variant="ghost" onClick={() => setResetting((v) => !v)}>
              Set password
            </Button>
            <Button variant="ghost" className="hover:!text-danger" onClick={remove}>
              Remove
            </Button>
          </div>
        )}
      </div>
      {resetting && (
        <form onSubmit={reset} className="mt-3 flex flex-wrap items-end gap-2" autoComplete="off">
          <TextField label="New temporary password" type="password" autoComplete="new-password" className="!mb-0 min-w-0 flex-1"
            hint={password.length > 0 && password.length < PASSWORD_MIN_LENGTH ? `At least ${PASSWORD_MIN_LENGTH} characters.` : undefined}
            value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Button type="submit" variant="primary" disabled={busy || password.length < PASSWORD_MIN_LENGTH}>
            {busy ? 'Saving…' : 'Set'}
          </Button>
        </form>
      )}
    </li>
  )
}

function ManageUsers({ selfId }: { selfId: string }) {
  const [users, setUsers] = useState<AccountUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Shown next to wherever it was issued from, so it's never scrolled out of sight.
  const [issued, setIssued] = useState<{ code: SetupCodeIssued; from: 'row' | 'add' } | null>(null)

  const load = useCallback(() => {
    usersApi
      .list()
      .then((list) => {
        setUsers(list)
        setError(null)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])
  useEffect(load, [load])

  return (
    <>
      <Section title="Users" description="Everyone shares worlds, characters and stories. Settings and keys are per user.">
        {issued?.from === 'row' && (
          <div className="mb-4">
            <SetupCodeNotice issued={issued.code} onDone={() => setIssued(null)} />
          </div>
        )}
        {error && <p className="text-xs text-danger">{error}</p>}
        {!error && users === null && <p className="text-xs text-text-muted">Loading…</p>}
        {users && (
          <ul className="divide-y divide-border">
            {users.map((u) => (
              <UserRow key={u.id} user={u} isSelf={u.id === selfId} onChanged={load}
                onCodeIssued={(code) => setIssued({ code, from: 'row' })} />
            ))}
          </ul>
        )}
      </Section>
      <Section title="Add user">
        {issued?.from === 'add' && (
          <div className="mb-4">
            <SetupCodeNotice issued={issued.code} onDone={() => setIssued(null)} />
          </div>
        )}
        <AddUser onAdded={load} onCodeIssued={(code) => setIssued({ code, from: 'add' })} />
      </Section>
    </>
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
      {user.role === 'owner' && <ManageUsers selfId={user.id} />}
    </SettingsPage>
  )
}
