import { useState, type FormEvent, type ReactNode } from 'react'
import { BrandWordmark } from '@/components/ui/BrandMark'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { authApi } from '@/lib/accounts/api'
import { useAuthStore } from '@/lib/accounts/useAuthStore'
import { errorMessage } from '@/lib/store/useToastStore'
import { newPasswordProblem, newPasswordReady } from './passwordRules'

/** The centered card every signed-out screen sits in. */
export function AuthCard({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-y-auto bg-bg p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-bg-elevated p-6 themed-shadow">
        <div className="mb-5 flex justify-center">
          <BrandWordmark size={30} />
        </div>
        <h1 className="text-sm font-semibold text-text">{title}</h1>
        {description && <div className="mt-1 text-xs leading-relaxed text-text-muted">{description}</div>}
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  )
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mb-3 text-xs text-danger">
      {message}
    </p>
  )
}

/** After setup or sign-in the server has set the session cookie; ask it who we are now. */
async function refreshStatus(): Promise<void> {
  useAuthStore.getState().setFromStatus(await authApi.status())
}

export function LoginScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true)
    setError(null)
    try {
      await authApi.login(username.trim(), password)
      await refreshStatus()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <AuthCard title="Sign in">
      <form onSubmit={submit}>
        <TextField label="Username or email" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
          value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        <TextField label="Password or setup code" name="password" type="password" autoComplete="current-password"
          hint="First time? Use the setup code you were given."
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        <FormError message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !username.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  )
}

export function SetupScreen() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = newPasswordProblem(password, confirm)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !newPasswordReady(password, confirm)) return
    setBusy(true)
    setError(null)
    try {
      await authApi.setup(username.trim(), password)
      await refreshStatus()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <AuthCard
      title="Create the owner account"
      description="This is the first account. The owner can add other people later, each with their own sign-in and settings. Everyone's worlds, characters and stories are their own, unless they choose to share a world or character."
    >
      <form onSubmit={submit}>
        <TextField label="Username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
          value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        <TextField label="Password" name="new-password" type="password" autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        <TextField label="Confirm password" name="confirm-password" type="password" autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} required
          hint={problem ?? undefined} />
        <FormError message={error} />
        <Button type="submit" variant="primary" className="w-full"
          disabled={busy || !username.trim() || !newPasswordReady(password, confirm)}>
          {busy ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  )
}

/** Signed in with a one-time setup code: choose a real password before anything else. */
export function ChoosePasswordScreen({ username }: { username: string }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = newPasswordProblem(password, confirm)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!newPasswordReady(password, confirm)) return
    setBusy(true)
    setError(null)
    try {
      const status = await authApi.setPassword(password)
      useAuthStore.getState().setFromStatus(status?.user ? status : await authApi.status())
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  const signOut = async () => {
    try {
      await authApi.logout()
    } catch {
      // Signed out on this side regardless.
    }
    useAuthStore.getState().signedOut()
  }

  return (
    <AuthCard title="Choose your password" description="You signed in with a setup code. Pick the password you'll use from now on.">
      <form onSubmit={submit}>
        {/* For password managers: which account this password belongs to. */}
        <input type="text" name="username" autoComplete="username" value={username} readOnly hidden />
        <TextField label="New password" name="new-password" type="password" autoComplete="new-password"
          value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
        <TextField label="Confirm password" name="confirm-password" type="password" autoComplete="new-password"
          value={confirm} onChange={(e) => setConfirm(e.target.value)} required hint={problem ?? undefined} />
        <FormError message={error} />
        <Button type="submit" variant="primary" className="w-full" disabled={busy || !newPasswordReady(password, confirm)}>
          {busy ? 'Saving…' : 'Save password'}
        </Button>
        <Button type="button" variant="ghost" className="mt-2 w-full" onClick={signOut}>
          Sign out
        </Button>
      </form>
    </AuthCard>
  )
}

export function SetupElsewhereScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <AuthCard
      title="Setup isn't finished"
      description={
        <>
          Finish setup on the computer running Lost Tales (open it at <code>localhost</code>) or run{' '}
          <code>npm run create-user</code> there.
        </>
      }
    >
      <Button className="w-full" onClick={onRetry}>
        Check again
      </Button>
    </AuthCard>
  )
}

export function StatusErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <AuthCard title="Can't reach the server" description={message}>
      <Button className="w-full" onClick={onRetry}>
        Try again
      </Button>
    </AuthCard>
  )
}
