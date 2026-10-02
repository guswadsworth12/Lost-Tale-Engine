import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { PASSWORD_MIN_LENGTH } from '@/components/auth/passwordRules'
import { adminApi, isSetupCodeIssued, usersApi } from '@/lib/accounts/api'
import type { AccountRole, AccountUser, LeftoverAccount, SetupCodeIssued } from '@/lib/accounts/contract'
import { useAuthStore } from '@/lib/accounts/useAuthStore'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { SetupCodeNotice } from './AccountSettings'

/**
 * The owner's housekeeping: who has an account, and what removed accounts left behind
 * (server/leftovers.ts). Removing someone keeps their things, owned by nobody who can sign in; the
 * owner's policy decides what happens to them straight away, and anything still left is listed here.
 */

type Policy = 'adopt' | 'delete'

const POLICY_NOTE: Record<Policy, string> = {
  adopt: 'Their worlds, characters, lore and stories pass to you, kept as they are.',
  delete: 'What only they had is deleted for good. Anything they shared, or that someone else uses, passes to you instead.',
}

const KIND_LABELS: [keyof LeftoverAccount['counts'], string, string][] = [
  ['stories', 'story', 'stories'],
  ['chats', 'scene or chat', 'scenes and chats'],
  ['worlds', 'world', 'worlds'],
  ['characters', 'character', 'characters'],
  ['world_info_books', 'lore book', 'lore books'],
  ['personas', 'persona', 'personas'],
  ['presets', 'preset', 'presets'],
  ['themes', 'theme', 'themes'],
  ['instruct_templates', 'template', 'templates'],
  ['assistant_threads', "Writer's Room thread", "Writer's Room threads"],
]

function describeCounts(counts: LeftoverAccount['counts']): string {
  return KIND_LABELS.filter(([key]) => counts[key]).map(([key, one, many]) => `${counts[key]} ${counts[key] === 1 ? one : many}`).join(', ')
}

function cleanupSummary(done: { adopted: number; deleted: number }): string {
  const parts = [
    done.deleted ? `deleted ${done.deleted} record${done.deleted === 1 ? '' : 's'}` : '',
    done.adopted ? `${done.adopted} passed to you` : '',
  ].filter(Boolean)
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1) + '.'
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
            : 'Share it with them; they can change it from the account menu.'}
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
  const policy = useSettingsStore((s) => s.removedAccountPolicy)
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
      body: `They can no longer sign in, and their settings and keys are deleted. ${POLICY_NOTE[policy]}`,
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await usersApi.remove(user.id)
      toastSuccess(`Removed ${user.username}.`)
      try {
        const done = await adminApi.cleanUp(user.id, policy)
        if (done.deleted || done.adopted) toastSuccess(cleanupSummary(done))
      } catch (err) {
        toastError(`Removed, but their things weren't cleaned up: ${errorMessage(err)}. They're listed under Left behind.`)
      }
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

function ManageUsers({ selfId, onChanged }: { selfId: string; onChanged: () => void }) {
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
      <Section title="Users" description="Each person's stories, settings and keys are their own. Worlds, characters and lore are private until their maker shares them.">
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
              <UserRow key={u.id} user={u} isSelf={u.id === selfId} onChanged={() => { load(); onChanged() }}
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

function LeftBehind({ refreshKey }: { refreshKey: number }) {
  const [list, setList] = useState<LeftoverAccount[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(() => {
    adminApi
      .leftovers()
      .then((rows) => {
        setList(rows)
        setError(null)
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])
  useEffect(load, [load, refreshKey])

  const act = async (entry: LeftoverAccount, action: Policy) => {
    const name = entry.username ?? 'this removed account'
    if (action === 'delete') {
      const ok = await confirmDialog({
        title: `Delete what ${name} left behind?`,
        body: `${POLICY_NOTE.delete} The database is backed up first.`,
        confirmLabel: 'Delete',
        tone: 'danger',
      })
      if (!ok) return
    }
    setBusy(entry.formerOwnerId)
    try {
      toastSuccess(cleanupSummary(await adminApi.cleanUp(entry.formerOwnerId, action)))
      load()
    } catch (err) {
      toastError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Section title="Left behind" description="Things made by accounts that were removed. Nobody can open them until you take them over or delete them.">
      {error && <p className="text-xs text-danger">{error}</p>}
      {!error && list === null && <p className="text-xs text-text-muted">Loading…</p>}
      {list?.length === 0 && <p className="text-sm text-text-muted">Nothing. Every record belongs to someone who can sign in.</p>}
      {list && list.length > 0 && (
        <ul className="divide-y divide-border">
          {list.map((entry) => (
            <li key={entry.formerOwnerId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="text-sm text-text">
                  {entry.username ?? <span className="text-text-muted">An account removed earlier</span>}
                  {entry.removedAt && <span className="ml-2 text-xs text-text-muted">removed {new Date(entry.removedAt).toLocaleDateString()}</span>}
                </div>
                <div className="mt-0.5 text-xs text-text-muted">
                  {describeCounts(entry.counts)}
                  {entry.shared > 0 && ` · ${entry.shared} shared`}
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" disabled={busy === entry.formerOwnerId} onClick={() => void act(entry, 'adopt')}>Give to me</Button>
                <Button variant="ghost" className="hover:!text-danger" disabled={busy === entry.formerOwnerId} onClick={() => void act(entry, 'delete')}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function RemovalPolicy() {
  const policy = useSettingsStore((s) => s.removedAccountPolicy)
  const setPolicy = useSettingsStore((s) => s.setRemovedAccountPolicy)
  return (
    <Section title="When you remove someone" description={POLICY_NOTE[policy]}>
      <SegmentedControl<Policy>
        fill
        value={policy}
        onChange={setPolicy}
        options={[
          { value: 'adopt', label: 'Give their things to me' },
          { value: 'delete', label: 'Delete what only they had' },
        ]}
      />
    </Section>
  )
}

export function AdminSettings() {
  const user = useAuthStore((s) => s.user)
  // Removing someone can leave things behind (if cleaning up fails), so the list reloads after.
  const [refreshKey, setRefreshKey] = useState(0)
  if (user?.role !== 'owner') return null
  return (
    <SettingsPage>
      <ManageUsers selfId={user.id} onChanged={() => setRefreshKey((k) => k + 1)} />
      <RemovalPolicy />
      <LeftBehind refreshKey={refreshKey} />
    </SettingsPage>
  )
}
