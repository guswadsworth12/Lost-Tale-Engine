import type { Character } from '@/lib/characters/cardSpec'
import type { Persona } from '@/lib/types'
import { personasApi } from '@/lib/api/client'

/**
 * "Who you play as": your personas plus every character (TavernAI's play-as-any-character). The
 * value is a persona id, `char:<characterId>` for a character with no linked persona yet, or ''
 * for the default "You". Resolve it with `resolvePlayAs` before saving.
 */
export function PlayAsSelect({
  value,
  onChange,
  personas,
  characters,
  label = 'You play as',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  personas: Persona[]
  characters: Character[]
  label?: string
  className?: string
}) {
  const own = personas.filter((p) => !p.characterId)
  const linkedByCharacter = new Map(personas.filter((p) => p.characterId).map((p) => [p.characterId!, p]))
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 sm:py-2 sm:text-sm"
      >
        <option value="">Default (You)</option>
        {own.length > 0 && (
          <optgroup label="Personas">
            {own.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </optgroup>
        )}
        {characters.length > 0 && (
          <optgroup label="Characters">
            {[...characters]
              .sort((a, b) => a.card.name.localeCompare(b.card.name))
              .map((c) => {
                const linked = linkedByCharacter.get(c.id)
                return <option key={c.id} value={linked ? linked.id : `char:${c.id}`}>{c.card.name}</option>
              })}
          </optgroup>
        )}
      </select>
    </label>
  )
}

/** Turns a `PlayAsSelect` value into a persona id, creating the character-linked persona on first use. */
export async function resolvePlayAs(value: string, personas: Persona[]): Promise<Persona | undefined> {
  if (!value) return undefined
  if (!value.startsWith('char:')) return personas.find((p) => p.id === value)
  const characterId = value.slice('char:'.length)
  return personas.find((p) => p.characterId === characterId) ?? (await personasApi.create({ characterId, name: '', description: '' }))
}
