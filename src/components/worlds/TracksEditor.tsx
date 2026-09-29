import { useEffect, useState } from 'react'
import { choiceEffectsText, effectsText, MAX_TRACKS, parseChoiceEffects, parseEffects, type CampaignTrack, type MoveEffects, type NamedCharacter, type TrackEffect, type TrackKind } from '@/lib/world/gameState'
import { newId } from '@/lib/id'
import { NumberField, SelectField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { changeTrackKind, newTrack, tracksProblem } from './tracks'

const KINDS: { id: TrackKind; label: string }[] = [
  { id: 'resource', label: 'Resource (a number)' },
  { id: 'condition', label: 'Condition (on or off)' },
  { id: 'clock', label: 'Clock (fills up)' },
  { id: 'items', label: 'Items (a list)' },
]

/** The world's tracked state: what play keeps count of. Removing one goes through `onRemove`, so move effects on it go too. */
export function TracksEditor({ tracks, onChange, onRemove }: {
  tracks: CampaignTrack[]
  onChange: (tracks: CampaignTrack[]) => void
  onRemove: (trackId: string) => void
}) {
  const update = (id: string, patch: Partial<CampaignTrack>) => onChange(tracks.map((track) => (track.id === id ? { ...track, ...patch } : track)))
  const problem = tracksProblem(tracks)
  return <div className="space-y-3">
    {tracks.map((track) => <div key={track.id} className="rounded-xl border border-border bg-bg-sunken p-4">
      <div className="mb-3 flex items-center justify-between gap-2"><strong className="text-sm text-text">{track.name || 'Tracked thing'}</strong><Button variant="secondary" onClick={() => onRemove(track.id)}>Remove</Button></div>
      <TextField label="Name" maxLength={60} value={track.name} onChange={(e) => update(track.id, { name: e.target.value })} />
      <SelectField label="Kind" value={track.kind} onChange={(e) => onChange(tracks.map((entry) => (entry.id === track.id ? changeTrackKind(entry, e.target.value as TrackKind) : entry)))}>
        {KINDS.map((kind) => <option key={kind.id} value={kind.id}>{kind.label}</option>)}
      </SelectField>
      {(track.kind === 'resource' || track.kind === 'clock') && <NumberField label={track.kind === 'clock' ? 'Segments' : 'Most it can be (optional)'} min={1} max={track.kind === 'clock' ? 20 : 999} step={1} value={track.max ?? ''} onChange={(e) => {
        const value = e.target.value === '' ? undefined : Number(e.target.value)
        if (value === undefined ? track.kind === 'resource' : Number.isInteger(value) && value >= 1 && value <= (track.kind === 'clock' ? 20 : 999)) update(track.id, { max: value })
      }} />}
      {track.kind === 'resource' && <NumberField label="Starts at (optional)" hint="Leave blank to start full." min={0} max={track.max ?? 999} step={1} value={track.start ?? ''} onChange={(e) => {
        const value = e.target.value === '' ? undefined : Number(e.target.value)
        if (value === undefined || Number.isInteger(value) && value >= 0 && value <= (track.max ?? 999)) update(track.id, { start: value })
      }} />}
      <TextField label="Description (optional)" maxLength={300} value={track.description ?? ''} onChange={(e) => update(track.id, { description: e.target.value || undefined })} />
      <div className="flex flex-wrap gap-4 text-sm text-text">
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!track.perCharacter} onChange={(e) => update(track.id, { perCharacter: e.target.checked || undefined })} /> Each character has their own</label>
        {track.kind === 'clock' && <label className="flex items-center gap-2"><input type="checkbox" checked={!!track.perScene} onChange={(e) => update(track.id, { perScene: e.target.checked || undefined })} /> Empty at each new scene</label>}
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!track.gmOnly} onChange={(e) => update(track.id, { gmOnly: e.target.checked || undefined })} /> Only the GM sees it</label>
      </div>
    </div>)}
    {problem && <p className="text-xs text-danger">{problem}</p>}
    <Button variant="secondary" disabled={tracks.length >= MAX_TRACKS} onClick={() => onChange([...tracks, newTrack(tracks, newId())])}>Add tracked thing</Button>
  </div>
}

const inputClass = 'w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-text outline-none focus:border-accent'

/**
 * Effects written in the short form ("Supplies -1, Hurt on"). Read when the field loses focus; text
 * that doesn't read stays in the box with the reason and nothing is saved from it.
 */
export function EffectsField({ label, effects, tracks, characters = [], onChange, placeholder }: {
  label: string
  effects: TrackEffect[] | undefined
  tracks: CampaignTrack[]
  characters?: NamedCharacter[]
  onChange: (effects: TrackEffect[] | undefined) => void
  placeholder?: string
}) {
  const saved = effectsText(effects, tracks, characters)
  return <ShortFormField label={label} saved={saved} placeholder={placeholder} read={(text) => {
    const parsed = parseEffects(text, tracks, characters)
    return { problem: parsed.errors[0], commit: () => onChange(parsed.effects.length ? parsed.effects : undefined) }
  }} />
}

/** A move's choice costs in the short form: "hurt: Hurt on; spent: Supplies -1". */
export function ChoiceEffectsField({ label, entries, tracks, onChange }: {
  label: string
  entries: MoveEffects['choiceEffects']
  tracks: CampaignTrack[]
  onChange: (entries: MoveEffects['choiceEffects']) => void
}) {
  return <ShortFormField label={label} saved={choiceEffectsText(entries, tracks)} placeholder="hurt: Hurt on; spent: Supplies -1" read={(text) => {
    const parsed = parseChoiceEffects(text, tracks)
    return { problem: parsed.errors[0], commit: () => onChange(parsed.choiceEffects.length ? parsed.choiceEffects : undefined) }
  }} />
}

function ShortFormField({ label, saved, placeholder, read }: {
  label: string
  saved: string
  placeholder?: string
  read: (text: string) => { problem?: string; commit: () => void }
}) {
  const [draft, setDraft] = useState(saved)
  const [problem, setProblem] = useState('')
  // Follow the saved value when it changes (a commit, a renamed track, a preset), not on every render.
  useEffect(() => { setDraft(saved); setProblem('') }, [saved])
  return <label className="block space-y-1 text-xs text-text-muted">
    {label}
    <input className={inputClass} value={draft} placeholder={placeholder} onChange={(e) => { setDraft(e.target.value); setProblem('') }} onBlur={() => {
      const result = read(draft)
      if (result.problem) return setProblem(result.problem)
      result.commit()
    }} />
    {problem && <span className="block text-danger">{problem}</span>}
  </label>
}
