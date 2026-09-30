import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react'
import { charactersApi, chatsApi, worldsApi } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useAudioDuckStore } from '@/lib/store/useAudioDuckStore'
import { BGM_DEFAULT_KEY, BGM_KEYS, SCENE_MOODS } from '@/lib/vn/moods'
import type { GalleryEntry } from '@/lib/characters/cardSpec'
import type { WorldCard } from '@/lib/types'
import { ViewShell } from '@/components/ui/ViewShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { StoryMoments } from './StoryMoments'
import { ALL_PLAYER_CHARACTERS, cgProgress, lockedCgLabel, playerCharacterOptions, viewableCgs, type CharacterCgProgress } from './cgProgress'

const readable = (id: string) => id.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

interface GalleryViewProps {
  /** Opens a character's editor, optionally on a tab (e.g. 'relationships', where its CG gallery is edited). Links are hidden when unset. */
  onOpenCharacter?: (characterId: string, tab?: string) => void
  /** Opens a world's editor, optionally on a tab (e.g. 'presentation', where its music is edited). Links are hidden when unset. */
  onOpenWorld?: (worldId: string, tab?: string) => void
  /** Opens a story moment's scene at the message it pictures. */
  onOpenMoment?: (chatId: string, messageId?: string) => void
}

/**
 * Media: story media that's worth browsing on its own — relationship CGs with their unlock
 * progress, and each world's soundtrack to listen to outside a scene. Portraits, sprites, and
 * backgrounds deliberately aren't repeated here; they live (and are edited) in Cast and Worlds.
 */
export function GalleryView({ onOpenCharacter, onOpenWorld, onOpenMoment }: GalleryViewProps = {}) {
  const [tab, setTab] = useState<'moments' | 'cgs'>('moments')
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const chats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const activePlayerCharacterId = useSettingsStore((s) => s.activePlayerCharacterId)
  const [playerFilter, setPlayerFilter] = useState<string>(activePlayerCharacterId ?? ALL_PLAYER_CHARACTERS)
  const [viewing, setViewing] = useState<{ characterId: string; entryId: string } | null>(null)

  const playerCards = useMemo(() => playerCharacterOptions(characters, chats), [characters, chats])
  // A remembered card that's since been deleted (or never played) falls back to every story.
  const effectiveFilter =
    playerFilter === ALL_PLAYER_CHARACTERS || characters.length === 0 || playerCards.some((c) => c.id === playerFilter)
      ? playerFilter
      : ALL_PLAYER_CHARACTERS
  const progress = useMemo(() => cgProgress(characters, chats, effectiveFilter), [characters, chats, effectiveFilter])
  const percent = progress.total ? Math.round((progress.unlocked / progress.total) * 100) : 0

  return (
    <ViewShell
      title="Media"
      width="wide"
      description="Pictures of what happened in your stories, story CGs you've unlocked and how to earn the rest, plus each world's soundtrack to listen to outside a scene."
    >
      <div className="space-y-10">
        <div className="flex gap-2" role="tablist" aria-label="Gallery">
          <Button role="tab" aria-selected={tab === 'moments'} variant={tab === 'moments' ? 'primary' : 'secondary'} onClick={() => setTab('moments')}>Story moments</Button>
          <Button role="tab" aria-selected={tab === 'cgs'} variant={tab === 'cgs' ? 'primary' : 'secondary'} onClick={() => setTab('cgs')}>Character CGs</Button>
        </div>
        {tab === 'moments' && <StoryMoments onOpenMoment={onOpenMoment} />}
        {tab === 'cgs' && <section aria-labelledby="media-cgs">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h3 id="media-cgs" className="font-display text-lg text-text">Story CGs</h3>
              <p className="mt-1 text-xs text-text-muted">Relationship scenes and endings. They unlock as a story's warmth rises and it reaches key beats.</p>
            </div>
            {progress.total > 0 && (
              <label className="flex items-center gap-2 text-xs text-text-muted">
                Progress for
                <select
                  value={effectiveFilter}
                  onChange={(event) => setPlayerFilter(event.target.value)}
                  className="max-w-[12rem] rounded-lg bg-bg-sunken px-2.5 py-1.5 text-xs text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
                >
                  <option value={ALL_PLAYER_CHARACTERS}>All player characters</option>
                  {playerCards.map((card) => <option key={card.id} value={card.id}>{card.card.name}</option>)}
                </select>
              </label>
            )}
          </div>

          {progress.total > 0 ? (
            <>
              <div className="mt-4 rounded-xl border border-border bg-bg-elevated p-4">
                <p className="text-sm text-text">
                  <span className="font-semibold">{progress.unlocked}</span> of {progress.total} CGs unlocked
                  <span className="text-text-muted"> · {progress.characters.length} {progress.characters.length === 1 ? 'character' : 'characters'}</span>
                </p>
                {/* Decorative — the sentence above already says the same thing for screen readers. */}
                <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-sunken">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
                </div>
              </div>
              {progress.characters.map((row) => (
                <CharacterCgs
                  key={row.characterId}
                  row={row}
                  onOpen={(entryId) => setViewing({ characterId: row.characterId, entryId })}
                  onEdit={onOpenCharacter && (() => onOpenCharacter(row.characterId, 'relationships'))}
                />
              ))}
            </>
          ) : (
            <EmptyState className="mt-4">
              No story CGs yet. Add them in a character's editor under Relationships → CG gallery (available when the
              character's world has dating on), then unlock them by playing their stories.
            </EmptyState>
          )}
        </section>}

        <Soundtrack worlds={worlds} onEdit={onOpenWorld && ((worldId) => onOpenWorld(worldId, 'presentation'))} />

        <p className="border-t border-border pt-5 text-xs text-text-muted">
          Portraits, sprites, and expressions live in each character's Cast → Presentation editor; scene backgrounds live in each
          world's Locations.
        </p>
      </div>

      {viewing && (
        <CgViewer
          row={progress.characters.find((row) => row.characterId === viewing.characterId)}
          entryId={viewing.entryId}
          onNavigate={(entryId) => setViewing({ characterId: viewing.characterId, entryId })}
          onClose={() => setViewing(null)}
        />
      )}
    </ViewShell>
  )
}

