import type { Character } from '@/lib/characters/cardSpec'
import type { MomentInput, StoryMoment } from '@/lib/story/moments'
import type {
  Chat,
  CharacterMemory,
  SceneRecap,
  Story,
  ChatFact,
  CustomInstructTemplate,
  Objective,
  Persona,
  RelationshipEvent,
  SamplerPreset,
  StoredMessage,
  Theme,
  WorldCard,
  WorldInfoBook,
} from '@/lib/types'
import type { AssistantThread } from '@/lib/assistant/thread'
import type { LocalSource } from '@/lib/assistant/localSources'
import { toastError, toastSuccess, useToastStore } from '@/lib/store/useToastStore'
import { useAuthStore } from '@/lib/accounts/useAuthStore'

// The local API server runs on the same machine, but a wedged Node process (or a very large
// backup/restore payload) shouldn't be able to hang a call forever with no way out.
const DEFAULT_TIMEOUT_MS = 15000

/**
 * Every read/write in this file funnels through `request()`, and most callers either don't catch
 * its rejection at all (`useApiQuery`'s background refetches swallow it into `undefined`, silently)
 * or catch-and-toast only for the one action the user just took — so a dead local server used to be
 * completely invisible: generation still works (it talks to the model backend directly, never
 * through this server), but every save quietly failed with nothing on screen to say so. One sticky
 * toast per outage (not one per failed call — an outage spans many) closes that gap for every call
 * site at once, and clears itself the moment a request gets through again.
 */
let unreachableToastId: string | null = null

function reportUnreachable(): void {
  if (unreachableToastId) return
  unreachableToastId = toastError(
    "Can't reach your local server. Nothing is being saved right now. Check that your dev server " +
      '(`npm run dev`) is still running, then try again.',
  )
}

function reportReachable(): void {
  if (!unreachableToastId) return
  useToastStore.getState().dismiss(unreachableToastId)
  unreachableToastId = null
  toastSuccess('Reconnected. Your local server is back.')
}

/** Test-only: `unreachableToastId` is deliberately module-level (one toast per outage, tracked
 *  across every call site), which otherwise leaks across test cases sharing this module instance. */
export function __resetUnreachableStateForTests(): void {
  unreachableToastId = null
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { notFoundIsUndefined?: boolean; timeoutMs?: number },
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`${method} ${path} timed out after ${timeoutMs / 1000}s`)
    }
    // Anything else `fetch` throws on a same-origin relative URL — connection refused, DNS,
    // the dev server not running at all — means the server genuinely can't be reached, not just
    // that it answered with an error (that's the `!res.ok` branch below, left alone).
    reportUnreachable()
    throw e
  } finally {
    clearTimeout(timeout)
  }
  reportReachable()
  // The session is gone (expired, signed out elsewhere, or never existed): show the sign-in screen.
  if (res.status === 401 && !path.startsWith('/auth/')) useAuthStore.getState().signedOut()
  if (res.status === 404 && opts?.notFoundIsUndefined) return undefined as T
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${method} ${path} failed (${res.status})${text ? `: ${text}` : ''}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// A local-server equivalent of Dexie's live-query: every mutating call below announces
// which resource changed, and useApiQuery (src/lib/hooks/useApiQuery.ts) re-fetches
// wherever that resource is being read — including the very same hook that just wrote it.
type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

export function invalidate(resource: string): void {
  listeners.get(resource)?.forEach((fn) => fn())
}

export function subscribe(resource: string, fn: Listener): () => void {
  if (!listeners.has(resource)) listeners.set(resource, new Set())
  listeners.get(resource)!.add(fn)
  return () => listeners.get(resource)?.delete(fn)
}

function makeResource<T>(resource: string, path: string) {
  return {
    list(): Promise<T[]> {
      return request<T[]>('GET', path)
    },
    get(id: string): Promise<T | undefined> {
      return request<T | undefined>('GET', `${path}/${id}`, undefined, { notFoundIsUndefined: true })
    },
    async create(input: unknown): Promise<T> {
      const result = await request<T>('POST', path, input)
      invalidate(resource)
      return result
    },
    async update(id: string, patch: unknown): Promise<T> {
      const result = await request<T>('PUT', `${path}/${id}`, patch)
      invalidate(resource)
      return result
    },
    async remove(id: string): Promise<void> {
      await request<void>('DELETE', `${path}/${id}`)
      invalidate(resource)
    },
  }
}

