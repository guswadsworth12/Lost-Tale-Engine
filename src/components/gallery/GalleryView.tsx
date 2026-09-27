import { useMemo, useState } from 'react'
import { charactersApi, chatsApi, personasApi, worldsApi } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { backgroundLabel } from '@/lib/vn/backgrounds'
import { BASE_OUTFIT_ID, parseSpriteKey } from '@/lib/vn/outfits'
import { BGM_DEFAULT_KEY, SCENE_MOODS } from '@/lib/vn/moods'
import { ViewShell } from '@/components/ui/ViewShell'
import { EmptyState } from '@/components/ui/EmptyState'

const readable = (id: string) => id.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())

export function GalleryView() {
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const chats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const personas = useApiQuery('personas', () => personasApi.list(), []) ?? []
  const activePersonaId = useSettingsStore((s) => s.activePersonaId)
  const [personaFilter, setPersonaFilter] = useState<string>(activePersonaId ?? 'all')

  const chatsForFilter = useMemo(
    () => personaFilter === 'all' ? chats : chats.filter((chat) => chat.personaId === personaFilter),
    [chats, personaFilter],
  )
  const unlockedByCharacter = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const chat of chatsForFilter) {
      if (!map.has(chat.characterId)) map.set(chat.characterId, new Set())
      for (const id of chat.unlockedGalleryIds ?? []) map.get(chat.characterId)!.add(id)
    }
    return map
  }, [chatsForFilter])
  const affectionByCharacter = useMemo(() => {
    const map = new Map<string, number>()
    for (const chat of chatsForFilter) {
      map.set(chat.characterId, Math.max(map.get(chat.characterId) ?? 0, chat.affection ?? 0))
    }
    return map
  }, [chatsForFilter])

  const hasCharacterArt = characters.some((character) =>
    character.avatarDataUrl || Object.values(character.sprites ?? {}).some(Boolean) ||
    Object.values(character.spriteVariants ?? {}).some((variants) => variants.some(Boolean)),
  )
  const hasSceneArt = worlds.some((world) =>
    Object.values(world.backgrounds ?? {}).some(Boolean) || Object.values(world.backgroundsNight ?? {}).some(Boolean),
  )
  const hasCgs = characters.some((character) => character.gallery?.length)
  const hasMusic = worlds.some((world) => Object.values(world.music ?? {}).some(Boolean))
  const hasVoice = characters.some((character) => character.voice?.provider || character.voice?.voiceId)
  const hasVrm = characters.some((character) => character.vrm?.url)

  return (
    <ViewShell
      title="Media"
      width="wide"
      description="The art, sound, and models already attached to your cast and worlds. Edit an asset from its character or world editor."
      actions={
        <label className="flex items-center gap-2 text-xs text-text-muted">
          CG progress for
          <select
            value={personaFilter}
            onChange={(event) => setPersonaFilter(event.target.value)}
            className="rounded-lg bg-bg-sunken px-2.5 py-1.5 text-xs text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
          >
            <option value="all">All player characters</option>
            {personas.map((persona) => <option key={persona.id} value={persona.id}>{persona.name}</option>)}
          </select>
        </label>
      }
    >
      <div className="space-y-10">
        <section aria-labelledby="media-character-art">
          <h2 id="media-character-art" className="font-display text-lg text-text">Character art & expressions</h2>
          <p className="mt-1 text-xs text-text-muted">Portraits, outfit sprites, and expression variants from Cast.</p>
          {hasCharacterArt ? characters.map((character) => {
            const sprites = Object.entries(character.sprites ?? {}).filter(([, url]) => Boolean(url))
            const variants = Object.entries(character.spriteVariants ?? {}).flatMap(([key, urls]) =>
              urls.filter(Boolean).map((url, index) => ({ key, url, index })),
            )
            if (!character.avatarDataUrl && !sprites.length && !variants.length) return null
            const labelFor = (key: string) => {
              const { outfitId, expressionId } = parseSpriteKey(key)
              const outfit = outfitId === BASE_OUTFIT_ID ? '' : `${character.outfits?.find((item) => item.id === outfitId)?.label ?? readable(outfitId)} · `
              return `${outfit}${character.customExpressions?.find((item) => item.id === expressionId)?.label ?? readable(expressionId)}`
            }
            return (
              <div key={character.id} className="mt-5">
                <h3 className="mb-3 text-sm font-semibold text-text">{character.card.name}</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {character.avatarDataUrl && <ImageCard src={character.avatarDataUrl} label="Portrait" alt={`${character.card.name} portrait`} />}
                  {sprites.map(([key, url]) => <ImageCard key={key} src={url} label={labelFor(key)} alt={`${character.card.name}: ${labelFor(key)}`} />)}
                  {variants.map(({ key, url, index }) => <ImageCard key={`${key}-${index}`} src={url} label={`${labelFor(key)} · variant ${index + 1}`} alt={`${character.card.name}: ${labelFor(key)} variant ${index + 1}`} />)}
                </div>
              </div>
            )
          }) : <EmptyState>No character art yet. Add a portrait or expression sprites in Cast.</EmptyState>}
        </section>

        <section aria-labelledby="media-scenes">
          <h2 id="media-scenes" className="font-display text-lg text-text">Scene backgrounds</h2>
          <p className="mt-1 text-xs text-text-muted">Day and night art stored on each world.</p>
          {hasSceneArt ? worlds.map((world) => {
            const day = Object.entries(world.backgrounds ?? {}).filter(([, url]) => Boolean(url))
            const night = Object.entries(world.backgroundsNight ?? {}).filter(([, url]) => Boolean(url))
            if (!day.length && !night.length) return null
            return (
              <div key={world.id} className="mt-5">
                <h3 className="mb-3 text-sm font-semibold text-text">{world.name}</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {day.map(([key, url]) => <ImageCard key={`day-${key}`} src={url} label={backgroundLabel(key, world)} alt={`${world.name}: ${backgroundLabel(key, world)} day background`} />)}
                  {night.map(([key, url]) => <ImageCard key={`night-${key}`} src={url} label={`${backgroundLabel(key, world)} · night`} alt={`${world.name}: ${backgroundLabel(key, world)} night background`} />)}
                </div>
              </div>
            )
          }) : <EmptyState>No scene art yet. Add backgrounds in a world's editor.</EmptyState>}
        </section>

        <section aria-labelledby="media-cgs">
          <h2 id="media-cgs" className="font-display text-lg text-text">Story CGs</h2>
          <p className="mt-1 text-xs text-text-muted">Relationship scene art and endings. Unlocks follow the selected player character's stories.</p>
          {hasCgs ? characters.map((character) => {
            const gallery = character.gallery ?? []
            if (!gallery.length) return null
            const unlocked = unlockedByCharacter.get(character.id) ?? new Set<string>()
            const affection = affectionByCharacter.get(character.id) ?? 0
            const unlockedCount = gallery.filter((entry) => unlocked.has(entry.id) || (!entry.isEnding && affection >= entry.unlockAffection)).length
            return (
              <div key={character.id} className="mt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-text">{character.card.name}</h3>
                  <span className="text-xs text-text-muted">{unlockedCount}/{gallery.length} unlocked</span>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {gallery.map((entry) => {
                    const isUnlocked = unlocked.has(entry.id) || (!entry.isEnding && affection >= entry.unlockAffection)
                    return (
                      <div key={entry.id} className="overflow-hidden rounded-xl border border-border bg-bg-elevated">
                        <div className="relative">
                          {entry.imageUrl ? <img src={entry.imageUrl} alt={isUnlocked ? entry.title : ''} className={`aspect-[4/3] w-full object-cover ${isUnlocked ? '' : 'blur-sm grayscale'}`} /> :
                            <div className="flex aspect-[4/3] items-center justify-center text-xs text-text-muted">No art</div>}
                          {!isUnlocked && <div className="absolute inset-0 flex items-center justify-center bg-black/40"><span className="rounded-lg bg-black/70 px-2 py-1 text-xs text-white">{entry.isEnding ? 'Reach Sweethearts' : `Unlock at ${entry.unlockAffection}`}</span></div>}
                        </div>
                        <div className="p-3">
                          <div className="text-xs font-medium text-text">{entry.title}{entry.isEnding ? ' · Ending' : ''}</div>
                          {entry.unlockHint && <div className="mt-1 text-[11px] text-text-muted">{entry.unlockHint}</div>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          }) : <EmptyState>No story CGs yet. Add them in a character's editor.</EmptyState>}
        </section>

        <section aria-labelledby="media-music">
          <h2 id="media-music" className="font-display text-lg text-text">Music</h2>
          <p className="mt-1 text-xs text-text-muted">Background tracks attached to scene moods in Worlds.</p>
          {hasMusic ? worlds.map((world) => {
            const tracks = Object.entries(world.music ?? {}).filter(([, url]) => Boolean(url))
            if (!tracks.length) return null
            return <div key={world.id} className="mt-4"><h3 className="mb-2 text-sm font-semibold text-text">{world.name}</h3>
              <div className="grid gap-3 sm:grid-cols-2">{tracks.map(([key, url]) =>
                <div key={key} className="rounded-xl border border-border bg-bg-elevated p-3">
                  <div className="mb-2 text-xs font-medium text-text">{key === BGM_DEFAULT_KEY ? 'Default' : SCENE_MOODS.find((mood) => mood.id === key)?.label ?? readable(key)}</div>
                  <audio controls preload="none" src={url} className="w-full" aria-label={`${world.name} ${readable(key)} music`} />
                </div>,
              )}</div>
            </div>
          }) : <EmptyState>No music yet. Add mood tracks in a world's editor.</EmptyState>}
        </section>

        <section aria-labelledby="media-voice-models">
          <h2 id="media-voice-models" className="font-display text-lg text-text">Voices & 3D models</h2>
          <p className="mt-1 text-xs text-text-muted">Voice choices and VRM models configured for the cast.</p>
          {hasVoice || hasVrm ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {characters.filter((character) => character.voice?.provider || character.voice?.voiceId || character.vrm?.url).map((character) =>
              <div key={character.id} className="rounded-xl border border-border bg-bg-elevated p-3">
                <h3 className="text-sm font-semibold text-text">{character.card.name}</h3>
                {character.voice && (character.voice.provider || character.voice.voiceId) &&
                  <p className="mt-1 text-xs text-text-muted">Voice: {character.voice.provider ? readable(character.voice.provider) : 'Default provider'}{character.voice.voiceId && !character.voice.voiceId.startsWith('data:') ? ` · ${character.voice.voiceId}` : ''}</p>}
                {character.vrm?.url && <p className="mt-1 text-xs text-text-muted">3D model: {character.vrm.label || 'VRM'}{character.vrm.enabled ? ' · enabled' : ' · disabled'}</p>}
              </div>,
            )}
          </div> : <EmptyState>No character voices or VRM models configured yet.</EmptyState>}
        </section>

        <p className="border-t border-border pt-5 text-xs text-text-muted">Standalone media uploads and a shared asset library are future features. Media here comes from your existing Cast and Worlds records.</p>
      </div>
    </ViewShell>
  )
}

function ImageCard({ src, label, alt }: { src: string; label: string; alt: string }) {
  return <figure className="overflow-hidden rounded-xl border border-border bg-bg-elevated">
    <img src={src} alt={alt} className="aspect-[4/3] w-full object-cover" />
    <figcaption className="p-3 text-xs font-medium text-text">{label}</figcaption>
  </figure>
}
