import { useState } from 'react'
import type { CharacterMemory } from '@/lib/types'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { memoriesApi, worldsApi } from '@/lib/api/client'
import { newId } from '@/lib/id'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { canonTextFrom, claimsToReview, promoteToCanon, ruledClaims } from './claimReview'

const inputClass = 'w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-text outline-none focus:border-accent'
const actionClass = 'rounded-lg border border-border px-2 py-1 text-xs text-text hover:bg-bg-sunken disabled:opacity-50'

/**
 * Claims and beliefs the characters picked up in this story, for the player to rule on: true,
 * false, corrected, or made world canon. Nothing here becomes canon on its own, and a ruling is
 * the GM's to know: the characters who heard a claim keep believing it.
 */
export function ClaimReview({ chatId, worldId, nameOf }: {
  chatId: string
  /** The story's world; without one, "Make world canon" is hidden. */
  worldId?: string
  nameOf: (id: string) => string | undefined
}) {
  const memories = useApiQuery('memories', () => memoriesApi.forChat(chatId), [chatId])
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<{ id: string; mode: 'correct' | 'canon'; text: string } | null>(null)
  if (!memories) return null
  const open = claimsToReview(memories)
  const ruled = ruledClaims(memories)

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try { await action() } catch (error) { toastError(errorMessage(error)) } finally { setBusy(false) }
  }
  const knowers = (m: CharacterMemory) => [...new Set(m.knownBy)].map(nameOf).filter((n): n is string => !!n).join(', ') || 'no one named'
  const rule = (m: CharacterMemory, verdict: 'true' | 'false' | null) => run(() => memoriesApi.update(m.id, { verdict }))
  const saveCorrection = (m: CharacterMemory, text: string) => run(async () => {
    if (text.trim() && text.trim() !== m.text.trim()) await memoriesApi.update(m.id, { text: text.trim() })
    setEditing(null)
  })
  const makeCanon = (m: CharacterMemory, text: string) => run(async () => {
    if (!worldId || !text.trim()) return
    const ok = await confirmDialog({
      title: 'Make this world canon?',
      body: `"${text.trim()}" becomes true for every story in this world. The characters are not told; they learn it in play.`,
      confirmLabel: 'Make canon',
      tone: 'default',
    })
    if (!ok) return
    // Read fresh, as finishScene does, so a fact added elsewhere since this render is kept.
    const current = await worldsApi.get(worldId)
    if (!current) throw new Error('This world no longer exists.')
    const promoted = promoteToCanon(current.canonFacts, text, chatId, newId(), Date.now())
    if (!promoted) return
    await worldsApi.update(worldId, { canonFacts: promoted.canonFacts })
    await memoriesApi.update(m.id, promoted.memoryPatch)
    setEditing(null)
  })

  return <div className="space-y-2">
    <h3 className="font-medium">Unconfirmed claims {open.length > 0 && <span className="rounded-full bg-accent/15 px-1.5 text-xs text-accent">{open.length}</span>}</h3>
    <p className="text-xs text-text-muted">What characters heard or believe. None of it is canon until you say so. A ruling guides the Game Master only; characters keep believing what they heard.</p>
    {open.length ? open.map((m) => {
      const edit = editing?.id === m.id ? editing : null
      return <div key={m.id} className="space-y-2 rounded-xl border border-border p-3">
        <p className="text-xs"><span className="mr-1 rounded-full bg-bg-sunken px-1.5 py-px text-[10px] text-text-muted">{m.certainty === 'belief' ? 'Belief' : 'Heard'}</span>{m.text}</p>
        <p className="text-[11px] text-text-muted">Known by: {knowers(m)}</p>
        {edit ? <div className="space-y-1.5">
          <textarea className={`${inputClass} min-h-16`} value={edit.text} autoFocus aria-label={edit.mode === 'canon' ? 'World fact' : 'Corrected claim'}
            onChange={(event) => setEditing({ ...edit, text: event.target.value })} />
          {edit.mode === 'canon' && <p className="text-[11px] text-text-muted">Word it as a fact of the world.</p>}
          <div className="flex gap-1.5">
            <button className={actionClass} disabled={busy || !edit.text.trim()}
              onClick={() => (edit.mode === 'canon' ? makeCanon(m, edit.text) : saveCorrection(m, edit.text))}>{edit.mode === 'canon' ? 'Add to world canon' : 'Save'}</button>
            <button className={actionClass} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div> : <div className="flex flex-wrap gap-1.5">
          <button className={actionClass} disabled={busy} onClick={() => rule(m, 'true')}>True</button>
          <button className={actionClass} disabled={busy} onClick={() => rule(m, 'false')} title="The characters who heard it still believe it">False</button>
          <button className={actionClass} disabled={busy} onClick={() => setEditing({ id: m.id, mode: 'correct', text: m.text })}>Correct…</button>
          {worldId && <button className={actionClass} disabled={busy} onClick={() => setEditing({ id: m.id, mode: 'canon', text: canonTextFrom(m.text) })}>Make world canon…</button>}
        </div>}
      </div>
    }) : <p className="text-xs text-text-muted">No unconfirmed claims or beliefs.</p>}
    {ruled.length > 0 && <details className="rounded-xl border border-border p-3">
      <summary className="cursor-pointer text-xs text-text-muted">Ruled · {ruled.length}</summary>
      <div className="mt-2 space-y-2">{ruled.map((m) => <div key={m.id} className="space-y-1">
        <p className="text-xs">{m.text}</p>
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          {m.canonFactId ? <span>In world canon</span> : <>
            <span className={m.verdict === 'true' ? 'text-success' : 'text-danger'}>Ruled {m.verdict}</span>
            <button className="hover:text-text disabled:opacity-50" disabled={busy} onClick={() => rule(m, null)}>Undo</button>
          </>}
        </div>
      </div>)}</div>
    </details>}
  </div>
}