export const charactersApi = {
  ...makeResource<Character>('characters', '/characters'),
  roster(worldId: string): Promise<{ id: string; name: string; occupation?: string; gmEligible?: boolean }[]> {
    return request('GET', `/characters/roster?worldId=${encodeURIComponent(worldId)}`)
  },
  // Cascades server-side (deletes the character's chats, messages, and objectives too).
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/characters/${id}`)
    invalidate('characters')
    invalidate('chats')
    invalidate('messages')
    invalidate('objectives')
  },
}
export const personasApi = makeResource<Persona>('personas', '/personas')
/** Plain assistant conversations (`lib/assistant/`) — no character, no relationship track. */
export const assistantThreadsApi = makeResource<AssistantThread>('assistant-threads', '/assistant-threads')
export const assistantLibraryApi = {
  /** Never throws: a failed search just means the reply goes out without saved sources. */
  search(query: string): Promise<LocalSource[]> {
    return request<LocalSource[]>('GET', `/assistant-library/search?q=${encodeURIComponent(query)}`).catch(() => [])
  },
}
export const chatsApi = {
  ...makeResource<Chat>('chats', '/chats'),
  /** The server draws and records both dice before the GM sees the result. */
  async roll(id: string, body: { messageId: string; moveId: string; modifier: number; action: string; text: string; target?: number; rollMode?: 'normal' | 'advantage' | 'disadvantage'; pendingGmMessageId?: string }): Promise<StoredMessage> {
    const result = await request<StoredMessage>('POST', `/chats/${id}/roll`, body)
    invalidate('messages')
    return result
  },
  // Soft delete — the chat moves to the trash (`trash`/`restore`/`purge` below) rather than being
  // destroyed immediately. Nothing about it is actually touched, so this is always reversible
  // until it's purged.
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/chats/${id}`)
    invalidate('chats')
  },
  /** Chats currently in the trash, most recently deleted first. */
  async trash(): Promise<Chat[]> {
    return request<Chat[]>('GET', '/chats/trash')
  },
  /** Moves a trashed chat back into the normal chat list. */
  async restore(id: string): Promise<Chat> {
    const result = await request<Chat>('POST', `/chats/${id}/restore`)
    invalidate('chats')
    return result
  },
  /** Permanently deletes a chat and everything that cascades from it (messages, objectives, relationship history) — cannot be undone. */
  async purge(id: string): Promise<void> {
    await request<void>('DELETE', `/chats/${id}/purge`)
    invalidate('chats')
    invalidate('messages')
    invalidate('objectives')
  },
  // Creates a new chat that branches off this one, carrying its relationship/gift/gallery
  // state and a copy of the transcript up to (and including) `messageId` — or the whole
  // transcript, if omitted.
  async fork(id: string, messageId?: string): Promise<Chat> {
    const result = await request<Chat>('POST', `/chats/${id}/fork`, { messageId })
    invalidate('chats')
    invalidate('messages')
    invalidate('objectives')
    return result
  },
  /**
   * Names this scene's chapter, sets its goal, or corrects an ended chapter's recap (`chapterId` for
   * another chapter of the story). Makes a lone chat scene 1 of a story when it needs one. Returns the story.
   */
  async updateChapter(id: string, edit: { chapterId?: string; title?: string; goal?: string; recap?: { text: string; openThreads?: string[] } }): Promise<Story> {
    const result = await request<Story>('PUT', `/chats/${id}/chapter`, edit)
    invalidate('chats')
    invalidate('stories')
    return result
  },
  /** Makes another character this scene's lead (`story/lead.ts`); both relationship tracks move with it. */
  async changeLead(id: string, characterId: string, keepPrevious: boolean): Promise<Chat> {
    const result = await request<Chat>('PUT', `/chats/${id}/lead`, { characterId, keepPrevious })
    invalidate('chats')
    invalidate('messages')
    return result
  },
  /**
   * Deletes one scene of a story into the trash; the story closes the gap around it. Restoring it
   * from the trash puts it back in its place. Returns the scene to open instead.
   */
  async removeScene(id: string): Promise<{ openSceneId: string }> {
    const result = await request<{ openSceneId: string }>('DELETE', `/chats/${id}/scene`)
    invalidate('chats')
    invalidate('stories')
    return result
  },
  /** Ends this scene with its recap and opens the next one (`server/stories.ts`). Returns the new scene. */
  async nextScene(id: string, body: NextSceneBody): Promise<Chat> {
    const result = await request<Chat>('POST', `/chats/${id}/next-scene`, body)
    invalidate('chats')
    invalidate('stories')
    invalidate('objectives')
    return result
  },
}