function CharacterCgs({ row, onOpen, onEdit }: { row: CharacterCgProgress; onOpen: (entryId: string) => void; onEdit?: () => void }) {
  const headingId = `media-cgs-${row.characterId}`
  return (
    <section aria-labelledby={headingId} className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 id={headingId} className="text-sm font-semibold text-text">{row.name}</h4>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span>{row.unlocked}/{row.total} unlocked · warmth {row.affection}</span>
          {onEdit && (
            <button type="button" onClick={onEdit} className="rounded text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
              Edit CGs
            </button>
          )}
        </div>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {row.entries.map(({ entry, unlocked }) => (
          <li key={entry.id} className="min-w-0 overflow-hidden rounded-xl border border-border bg-bg-elevated">
            {unlocked && entry.imageUrl ? (
              <button
                type="button"
                onClick={() => onOpen(entry.id)}
                aria-label={`View ${entry.title} larger`}
                className="block w-full transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <img src={entry.imageUrl} alt="" className="aspect-[4/3] w-full object-cover" />
              </button>
            ) : unlocked ? (
              <div className="flex aspect-[4/3] items-center justify-center bg-bg-sunken text-xs text-text-muted">No art yet</div>
            ) : (
              <div className="relative">
                {/* Obscured on purpose — a locked CG only hints at its shape and colors. */}
                {entry.imageUrl ? (
                  <img src={entry.imageUrl} alt="" aria-hidden="true" className="aspect-[4/3] w-full object-cover blur-md grayscale" />
                ) : (
                  <div className="aspect-[4/3] bg-bg-sunken" />
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/45 p-2">
                  <span className="flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1 text-center text-xs text-white">
                    <Lock size={12} strokeWidth={2} aria-hidden="true" className="shrink-0" />
                    <span><span className="sr-only">Locked. </span>{lockedCgLabel(entry)}</span>
                  </span>
                </div>
              </div>
            )}
            <div className="p-3">
              <div className="break-words text-xs font-medium text-text">{entry.title}{entry.isEnding ? ' · Ending' : ''}</div>
              {entry.unlockHint && <div className="mt-1 break-words text-[11px] text-text-muted">{entry.unlockHint}</div>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** The larger view of one unlocked CG, stepping through that character's other unlocked CGs. */
function CgViewer({
  row,
  entryId,
  onNavigate,
  onClose,
}: {
  row?: CharacterCgProgress
  entryId: string
  onNavigate: (entryId: string) => void
  onClose: () => void
}) {
  const entries = row ? viewableCgs(row) : []
  const index = entries.findIndex((entry) => entry.id === entryId)
  const entry: GalleryEntry | undefined = entries[index]
  const [artIndex, setArtIndex] = useState(0)
  useEffect(() => setArtIndex(0), [entryId])

  const step = (delta: number) => {
    if (entries.length < 2) return
    onNavigate(entries[(index + delta + entries.length) % entries.length].id)
  }
  // Arrow keys page through, alongside the Modal's own Escape-to-close.
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') stepRef.current(-1)
      if (event.key === 'ArrowRight') stepRef.current(1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // The player-character filter changed underneath and this CG is no longer unlocked.
  useEffect(() => {
    if (!entry) onClose()
  }, [entry, onClose])
  if (!row || !entry) return null

  const art = [entry.imageUrl, ...(entry.variants ?? []).filter(Boolean)]
  const src = art[artIndex] ?? entry.imageUrl

  return (
    <Modal
      onClose={onClose}
      title={entry.title}
      size="3xl"
      scrollable
      description={`${row.name}${entry.isEnding ? ' · Ending' : ''} · ${index + 1} of ${entries.length} unlocked`}
      headerExtra={entries.length > 1 && (
        <>
          <button type="button" onClick={() => step(-1)} aria-label="Previous CG" className="rounded-lg p-1.5 text-text-muted hover:bg-bg-sunken hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
            <ChevronLeft size={16} strokeWidth={2} />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next CG" className="rounded-lg p-1.5 text-text-muted hover:bg-bg-sunken hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
            <ChevronRight size={16} strokeWidth={2} />
          </button>
        </>
      )}
    >
      <div className="min-h-0 overflow-y-auto">
        <img src={src} alt={art.length > 1 ? `${entry.title}, art ${artIndex + 1} of ${art.length}` : entry.title} className="max-h-[65vh] w-full rounded-xl bg-bg-sunken object-contain" />
        {art.length > 1 && (
          <div role="group" aria-label="Alternate art" className="mt-3 flex flex-wrap gap-2">
            {art.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setArtIndex(i)}
                aria-pressed={i === artIndex}
                className={`rounded-lg px-2.5 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${i === artIndex ? 'bg-accent/15 text-text' : 'bg-bg-sunken text-text-muted hover:text-text'}`}
              >
                Art {i + 1}
              </button>
            ))}
          </div>
        )}
        {entry.unlockHint && <p className="mt-3 text-xs text-text-muted">{entry.unlockHint}</p>}
      </div>
    </Modal>
  )
}

/**
 * A listen-only music room: each world's mood tracks, playable outside a scene (the world editor
 * only uploads them). One track at a time, and the app-level scene music ducks while one plays.
 */
function Soundtrack({ worlds, onEdit }: { worlds: WorldCard[]; onEdit?: (worldId: string) => void }) {
  const listRef = useRef<HTMLDivElement>(null)
  const setDucked = useAudioDuckStore((s) => s.setDucked)
  useEffect(() => () => setDucked(false), [setDucked])

  const albums = worlds
    .map((world) => {
      const music = world.music ?? {}
      const keys = [...BGM_KEYS, ...Object.keys(music).filter((key) => !BGM_KEYS.includes(key))]
      return { world, tracks: keys.filter((key) => Boolean(music[key])).map((key) => ({ key, url: music[key] })) }
    })
    .filter((album) => album.tracks.length > 0)

  const playing = () => Array.from(listRef.current?.querySelectorAll('audio') ?? []).some((audio) => !audio.paused)
  const onPlay = (event: SyntheticEvent<HTMLAudioElement>) => {
    listRef.current?.querySelectorAll('audio').forEach((audio) => audio !== event.currentTarget && audio.pause())
    setDucked(true)
  }
  const onStop = () => setDucked(playing())

  return (
    <section aria-labelledby="media-soundtrack">
      <h3 id="media-soundtrack" className="font-display text-lg text-text">Soundtrack</h3>
      <p className="mt-1 text-xs text-text-muted">Listen to each world's scene music. In a story, the track follows the scene's mood.</p>
      {albums.length ? (
        <div ref={listRef}>
          {albums.map(({ world, tracks }) => {
            const headingId = `media-soundtrack-${world.id}`
            return (
              <section key={world.id} aria-labelledby={headingId} className="mt-5">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h4 id={headingId} className="text-sm font-semibold text-text">{world.name}</h4>
                  {onEdit && (
                    <button type="button" onClick={() => onEdit(world.id)} className="rounded text-xs text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
                      Edit tracks
                    </button>
                  )}
                </div>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {tracks.map(({ key, url }) => {
                    const mood = SCENE_MOODS.find((item) => item.id === key)
                    const label = key === BGM_DEFAULT_KEY ? 'Main theme' : mood?.label ?? readable(key)
                    return (
                      <li key={key} className="min-w-0 rounded-xl border border-border bg-bg-elevated p-3">
                        <div className="text-xs font-medium text-text">{label}</div>
                        <div className="mb-2 truncate text-[11px] text-text-muted">{key === BGM_DEFAULT_KEY ? "The world's default track" : mood?.hint}</div>
                        <audio
                          controls
                          preload="none"
                          src={url}
                          onPlay={onPlay}
                          onPause={onStop}
                          onEnded={onStop}
                          className="w-full"
                          aria-label={`${world.name}: ${label}`}
                        />
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs text-text-muted">
          No soundtracks yet. Add mood tracks in a Visual Novel world's editor, under Presentation → Background music.
        </p>
      )}
    </section>
  )
}
