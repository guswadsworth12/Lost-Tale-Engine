import type { Character } from '@/lib/characters/cardSpec'

/**
 * "Who you play": any card. The value is a character id, or '' for an unnamed "You" (offered only
 * with `allowNone`). "You only" cards come first under "Player characters"; every other card is
 * listed under "Cast", since any of them can be taken over too.
 */
export function PlayAsSelect({
  value,
  onChange,
  characters,
  excludeIds = [],
  allowNone = false,
  label = 'Who you play',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  characters: Character[]
  /** Cards that can't be picked here (e.g. the story's lead). */
  excludeIds?: string[]
  /** Offer '' as an unnamed "You". */
  allowNone?: boolean
  label?: string
  className?: string
}) {
  const excluded = new Set(excludeIds)
  const byName = (a: Character, b: Character) => a.card.name.localeCompare(b.card.name)
  const pickable = characters.filter((c) => !excluded.has(c.id))
  const players = pickable.filter((c) => c.playerOnly).sort(byName)
  const cast = pickable.filter((c) => !c.playerOnly).sort(byName)
  // Keep an out-of-list value visible rather than letting the <select> silently show another option.
  const known = value === '' ? allowNone : pickable.some((c) => c.id === value)
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 sm:py-2 sm:text-sm"
      >
        {allowNone && <option value="">You (unnamed)</option>}
        {!known && <option value={value} disabled>{value ? 'Unavailable card' : 'Pick a card…'}</option>}
        {players.length > 0 && (
          <optgroup label="Player characters">
            {players.map((c) => <option key={c.id} value={c.id}>{c.card.name}</option>)}
          </optgroup>
        )}
        {cast.length > 0 && (
          <optgroup label="Cast">
            {cast.map((c) => <option key={c.id} value={c.id}>{c.card.name}</option>)}
          </optgroup>
        )}
      </select>
    </label>
  )
}
