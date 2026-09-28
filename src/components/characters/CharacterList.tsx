import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi } from '@/lib/api/client'
import type { Character } from '@/lib/characters/cardSpec'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { Button } from '@/components/ui/Button'
import { ViewShell } from '@/components/ui/ViewShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { filterCast, groupByTag, type CastScope } from './characterListFilter'

const chipClass = (on: boolean) =>
  `rounded-full px-3 py-1 text-xs ${on ? 'bg-accent/10 text-accent' : 'bg-bg-sunken text-text-muted'}`

export function CharacterList({
  onSelect,
  onCreateNew,
}: {
  onSelect: (character: Character) => void
  /** `playerOnly` opens a blank editor with "You only" already switched on. Nothing is saved until the editor is. */
  onCreateNew: (options?: { playerOnly?: boolean }) => void
}) {
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const tagsAsFolders = useSettingsStore((s) => s.tagsAsFolders)
  const [scope, setScope] = useState<CastScope>({ kind: 'all' })
  const [search, setSearch] = useState('')

  const groups = useMemo(() => groupByTag(characters), [characters])
  const playerCount = useMemo(() => characters.filter((c) => c.playerOnly === true).length, [characters])
  const showTagChips = tagsAsFolders && groups.size > 1
  // A tag folder left selected after "tags as folders" is switched off would filter invisibly.
  const effectiveScope: CastScope = scope.kind === 'tag' && !showTagChips ? { kind: 'all' } : scope
  const visible = filterCast(characters, effectiveScope, search)

  const createPlayer = () => onCreateNew({ playerOnly: true })
  const createCharacter = () => onCreateNew()

  return (
    <ViewShell
      title="Characters"
      width="wide"
      actions={
        <>
          <Button onClick={createPlayer} aria-label="New player character" title="A card only you play. The AI never voices it." className="flex items-center gap-1.5">
            <Plus size={14} strokeWidth={2} aria-hidden />
            <span className="sm:hidden">Player</span>
            <span className="hidden sm:inline">New player character</span>
          </Button>
          <Button variant="primary" onClick={createCharacter} aria-label="New character" className="flex items-center gap-1.5">
            <Plus size={14} strokeWidth={2} aria-hidden />
            <span className="sm:hidden">New</span>
            <span className="hidden sm:inline">New character</span>
          </Button>
        </>
      }
    >
      <div className="mb-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search characters…"
          aria-label="Search characters"
          className="w-full max-w-xs rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 placeholder:text-text-muted/55 sm:py-2 sm:text-sm"
        />
      </div>

      {characters.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter characters">
          <button type="button" aria-pressed={effectiveScope.kind === 'all'} onClick={() => setScope({ kind: 'all' })} className={chipClass(effectiveScope.kind === 'all')}>
            All
          </button>
          <button
            type="button"
            aria-pressed={effectiveScope.kind === 'player'}
            onClick={() => setScope({ kind: 'player' })}
            title="Cards marked “You only”: made for you to play, never voiced by the AI"
            className={chipClass(effectiveScope.kind === 'player')}
          >
            Player characters ({playerCount})
          </button>
          {showTagChips &&
            [...groups.keys()].sort().map((tag) => {
              const on = effectiveScope.kind === 'tag' && effectiveScope.tag === tag
              return (
                <button key={tag} type="button" aria-pressed={on} onClick={() => setScope({ kind: 'tag', tag })} className={chipClass(on)}>
                  <span className="font-mono text-text-muted">/</span> {tag} ({groups.get(tag)!.length})
                </button>
              )
            })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        {visible.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            aria-label={c.playerOnly ? `${c.card.name} (you only)` : undefined}
            className="themed-shadow group rounded-2xl bg-bg-elevated p-3 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="portrait-frame mb-3 aspect-[3/4] w-full rounded-xl">
              {c.avatarDataUrl ? (
                <img src={c.avatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-bg-sunken text-2xl text-text-muted">
                  {c.card.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              {c.playerOnly && (
                <span aria-hidden className="absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-accent-text shadow-sm">
                  You only
                </span>
              )}
            </div>
            <div className="truncate px-1 text-sm font-medium text-text">{c.card.name}</div>
            <div className="truncate text-xs text-text-muted">{c.card.creator || ' '}</div>
          </button>
        ))}
        {visible.length === 0 && (
          <EmptyState
            className="col-span-full"
            action={
              effectiveScope.kind === 'player' && !search ? (
                <Button variant="primary" onClick={createPlayer}>
                  New player character
                </Button>
              ) : (
                <Button variant="primary" onClick={createCharacter}>
                  New character
                </Button>
              )
            }
          >
            {effectiveScope.kind === 'player' && !search
              ? 'No player characters yet. Make a card that only you play, or play any other character when you start a story.'
              : search || effectiveScope.kind !== 'all'
                ? 'No characters match that filter.'
                : 'No characters yet. Create one from scratch, start from a bundled template, generate one with AI, or import a SillyTavern card.'}
          </EmptyState>
        )}
      </div>
    </ViewShell>
  )
}