export interface NextSceneBody {
  recap: Pick<SceneRecap, 'text' | 'presentIds' | 'openThreads' | 'location'>
  /** Confirmed consequences from this scene's GM turns, kept in force afterwards. */
  consequences?: string[]
  /** Set events carried out so far, so later scenes do not repeat them. */
  setEventsDone?: string[]
  /** Ends the chapter too: its recap, and the next chapter's name and goal. */
  chapter?: { recap: { text: string; openThreads?: string[] }; next?: { title?: string; goal?: string } }
  next?: {
    title?: string
    location?: string | null
    atmosphere?: string | null
    presentIds?: string[]
    /** The next scene's lead, when it changes. */
    leadId?: string
    storylineId?: string
    newStorylineName?: string
  }
}

/** Stories made of scenes. A story's scenes are chats carrying its id. */
/** Story moments: pictures of things that happened in a story (`story/moments.ts`). */
export const momentsApi = {
  list(): Promise<StoryMoment[]> {
    return request('GET', '/moments')
  },
  async create(chatId: string, body: MomentInput): Promise<StoryMoment> {
    const created = await request<StoryMoment>('POST', `/chats/${chatId}/moments`, body)
    invalidate('moments')
    return created
  },
  async update(id: string, patch: { caption: string }): Promise<StoryMoment> {
    const updated = await request<StoryMoment>('PATCH', `/moments/${id}`, patch)
    invalidate('moments')
    return updated
  },
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/moments/${id}`)
    invalidate('moments')
  },
}

export const storiesApi = {
  list(): Promise<Story[]> {
    return request('GET', '/stories')
  },
  get(id: string): Promise<Story | undefined> {
    return request<Story>('GET', `/stories/${id}`).catch(() => undefined)
  },
  /** The story's scenes, oldest first. */
  scenes(id: string): Promise<Chat[]> {
    return request('GET', `/stories/${id}/scenes`)
  },
  async update(id: string, patch: Partial<Pick<Story, 'title' | 'storylines'>> & { continuesFrom?: Story['continuesFrom'] | null }): Promise<Story> {
    const result = await request<Story>('PUT', `/stories/${id}`, patch)
    invalidate('stories')
    return result
  },
}
export const worldInfoBooksApi = makeResource<WorldInfoBook>('world-info-books', '/world-info-books')
export const presetsApi = makeResource<SamplerPreset>('presets', '/presets')
export const themesApi = makeResource<Theme>('themes', '/themes')
export const instructTemplatesApi = makeResource<CustomInstructTemplate>('instruct-templates', '/instruct-templates')
/** Voice reference clips for LuxTTS (`server/luxtts.ts`), kept in the data folder. */
export interface VoiceSample { file: string; label: string; bytes: number; addedAt: number }
export const voiceSamplesApi = {
  list(): Promise<VoiceSample[]> {
    return request('GET', '/voice-samples')
  },
  async add(label: string, dataUrl: string): Promise<VoiceSample> {
    const created = await request<VoiceSample>('POST', '/voice-samples', { label, dataUrl })
    invalidate('voice-samples')
    return created
  },
  luxttsStatus(): Promise<{ configured: boolean; reachable: boolean; detail: string; defaultReference?: string | null }> {
    return request('GET', '/tts/luxtts/status')
  },
}

/** `.vrm` files dropped into `data/avatars/vrm-library/`, selectable for any character's VN model. */
export const vrmLibraryApi = {
  list(): Promise<{ name: string; url: string; bytes: number }[]> {
    return request('GET', '/vrm-library')
  },
}

export const worldsApi = {
  ...makeResource<WorldCard>('worlds', '/worlds'),
  // Un-assigns any characters living here server-side, rather than deleting them.
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/worlds/${id}`)
    invalidate('worlds')
    invalidate('characters')
  },
}

/** What a pack of a world would hold, sized, before anything is packed (`POST /api/packs/export-preview`). */
export interface PackExportPreview {
  included: import('@/lib/packs/contract').PackSummaryLine[]
  excluded: string[]
  droppedReferences: string[]
  characters: { id: string; name: string; playerOnly: boolean; included: boolean }[]
  media: { path: string; kind: import('@/lib/packs/fields').MediaKind; label: string; bytes: number }[]
  mediaBytes: number
  missingMedia: number
}

