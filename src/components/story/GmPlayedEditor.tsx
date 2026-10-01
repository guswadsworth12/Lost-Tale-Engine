import { useEffect, useState } from 'react'
import type { GmPlayedCharacter, SetEvent } from '@/lib/world/gm'

const inputClass = 'w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-text outline-none focus:border-accent'
const actionClass = 'rounded-lg border border-border px-3 py-1.5 text-xs text-text hover:bg-bg-sunken disabled:opacity-50'

/** Saved entries without a character or a description can't be played: they're dropped on save. */
export function playedFromDrafts(drafts: readonly GmPlayedCharacter[]): GmPlayedCharacter[] {
  return drafts.flatMap((draft) => {
    const as = draft.as.trim()
    if (!draft.characterId || !as) return []
    return [{ characterId: draft.characterId, as, ...(draft.until ? { until: draft.until } : {}), ...(draft.form ? { form: draft.form } : {}) }]
  })
}

/**
 * Characters the Game Master plays itself for now: it voices them, they have no agent, until the
 * chosen set event hands them over, optionally in one of their own forms. Edited as drafts and
 * saved together.
 */
export function GmPlayedEditor({ played, events, doneIds, characters, onSave }: {
  played: GmPlayedCharacter[]
  /** The story's set events: one of them hands a character over. */
  events: SetEvent[]
  /** Set events already carried out in this branch or an earlier scene. */
  doneIds: readonly string[]
  /** Who can be GM-played, with their own outfits and forms. */
  characters: { id: string; name: string; forms: { id: string; label: string }[] }[]
  onSave: (played: GmPlayedCharacter[]) => Promise<void>
}) {
  const [drafts, setDrafts] = useState<GmPlayedCharacter[]>(played)
  const [saving, setSaving] = useState(false)
  const savedKey = JSON.stringify(played)
  // Follow the saved list when it changes elsewhere (another tab, a reset), not on every render.
  useEffect(() => setDrafts(played), [savedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(playedFromDrafts(drafts)) !== savedKey
  const change = (index: number, patch: Partial<GmPlayedCharacter>) =>
    setDrafts((all) => all.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)))

  return <div className="space-y-2">
    <h3 className="font-medium">Played by the Game Master</h3>
    <p className="text-xs text-text-muted">A character the GM voices itself, with no agent of their own, until a set event hands them over. Use it for someone who isn't themselves yet.</p>
    {drafts.map((draft, index) => {
      const handedOver = !!draft.until && doneIds.includes(draft.until)
      const forms = characters.find((c) => c.id === draft.characterId)?.forms ?? []
      return <div key={index} className="space-y-1.5 rounded-xl border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${handedOver ? 'bg-success/15 text-success' : 'bg-bg-sunken text-text-muted'}`}>{handedOver ? 'Handed over' : 'GM plays them'}</span>
          <button className="text-xs text-text-muted hover:text-text" onClick={() => setDrafts((all) => all.filter((_, i) => i !== index))}>Remove</button>
        </div>
        <label className="block space-y-1 text-xs text-text-muted">Character<select className={inputClass} value={draft.characterId} onChange={(e) => change(index, { characterId: e.target.value, form: undefined })}>
          <option value="">Choose…</option>
          {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
        <label className="block space-y-1 text-xs text-text-muted">The GM plays them as<input className={inputClass} value={draft.as} placeholder="the Unbound, a formless hunger pressing at the seal" onChange={(e) => change(index, { as: e.target.value })} /></label>
        <label className="block space-y-1 text-xs text-text-muted">Until<select className={inputClass} value={draft.until ?? ''} onChange={(e) => change(index, { until: e.target.value || undefined })}>
          <option value="">I change it here</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.trigger}</option>)}
        </select></label>
        {draft.until && forms.length > 0 && <label className="block space-y-1 text-xs text-text-muted">Then appears as<select className={inputClass} value={draft.form ?? ''} onChange={(e) => change(index, { form: e.target.value || undefined })}>
          <option value="">Their usual look</option>
          {forms.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select></label>}
      </div>
    })}
    <div className="flex gap-2">
      <button className={actionClass} onClick={() => setDrafts((all) => [...all, { characterId: '', as: '' }])}>Add character</button>
      <button className={actionClass} disabled={!dirty || saving} onClick={async () => {
        setSaving(true)
        try { await onSave(playedFromDrafts(drafts)) } finally { setSaving(false) }
      }}>{saving ? 'Saving…' : 'Save'}</button>
    </div>
  </div>
}
