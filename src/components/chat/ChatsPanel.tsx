import { useRef, useState } from 'react'
import { Copy, GitFork, MoreHorizontal, Pencil, Pin, PinOff, Plus, Star, Trash2 } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, messagesApi, objectivesApi, storiesApi, worldsApi } from '@/lib/api/client'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { createChat } from '@/lib/chat/createChat'
import { sceneSettingFrom } from '@/lib/chat/sceneSetting'
import { backgroundLabel } from '@/lib/vn/backgrounds'
import { PHASES } from '@/lib/world/calendar'
import { modulesForWorld } from '@/lib/world/worldTemplates'
import { groupStories, type StoryGroup } from '@/lib/story/library'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, WorldCard } from '@/lib/types'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { NewChatDialog } from './NewChatDialog'
import { TrashPanel } from './TrashPanel'
import { Button } from '@/components/ui/Button'

function StoryPreview({ chat, world }: { chat: Chat; world?: WorldCard }) {
  const messages = useApiQuery('messages', () => messagesApi.listByChat(chat.id), [chat.id]) ?? []
  const objective = useApiQuery('objectives', () => objectivesApi.getActive(chat.id), [chat.id])
  const location = sceneSettingFrom(messages, chat.scene, (id) => backgroundLabel(id, world)).location
  const lastLine = [...messages].reverse().find((m) => (m.role === 'char' || m.role === 'user') && m.text.trim())?.text
  const usesClock = !!world && modulesForWorld(world).worldSimulation
  const phase = usesClock ? chat.scene?.timePhase ?? PHASES[world!.currentPhaseIndex ?? 0] : undefined
  const day = usesClock ? `Day ${(world!.currentDay ?? 0) + 1}` : undefined
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">
        {location && <span>{location}</span>}
        {(day || phase) && <span>{[day, phase].filter(Boolean).join(' · ')}</span>}
      </div>
      <p className="mt-3 line-clamp-2 min-h-8 text-sm leading-relaxed text-text-muted">
        {objective ? `Goal: ${objective.title}` : lastLine || 'Your story is ready to begin.'}
      </p>
    </>
  )
}

const sceneBadge = (group: StoryGroup) => `scene ${group.current.sceneNumber ?? 1} of ${group.sceneCount}`