export interface PackExportRequest {
  worldId: string
  selection: import('@/lib/packs/contract').PackSelection
  metadata: Omit<import('@/lib/packs/contract').PackMetadata, 'credits'> & { credits?: (import('@/lib/packs/contract').PackCredit & { path?: string })[] }
}

// Unpacking and checking a large pack can take minutes; the upload itself has no timeout at all.
const PACK_TIMEOUT_MS = 10 * 60 * 1000

/** World packs (`server/packs.ts`). Uploads stream each file from disk; nothing is read into the page first. */
export const packsApi = {
  exportPreview(body: PackExportRequest): Promise<PackExportPreview> {
    return request<PackExportPreview>('POST', '/packs/export-preview', body, { timeoutMs: 60000 })
  },
  /** A short-lived download link for this user; opening it streams the zip to disk. */
  startExport(body: PackExportRequest): Promise<{ url: string; expiresAt: number }> {
    return request('POST', '/packs/export', body)
  },
  /** Uploads a pack's zip, or an unzipped pack folder's files, into a fresh import. Returns its id. */
  async upload(files: { path: string; file: Blob }[], onProgress?: (done: number, total: number) => void): Promise<string> {
    const { uploadId } = await request<{ uploadId: string }>('POST', '/packs/uploads')
    for (const [i, entry] of files.entries()) {
      const res = await fetch(`/api/packs/uploads/${uploadId}/file?path=${encodeURIComponent(entry.path)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: entry.file,
      })
      if (!res.ok) {
        const error = await res.json().catch(() => undefined) as { error?: string } | undefined
        await request('DELETE', `/packs/uploads/${uploadId}`).catch(() => {})
        throw new Error(error?.error ?? `Uploading ${entry.path} failed (${res.status}).`)
      }
      onProgress?.(i + 1, files.length)
    }
    return uploadId
  },
  preview(uploadId: string): Promise<import('@/lib/packs/contract').PackPreview> {
    return request('POST', '/packs/preview', { uploadId }, { timeoutMs: PACK_TIMEOUT_MS })
  },
  async apply(body: import('@/lib/packs/contract').PackApplyRequest): Promise<import('@/lib/packs/contract').PackApplyResult> {
    const result = await request<import('@/lib/packs/contract').PackApplyResult>('POST', '/packs/apply', body, { timeoutMs: PACK_TIMEOUT_MS })
    invalidate('worlds')
    invalidate('characters')
    invalidate('world-info-books')
    return result
  },
  cancel(uploadId: string): Promise<void> {
    return request('DELETE', `/packs/uploads/${uploadId}`)
  },
}

export const messagesApi = {
  ...makeResource<StoredMessage>('messages', '/messages'),
  listByChat(chatId: string): Promise<StoredMessage[]> {
    return request<StoredMessage[]>('GET', `/chats/${chatId}/messages`)
  },
  /** Substring search across every chat's messages, newest first, capped server-side to 50 hits. */
  search(query: string): Promise<StoredMessage[]> {
    return request<StoredMessage[]>('GET', `/messages/search?q=${encodeURIComponent(query)}`)
  },
}

// A full backup/restore inlines every avatar/sprite/background as base64 — on a
// data-heavy install this can legitimately take much longer than the default timeout.
const BACKUP_TIMEOUT_MS = 120000

export const backupApi = {
  fetchBackup(): Promise<unknown> {
    return request<unknown>('GET', '/backup', undefined, { timeoutMs: BACKUP_TIMEOUT_MS })
  },
  async restore(backup: unknown): Promise<void> {
    await request<void>('POST', '/restore', backup, { timeoutMs: BACKUP_TIMEOUT_MS })
    for (const resource of [
      'characters',
      'personas',
      'chats',
      'messages',
      'world-info-books',
      'presets',
      'themes',
      'worlds',
      'objectives',
      'relationship-events',
      'chat-facts',
      'memories',
    ]) {
      invalidate(resource)
    }
  },
}

export const objectivesApi = {
  ...makeResource<Objective>('objectives', '/objectives'),
  getActive(chatId: string): Promise<Objective | undefined> {
    return request<Objective | null>('GET', `/objectives/active?chatId=${encodeURIComponent(chatId)}`).then(
      (o) => o ?? undefined,
    )
  },
  listByChat(chatId: string, status?: string): Promise<Objective[]> {
    const statusQuery = status ? `&status=${encodeURIComponent(status)}` : ''
    return request<Objective[]>('GET', `/objectives?chatId=${encodeURIComponent(chatId)}${statusQuery}`)
  },
}

export const relationshipEventsApi = {
  ...makeResource<RelationshipEvent>('relationship-events', '/relationship-events'),
  listByChat(chatId: string): Promise<RelationshipEvent[]> {
    return request<RelationshipEvent[]>('GET', `/chats/${chatId}/relationship-events`)
  },
}

export const chatFactsApi = {
  ...makeResource<ChatFact>('chat-facts', '/chat-facts'),
  listByChat(chatId: string): Promise<ChatFact[]> {
    return request<ChatFact[]>('GET', `/chats/${chatId}/chat-facts`)
  },
}

/** A character's memory as `memoriesApi.forCharacter` returns it: labelled with where it happened. */
export type CharacterMemoryListing = CharacterMemory & { sceneLabel?: string; storyTitle?: string }
/** What `create` takes: the server assigns `id`, fills `storyId`/`worldId` from the chat, and computes `knownBy`. */
export type NewCharacterMemory = Omit<CharacterMemory, 'id' | 'knownBy' | 'createdAt' | 'active'> & { createdAt?: number }
export type CharacterMemoryPatch = Partial<
  Pick<CharacterMemory, 'text' | 'kind' | 'about' | 'importance' | 'feelings' | 'unresolved' | 'pinned' | 'active' | 'retiredReason' | 'consolidatedFor' | 'certainty' | 'canonFactId'>
> & {
  /** `null` clears the player's ruling. */
  verdict?: CharacterMemory['verdict'] | null
}

/** Per-character memory (`server/memories.ts`). Every write invalidates 'memories'. */
export const memoriesApi = {
  /** Memories visible from a scene (it and every scene before it), oldest first; inactive and consolidated included. */
  forChat(chatId: string, characterId?: string): Promise<CharacterMemory[]> {
    const query = characterId ? `?characterId=${encodeURIComponent(characterId)}` : ''
    return request<CharacterMemory[]>('GET', `/chats/${chatId}/memories${query}`)
  },
  /** Everything a character knows, across every chat, newest first. */
  forCharacter(characterId: string): Promise<CharacterMemoryListing[]> {
    return request<CharacterMemoryListing[]>('GET', `/characters/${characterId}/memories`)
  },
  async create(memory: NewCharacterMemory): Promise<CharacterMemory> {
    const result = await request<CharacterMemory>('POST', '/memories', memory)
    invalidate('memories')
    return result
  },
  async createMany(memories: NewCharacterMemory[]): Promise<CharacterMemory[]> {
    if (!memories.length) return []
    const result = await request<CharacterMemory[]>('POST', '/memories/batch', { memories })
    invalidate('memories')
    return result
  },
  async update(id: string, patch: CharacterMemoryPatch): Promise<CharacterMemory> {
    const result = await request<CharacterMemory>('PUT', `/memories/${id}`, patch)
    invalidate('memories')
    return result
  },
  /** Records that `to` were told it (by `by`, in `messageId`). Ids that already know it are skipped. */
  async share(id: string, body: { to: string[]; by?: string; messageId?: string; chatId?: string }): Promise<CharacterMemory> {
    const result = await request<CharacterMemory>('POST', `/memories/${id}/share`, body)
    invalidate('memories')
    return result
  },
  /** Marks `ids` as folded into `characterId`'s journal. Memories that character does not know are skipped; returns the rows changed. */
  async consolidate(characterId: string, ids: string[]): Promise<CharacterMemory[]> {
    if (!ids.length) return []
    const result = await request<CharacterMemory[]>('POST', '/memories/consolidate', { characterId, ids })
    invalidate('memories')
    return result
  },
  async remove(id: string): Promise<void> {
    await request<void>('DELETE', `/memories/${id}`)
    invalidate('memories')
  },
  /** The scribe has read the chat's messages up to `upTo` (a message createdAt). */
  /** `from`: the watermark as read before the scribe ran, so an edit that moved it back meanwhile is not overwritten. */
  async setWatermark(chatId: string, upTo: number, from?: number | null): Promise<Chat> {
    const result = await request<Chat>('POST', `/chats/${chatId}/memory-watermark`, { upTo, from })
    invalidate('chats')
    return result
  },
}
