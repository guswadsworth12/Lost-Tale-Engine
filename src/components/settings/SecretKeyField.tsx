import { useId, useState, type ReactNode } from 'react'
import type { SecretName } from '@/lib/accounts/contract'
import { secretsApi } from '@/lib/accounts/secrets'
import { Button } from '@/components/ui/Button'
import { errorMessage, toastError } from '@/lib/store/useToastStore'

const DEFAULT_INPUT_CLASS =
  'w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 placeholder:text-text-muted/55 sm:py-2 sm:text-sm'

/**
 * A write-only key field. A saved key is never shown, prefilled, or read back: the field says
 * "Saved" with Replace/Remove, or offers an empty input with Save. The typed value lives in this
 * component only until it's saved, then is cleared. The server stores it encrypted and attaches
 * it to outgoing calls itself.
 */
export function SecretKeyField({
  name,
  label,
  saved,
  hint,
  placeholder,
  inputClassName = DEFAULT_INPUT_CLASS,
  labelClassName = 'mb-1 block text-xs font-medium text-text-muted',
  className = 'mb-3',
  onSaved,
}: {
  name: SecretName
  label: ReactNode
  /** Whether this key is saved (`useSecretStatus().saved[name]`). */
  saved: boolean
  hint?: ReactNode
  placeholder?: string
  inputClassName?: string
  labelClassName?: string
  className?: string
  /** After a save or remove, e.g. to re-run a connection check. */
  onSaved?: () => void
}) {
  const id = useId()
  const [draft, setDraft] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const value = draft.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await secretsApi.set(name, value)
      setDraft('')
      setReplacing(false)
      onSaved?.()
    } catch (e) {
      toastError(`Couldn't save the key: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (busy) return
    setBusy(true)
    try {
      await secretsApi.remove(name)
      setDraft('')
      setReplacing(false)
      onSaved?.()
    } catch (e) {
      toastError(`Couldn't remove the key: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const editing = !saved || replacing
  return (
    <div className={className}>
      <label htmlFor={id} className={labelClassName}>
        {label}
      </label>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="password"
            autoComplete="off"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void save()
              }
            }}
            placeholder={placeholder ?? (replacing ? 'Paste the new key' : 'Paste your key')}
            className={inputClassName}
          />
          <Button variant="primary" onClick={() => void save()} disabled={busy || !draft.trim()}>
            Save
          </Button>
          {replacing && (
            <Button variant="ghost" onClick={() => { setDraft(''); setReplacing(false) }} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span id={id} className="flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text">
            Saved
          </span>
          <Button onClick={() => setReplacing(true)} disabled={busy}>
            Replace
          </Button>
          <Button variant="ghost" onClick={() => void remove()} disabled={busy}>
            Remove
          </Button>
        </div>
      )}
      {hint && <span className="mt-1 block text-[11px] text-text-muted">{hint}</span>}
    </div>
  )
}
