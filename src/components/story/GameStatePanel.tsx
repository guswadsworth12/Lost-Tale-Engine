import { useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import {
  PLAYER_HOLDER,
  appliedText,
  trackValue,
  type AppliedChange,
  type CampaignTrack,
  type GameState,
  type NamedCharacter,
  type StateChangeSource,
  type TrackEffect,
} from '@/lib/world/gameState'

const actionClass = 'rounded-lg border border-border px-2 py-1 text-xs text-text hover:bg-bg-sunken disabled:opacity-50'
const inputClass = 'min-w-0 flex-1 rounded-lg border border-border bg-bg-sunken px-2 py-1 text-xs text-text outline-none focus:border-accent'

const SOURCE_LABEL: Record<StateChangeSource, string> = {
  roll: 'roll',
  choice: 'choice',
  set_event: 'set event',
  gm: 'GM, confirmed',
  player: 'you',
}

/** Who a per-character track has a row for: the player, the given cast, and anyone already holding a value. */
export function holdersFor(track: CampaignTrack, state: GameState, people: readonly NamedCharacter[], playerId?: string): NamedCharacter[] {
  const player = playerId ?? PLAYER_HOLDER
  const ids = [player, ...people.map((p) => p.id), ...Object.keys(state).filter((key) => key.startsWith(`${track.id}@`)).map((key) => key.slice(track.id.length + 1))]
  return [...new Set(ids)].map((id) => ({ id, name: people.find((p) => p.id === id)?.name ?? (id === PLAYER_HOLDER ? 'You' : id) }))
}

function ItemsRow({ items, disabled, onEdit }: { items: string[]; disabled: boolean; onEdit: (effect: Pick<TrackEffect, 'gain' | 'lose'>) => void }) {
  const [item, setItem] = useState('')
  return <div className="space-y-1.5">
    <div className="flex flex-wrap gap-1">
      {items.length ? items.map((entry) => <span key={entry} className="inline-flex items-center gap-1 rounded-md bg-bg-sunken px-2 py-0.5 text-[11px]">
        {entry}
        <button type="button" disabled={disabled} onClick={() => onEdit({ lose: entry })} aria-label={`Remove ${entry}`} className="text-text-muted hover:text-text"><X size={11} /></button>
      </span>) : <span className="text-xs text-text-muted">Nothing yet</span>}
    </div>
    <div className="flex gap-1.5">
      <input className={inputClass} value={item} maxLength={60} onChange={(e) => setItem(e.target.value)} placeholder="Add an item" />
      <button type="button" className={actionClass} disabled={disabled || !item.trim()} onClick={() => { onEdit({ gain: item.trim() }); setItem('') }}>Add</button>
    </div>
  </div>
}

function ValueRow({ track, value, disabled, onEdit }: { track: CampaignTrack; value: ReturnType<typeof trackValue>; disabled: boolean; onEdit: (effect: Omit<TrackEffect, 'trackId'>) => void }) {
  if (track.kind === 'condition') {
    return <label className="flex items-center gap-2 text-xs">
      <input type="checkbox" checked={!!value} disabled={disabled} onChange={(e) => onEdit({ set: e.target.checked })} />
      {value ? 'On' : 'Off'}
    </label>
  }
  if (track.kind === 'items') return <ItemsRow items={Array.isArray(value) ? value : []} disabled={disabled} onEdit={onEdit} />
  const n = typeof value === 'number' ? value : 0
  return <div className="flex items-center gap-2">
    <button type="button" className={actionClass} disabled={disabled || n <= 0} onClick={() => onEdit({ delta: -1 })} aria-label={`Lower ${track.name}`}><Minus size={12} /></button>
    <span className="min-w-12 text-center font-mono text-sm">{n}{track.max !== undefined ? `/${track.max}` : ''}</span>
    <button type="button" className={actionClass} disabled={disabled || (track.max !== undefined && n >= track.max)} onClick={() => onEdit({ delta: 1 })} aria-label={`Raise ${track.name}`}><Plus size={12} /></button>
  </div>
}

/**
 * The Story panel's State tab: tracked state as it stands in this branch, editable, with what
 * changed it lately. Edits are the player's corrections and follow the branch like any other change.
 */
export function GameStatePanel({ tracks, state, log, people, playerId, busy, onEdit }: {
  tracks: CampaignTrack[]
  state: GameState
  log: AppliedChange[]
  /** Characters a per-character track shows rows for, beside the player. */
  people: NamedCharacter[]
  playerId?: string
  busy: boolean
  onEdit: (effects: TrackEffect[]) => void
}) {
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name
  return <div className="space-y-4">
    <div>
      <h3 className="font-medium">Tracked state</h3>
      <p className="mt-1 text-xs text-text-muted">Rolls, choices, and set events change these by the world's rules. Your edits follow the story when you rewind.</p>
    </div>
    {tracks.map((track) => <div key={track.id} className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <strong className="text-sm">{track.name}</strong>
        {track.gmOnly && <span className="rounded-full bg-bg-sunken px-1.5 text-[10px] text-text-muted">GM only</span>}
        {track.perScene && <span className="rounded-full bg-bg-sunken px-1.5 text-[10px] text-text-muted">Each scene</span>}
      </div>
      {track.description && <p className="text-xs text-text-muted">{track.description}</p>}
      {track.perCharacter
        ? holdersFor(track, state, people, playerId).map((holder) => <div key={holder.id} className="flex items-center justify-between gap-2">
            <span className="text-xs text-text-muted">{holder.name}</span>
            <ValueRow track={track} value={trackValue(state, track, holder.id)} disabled={busy} onEdit={(effect) => onEdit([{ ...effect, trackId: track.id, who: holder.id }])} />
          </div>)
        : <ValueRow track={track} value={trackValue(state, track)} disabled={busy} onEdit={(effect) => onEdit([{ ...effect, trackId: track.id }])} />}
    </div>)}
    <div>
      <h3 className="font-medium">Recent changes</h3>
      {log.length
        ? <ul className="mt-2 space-y-1">{log.slice(-8).reverse().map((entry, i) => <li key={`${entry.messageId}-${i}`} className="flex justify-between gap-2 rounded-lg bg-bg-sunken px-2 py-1 text-xs">
            <span>{appliedText(entry, nameOf)}</span><span className="shrink-0 text-text-muted">{SOURCE_LABEL[entry.change.source]}</span>
          </li>)}</ul>
        : <p className="mt-1 text-xs text-text-muted">Nothing has changed in this scene yet.</p>}
    </div>
  </div>
}
