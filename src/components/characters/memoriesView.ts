import type { CharacterMemoryListing } from '@/lib/api/client'
import type { Chat, MemoryKind } from '@/lib/types'

/** Short labels for a memory's kind, as shown on its chip. */
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  event: 'Event',
  learned: 'Learned',
  promise: 'Promise',
  secret: 'Secret',
  impression: 'Impression',
  journal: 'Journal',
}

export const UNSORTED_STORY_TITLE = 'Unsorted'

export interface MemorySceneGroup {
  chatId: string
  label: string
  memories: CharacterMemoryListing[]
}

export interface MemoryStoryGroup {
  /** The story id, or `''` for memories from scenes that are not part of a titled story. */
  key: string
  title: string
  /** This story's journals, newest first. */
  journals: CharacterMemoryListing[]
  /** Its scenes, newest first, each with its memories newest first. Journals are not in here. */
  scenes: MemorySceneGroup[]
}

const newestFirst = (a: CharacterMemoryListing, b: CharacterMemoryListing) => b.createdAt - a.createdAt

/**
 * Groups a character's memories by story, then by scene, everything newest first (a group sorts by
 * its newest memory). Inactive memories are left out unless `showRetired`.
 */
export function groupMemories(rows: CharacterMemoryListing[], opts: { showRetired?: boolean } = {}): MemoryStoryGroup[] {
  const visible = rows.filter((m) => opts.showRetired || m.active !== false).sort(newestFirst)
  const stories = new Map<string, MemoryStoryGroup>()
  for (const m of visible) {
    const title = m.storyTitle?.trim()
    const key = m.storyId && title ? m.storyId : ''
    let story = stories.get(key)
    if (!story) {
      story = { key, title: title && key ? title : UNSORTED_STORY_TITLE, journals: [], scenes: [] }
      stories.set(key, story)
    }
    if (m.kind === 'journal') {
      story.journals.push(m)
      continue
    }
    let scene = story.scenes.find((s) => s.chatId === m.chatId)
    if (!scene) {
      scene = { chatId: m.chatId, label: m.sceneLabel?.trim() || 'Untitled scene', memories: [] }
      story.scenes.push(scene)
    }
    scene.memories.push(m)
  }
  // Insertion order already follows `visible`, which is newest first, so the maps keep that order.
  return [...stories.values()]
}

/** How many of these are retired (hidden until "Show retired"). */
export function countRetired(rows: CharacterMemoryListing[]): number {
  return rows.filter((m) => m.active === false).length
}

/** Everyone else who knows it, as names. Ids with no name become one "Someone", listed last. */
export function otherKnowers(knownBy: string[], selfId: string, nameOf: (id: string) => string | undefined): string[] {
  const names: string[] = []
  let someone = false
  for (const id of knownBy) {
    if (id === selfId) continue
    const name = nameOf(id)?.trim()
    if (!name) someone = true
    else if (!names.includes(name)) names.push(name)
  }
  return someone ? [...names, 'Someone'] : names
}

/** The scenes this character is in (as the lead, a participant, or the played card), newest first. */
export function chatsWithCharacter(chats: Chat[], characterId: string): Chat[] {
  return chats
    .filter((c) => !c.deletedAt && (c.characterId === characterId || c.playerCharacterId === characterId || (c.participants ?? []).includes(characterId)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** How a scene reads in the "Add memory" picker: its chat title, plus the scene number inside a story. */
export function chatOptionLabel(chat: Pick<Chat, 'title' | 'storyId' | 'sceneNumber' | 'sceneTitle'>): string {
  const title = chat.title?.trim() || 'Untitled chat'
  if (!chat.storyId) return title
  const scene = `Scene ${chat.sceneNumber ?? 1}`
  const sceneTitle = chat.sceneTitle?.trim()
  return sceneTitle && sceneTitle !== title ? `${title} · ${scene} · ${sceneTitle}` : `${title} · ${scene}`
}

/**
 * Who this memory could be told to: characters in the same world (the memory's, else this
 * character's; no world matches other world-less characters) who do not know it yet.
 */
export function tellCandidates<C extends { id: string; worldId?: string }>(
  characters: C[],
  memory: { knownBy: string[]; worldId?: string },
  self: { id: string; worldId?: string },
): C[] {
  const worldId = memory.worldId || self.worldId || undefined
  return characters.filter((c) => c.id !== self.id && (c.worldId || undefined) === worldId && !memory.knownBy.includes(c.id))
}