export function ChatsPanel({
  activeChatId,
  onSelect,
}: {
  activeChatId: string | null
  onSelect: (id: string | null) => void
}) {
  const allChats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const stories = useApiQuery('stories', () => storiesApi.list(), []) ?? []
  // One card per story, not per scene. A story counts as pinned when any of its scenes is.
  const isPinned = (group: StoryGroup) => group.scenes.some((scene) => scene.pinned)
  const groups = groupStories(allChats, stories).sort((a, b) => Number(isPinned(b)) - Number(isPinned(a)))
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const [showNew, setShowNew] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const trashCount = useApiQuery('chats', () => chatsApi.trash(), [])?.length ?? 0
  const client = useChatBackendClient()
  const [menuForId, setMenuForId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const charFor = (id: string) => characters.find((c) => c.id === id)

  const startRename = (group: StoryGroup) => {
    setMenuForId(null)
    setRenamingId(group.storyId)
    setRenameDraft(group.title)
    requestAnimationFrame(() => renameInputRef.current?.select())
  }

  // A scene of a story renames the story (its card shows the story's title); a lone chat renames itself.
  const commitRename = async (group: StoryGroup) => {
    const next = renameDraft.trim()
    setRenamingId(null)
    if (!next || next === group.title) return
    try {
      if (group.current.storyId) await storiesApi.update(group.current.storyId, { title: next })
      else await chatsApi.update(group.current.id, { title: next })
    } catch (e) { toastError(errorMessage(e)) }
  }

  // Pins the current scene; unpinning clears every pinned scene, so the story really drops down.
  const togglePin = async (group: StoryGroup) => {
    setMenuForId(null)
    try {
      if (isPinned(group)) for (const scene of group.scenes.filter((s) => s.pinned)) await chatsApi.update(scene.id, { pinned: false })
      else await chatsApi.update(group.current.id, { pinned: true })
    } catch (e) { toastError(errorMessage(e)) }
  }

  const duplicateChat = async (chat: Chat, busyKey: string) => {
    setMenuForId(null)
    setBusyId(busyKey)
    try { onSelect((await chatsApi.fork(chat.id)).id) }
    catch (e) { toastError(errorMessage(e)) }
    finally { setBusyId(null) }
  }

  const quickNewSameCharacter = async (chat: Chat, busyKey: string) => {
    setMenuForId(null)
    const character = charFor(chat.characterId)
    if (!character) return
    setBusyId(busyKey)
    try {
      const world = worlds.find((w) => w.id === character.worldId)
      const player = chat.playerCharacterId ? charFor(chat.playerCharacterId) : undefined
      const fresh = await createChat({ character, world, player, participantIds: chat.participants, mode: chat.mode, client })
      onSelect(fresh.id)
    } catch (e) { toastError(errorMessage(e)) }
    finally { setBusyId(null) }
  }

  // Deletes the whole story: every scene goes to the trash.
  const deleteStory = async (group: StoryGroup) => {
    setMenuForId(null)
    const many = group.sceneCount > 1
    const ok = await confirmDialog({
      title: `Delete "${group.title}"?`,
      body: many
        ? `Moves the whole story to the trash: all ${group.sceneCount} scenes. Each is recoverable there for 30 days, or you can delete them for good right away.`
        : 'Moves it to the trash. Recoverable there for 30 days, or you can delete it for good right away.',
      confirmLabel: many ? `Delete all ${group.sceneCount} scenes` : 'Delete story',
      tone: 'danger',
    })
    if (!ok) return
    setBusyId(group.storyId)
    try {
      for (const scene of group.scenes) await chatsApi.remove(scene.id)
      if (group.scenes.some((scene) => scene.id === activeChatId)) onSelect(null)
    } catch (e) { toastError(errorMessage(e)) }
    finally { setBusyId(null) }
  }

  return (
    <div className="min-w-0 w-full flex-1 overflow-x-hidden overflow-y-auto p-4 sm:p-8">
      <div className="mx-auto min-w-0 max-w-5xl">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-widest text-accent">Play</div>
            <h1 className="mt-1 font-display text-2xl text-text">Stories</h1>
            <p className="mt-1 text-sm text-text-muted">Pick up a story or begin a new one.</p>
          </div>
          <Button variant="primary" onClick={() => setShowNew(true)} className="flex items-center gap-1.5">
            <Plus size={15} /> Start a story
          </Button>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => {
            const chat = group.current
            const key = group.storyId
            const character = charFor(chat.characterId)
            const cast = [character, ...(chat.participants ?? []).map(charFor)].filter((c): c is Character => Boolean(c))
            const player = chat.playerCharacterId ? charFor(chat.playerCharacterId) : undefined
            const world = worlds.find((w) => w.id === character?.worldId)
            const isRenaming = renamingId === key
            const isMenuOpen = menuForId === key
            const isBusy = busyId === key
            const pinned = isPinned(group)
            return (
              <div key={key} className="relative min-w-0 rounded-2xl border border-border bg-bg-elevated p-4 themed-shadow">
                <div role="button" tabIndex={isBusy ? -1 : 0} aria-disabled={isBusy} aria-label={`Open ${group.title}${group.sceneCount > 1 ? `, ${sceneBadge(group)}` : ''}`}
                  onClick={() => !isRenaming && !isBusy && onSelect(chat.id)}
                  onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (!isBusy) onSelect(chat.id) } }}
                  className={`w-full cursor-pointer text-left ${isBusy ? 'opacity-50' : ''}`}>
                  <div className="flex items-start gap-3 pr-7">
                    {character?.avatarDataUrl ? <img src={character.avatarDataUrl} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />
                      : <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-sm text-text-muted">{(character?.card.name ?? '?').slice(0, 2).toUpperCase()}</div>}
                    <div className="min-w-0 flex-1">
                      {isRenaming ? <input ref={renameInputRef} value={renameDraft} onChange={(e) => setRenameDraft(e.target.value)}
                        onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') commitRename(group); if (e.key === 'Escape') setRenamingId(null) }}
                        onBlur={() => commitRename(group)} className="w-full rounded-lg bg-bg-sunken px-2 py-1 text-sm text-text outline-none ring-1 ring-accent/40" />
                        : <div className="flex items-center gap-1.5 font-medium text-text">{pinned && <Star size={13} fill="currentColor" className="shrink-0 text-accent" />}{chat.parentChatId && <GitFork size={13} className="shrink-0 text-text-muted" />}<span className="truncate">{group.title}</span></div>}
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-text-muted">
                        <span className="truncate">{world?.name ?? 'Freeform world'}</span>
                        {group.sceneCount > 1 && <span className="shrink-0 rounded-full bg-bg-sunken px-2 py-0.5 text-[11px]" title={`${group.sceneCount} scenes`}>Scene {chat.sceneNumber ?? 1}</span>}
                        {group.storylineCount > 1 && <span className="shrink-0 rounded-full bg-bg-sunken px-2 py-0.5 text-[11px]">{group.storylineCount} storylines</span>}
                      </div>
                    </div>
                  </div>
                  <StoryPreview chat={chat} world={world} />
                  <div className="mt-4 flex items-center justify-between gap-2 text-xs text-text-muted">
                    <span className="truncate">{cast.length ? cast.map((c) => c.card.name).join(', ') : 'Cast unavailable'}{player && ` · You: ${player.card.name}`}</span>
                    <span className="shrink-0">{isBusy ? 'Working…' : `Played ${new Date(group.updatedAt).toLocaleDateString()}`}</span>
                  </div>
                </div>
                {!isRenaming && <button onClick={() => setMenuForId(isMenuOpen ? null : key)} title="Story actions" aria-label="Story actions"
                  className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-bg-sunken hover:text-text"><MoreHorizontal size={17} /></button>}
                {isMenuOpen && <>
                  <div className="fixed inset-0 z-40" onClick={() => setMenuForId(null)} />
                  <div className="absolute right-3 top-11 z-50 w-56 overflow-hidden rounded-xl border border-border bg-bg-elevated py-1 themed-shadow">
                    <button onClick={() => togglePin(group)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-bg-sunken">{pinned ? <PinOff size={14} /> : <Pin size={14} />}{pinned ? 'Unpin' : 'Pin to top'}</button>
                    <button onClick={() => startRename(group)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-bg-sunken"><Pencil size={14} />Rename</button>
                    <button onClick={() => duplicateChat(chat, key)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-bg-sunken"><Copy size={14} />{group.sceneCount > 1 ? 'Duplicate current scene' : 'Duplicate full story'}</button>
                    {character && <button onClick={() => quickNewSameCharacter(chat, key)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text hover:bg-bg-sunken"><Plus size={14} />New with same cast and player</button>}
                    <div className="my-1 h-px bg-border" />
                    <button onClick={() => deleteStory(group)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-danger hover:bg-danger/10"><Trash2 size={14} />Delete</button>
                  </div>
                </>}
              </div>
            )
          })}
        </div>
        <button onClick={() => setShowTrash(true)} className="mt-6 flex items-center gap-2 text-xs text-text-muted hover:text-text"><Trash2 size={14} />Trash{trashCount > 0 && ` · ${trashCount}`}</button>
      </div>
      {showNew && <NewChatDialog onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); onSelect(id) }} />}
      {showTrash && <TrashPanel onClose={() => setShowTrash(false)} onRestored={(id) => { setShowTrash(false); onSelect(id) }} />}
    </div>
  )
}
