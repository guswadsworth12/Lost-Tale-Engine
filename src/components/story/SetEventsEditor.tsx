import { useEffect, useState } from 'react'
import type { SetEvent } from '@/lib/world/gm'
import { draftOf, eventsFromDrafts, type SetEventDraft } from './setEvents'
import type { CampaignTrack, NamedCharacter } from '@/lib/world/gameState'
import { EffectsField } from '@/components/worlds/TracksEditor'

const inputClass = 'w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-text outline-none focus:border-accent'
const actionClass = 'rounded-lg border border-border px-3 py-1.5 text-xs text-text hover:bg-bg-sunken disabled:opacity-50'
const blank: SetEventDraft = { id: '', trigger: '', outcome: '', consequence: '', words: '' }

/**
 * The story's set events: canon beats that happen as written, with no roll, when the player
 * carries them out. Edited as drafts and saved together.
 */
export function SetEventsEditor({ events, doneIds, onSave, tracks = [], characters = [] }: {
  events: SetEvent[]
  /** Events already carried out in this branch or an earlier scene. */
  doneIds: readonly string[]
  onSave: (events: SetEvent[]) => Promise<void>
  /** The world's tracked state, for what an event changes. None hides the field. */
  tracks?: CampaignTrack[]
  /** Who a per-character change can name ("Hurt on for Bea"). */
  characters?: NamedCharacter[]
}) {
  const [drafts, setDrafts] = useState<SetEventDraft[]>(() => events.map(draftOf))
  const [saving, setSaving] = useState(false)
  const savedKey = JSON.stringify(events)
  // Follow the saved list when it changes elsewhere (another tab, a reset), not on every render.
  useEffect(() => setDrafts(events.map(draftOf)), [savedKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(eventsFromDrafts(drafts)) !== savedKey
  const change = (index: number, patch: Partial<SetEventDraft>) =>
    setDrafts((all) => all.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)))

  return <div className="space-y-2">
    <h3 className="font-medium">Set events</h3>
    <p className="text-xs text-text-muted">Canon beats of this story. When the player carries one out, it happens as written with no roll, and its consequence is recorded.</p>
    {drafts.map((draft, index) => {
      const done = !!draft.id && doneIds.includes(draft.id)
      return <div key={draft.id || `new-${index}`} className="space-y-1.5 rounded-xl border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${done ? 'bg-success/15 text-success' : 'bg-bg-sunken text-text-muted'}`}>{done ? 'Happened' : 'To come'}</span>
          <button className="text-xs text-text-muted hover:text-text" onClick={() => setDrafts((all) => all.filter((_, i) => i !== index))}>Remove</button>
        </div>
        <label className="block space-y-1 text-xs text-text-muted">What happens<input className={inputClass} value={draft.trigger} placeholder="Rend binds the Unbound into Emily's form" onChange={(e) => change(index, { trigger: e.target.value })} /></label>
        <label className="block space-y-1 text-xs text-text-muted">Result, applied with no roll<textarea className={`${inputClass} min-h-16`} value={draft.outcome} onChange={(e) => change(index, { outcome: e.target.value })} /></label>
        <label className="block space-y-1 text-xs text-text-muted">Lasting consequence (optional)<input className={inputClass} value={draft.consequence} placeholder="Rend is strained." onChange={(e) => change(index, { consequence: e.target.value })} /></label>
        {tracks.length > 0 && <EffectsField label="Tracked-state change (optional)" tracks={tracks} characters={characters} effects={draft.effects}
          placeholder="Hurt on for Bea, Supplies -1" onChange={(effects) => change(index, { effects })} />}
        <label className="block space-y-1 text-xs text-text-muted">Recognise by words (commas: all needed; | : either)<input className={inputClass} value={draft.words} placeholder="bind, Emily | Unbound" onChange={(e) => change(index, { words: e.target.value })} /></label>
      </div>
    })}
    <div className="flex gap-2">
      <button className={actionClass} onClick={() => setDrafts((all) => [...all, { ...blank }])}>Add set event</button>
      <button className={actionClass} disabled={!dirty || saving} onClick={async () => {
        setSaving(true)
        try { await onSave(eventsFromDrafts(drafts)) } finally { setSaving(false) }
      }}>{saving ? 'Saving…' : 'Save set events'}</button>
    </div>
  </div>
}
