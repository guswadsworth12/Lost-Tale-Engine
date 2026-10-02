import { useEffect, useRef, useState } from 'react'
import { KeyRound, LogOut, UserCog, Users } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { ChangePassword, signOut } from '@/components/settings/AccountSettings'
import { useAuthStore } from '@/lib/accounts/useAuthStore'
import type { SettingsTab } from '@/components/settings/SettingsView'

/**
 * Who's signed in, and the account actions people go looking for: change password, account
 * settings, Admin (owners: users, and what removed accounts left behind), sign out. Signing out
 * lands on the sign-in screen, which is also how to sign in as someone else.
 */
export function AccountMenu({ onOpen, align = 'right', className = '' }: {
  /** Opens a Settings tab: Account, or Admin for owners. */
  onOpen: (tab: Extract<SettingsTab, 'account' | 'admin'>) => void
  /** Which edge the dropdown lines up with. */
  align?: 'left' | 'right'
  className?: string
}) {
  const user = useAuthStore((s) => s.user)
  const [open, setOpen] = useState(false)
  const [changingPassword, setChangingPassword] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!user) return null
  const initial = user.username.trim().charAt(0).toUpperCase() || '?'
  const choose = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  const item = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-text transition-colors hover:bg-bg-sunken'

  return (
    <div ref={menuRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${user.username}`}
        title={`Signed in as ${user.username}`}
        className={`flex h-9 w-9 items-center justify-center rounded-full border text-sm font-semibold transition-colors ${
          open ? 'border-accent bg-accent/15 text-accent' : 'border-border bg-bg-elevated text-text hover:border-accent/60 hover:text-accent'
        }`}
      >
        {initial}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Account"
          className={`animate-panel-in absolute top-full z-40 mt-2 w-60 rounded-xl border border-border bg-bg-elevated p-1.5 themed-shadow ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <div className="px-3 pb-2 pt-1.5">
            <div className="text-[11px] text-text-muted">Signed in as</div>
            <div className="truncate text-sm font-semibold text-text">{user.username}</div>
            <div className="truncate text-xs text-text-muted">
              {user.role === 'owner' ? 'Owner' : 'Member'}
              {user.email ? ` · ${user.email}` : ''}
            </div>
          </div>
          <div className="my-1 border-t border-border" />
          <button type="button" role="menuitem" className={item} onClick={choose(() => setChangingPassword(true))}>
            <KeyRound size={16} strokeWidth={1.75} className="shrink-0 text-text-muted" /> Change password
          </button>
          <button type="button" role="menuitem" className={item} onClick={choose(() => onOpen('account'))}>
            <UserCog size={16} strokeWidth={1.75} className="shrink-0 text-text-muted" /> Account settings
          </button>
          {user.role === 'owner' && (
            <button type="button" role="menuitem" className={item} onClick={choose(() => onOpen('admin'))}>
              <Users size={16} strokeWidth={1.75} className="shrink-0 text-text-muted" /> Admin
              <span className="ml-auto text-[11px] text-text-muted">Users</span>
            </button>
          )}
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            disabled={signingOut}
            className={item}
            onClick={choose(() => {
              setSigningOut(true)
              void signOut()
            })}
          >
            <LogOut size={16} strokeWidth={1.75} className="shrink-0 text-text-muted" />
            <span>
              {signingOut ? 'Signing out…' : 'Sign out'}
              <span className="block text-[11px] text-text-muted">Or sign in as someone else</span>
            </span>
          </button>
        </div>
      )}
      {changingPassword && (
        <Modal title="Change password" size="sm" onClose={() => setChangingPassword(false)}>
          <ChangePassword username={user.username} onDone={() => setChangingPassword(false)} />
        </Modal>
      )}
    </div>
  )
}
