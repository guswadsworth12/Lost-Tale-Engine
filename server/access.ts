import express, { type Request, type Response } from 'express'
import { currentUser } from './auth.ts'
import {
  assistantThreadStore, characterStore, chatFactStore, chatStore, instructTemplateStore, memoryLinkStore, memoryStore, messageStore, objectiveStore, personaStore,
  presetStore, storyStore, themeStore, userStore, worldInfoBookStore, worldStore,
} from './db.ts'
import { characterVisibleTo, chatVisibleTo, ownsRow, visibleTo, type Lookups } from './ownership.ts'

/**
 * Applies `ownership.ts` to the API. Guards here run before any route: whatever names something
 * that isn't this user's and isn't shared (a world, character, world-info book, story, scene, or a
 * personal record) answers 404, exactly as if it didn't exist. List routes filter with `canSee*` /
 * `owns` themselves. Files under /avatars follow what they belong to (`avatarGuard`).
 */

type Row = Record<string, unknown>

/** The account that owns the install: the first owner. Rows made before accounts owned things are theirs. */
export function siteOwnerId(): string | undefined {
  return userStore.list({ orderBy: 'createdAt' }).find((u) => u.role === 'owner')?.id as string | undefined
}

export const lookups: Lookups = {
  character: (id) => characterStore.get(id),
  world: (id) => worldStore.get(id),
  siteOwnerId,
}

export function userOf(req: Request) {
  return currentUser(req)
}

export function canSee(req: Request, row: Row | undefined): boolean {
  return visibleTo(row, userOf(req), siteOwnerId())
}

/** Whether a personal record (a story, a Writer's Room thread, a preset) is this user's. Personal records are never shared. */
export function owns(req: Request, row: Row | undefined): boolean {
  return ownsRow(row, userOf(req), siteOwnerId())
}

export function canSeeCharacter(req: Request, character: Row | undefined): boolean {
  return characterVisibleTo(character, userOf(req), lookups)
}

export function canSeeChat(req: Request, chat: Row | undefined): boolean {
  return chatVisibleTo(chat, userOf(req), lookups)
}

/** The ids in `ids` that name a character or world this user can't see. Missing ids aren't theirs to hide. */
export function hiddenIds(req: Request, ids: unknown[], get: (id: string) => Row | undefined): string[] {
  const see = get === lookups.character ? canSeeCharacter : canSee
  return ids.filter((id): id is string => typeof id === 'string' && !!id && !!get(id) && !see(req, get(id)))
}

const notFound = (res: Response) => res.status(404).json({ error: 'Not found' })

/** 404s when `find(id)` exists and `allowed` says no. Anything else (an unknown id, a sub-path word like `trash`) passes on. */
function guard(find: (id: string) => Row | undefined, allowed: (req: Request, row: Row) => boolean): express.RequestHandler {
  return (req, res, next) => {
    const id = req.params.id
    const row = typeof id === 'string' ? find(id) : undefined
    if (row && !allowed(req, row)) return notFound(res)
    next()
  }
}

const chatOf = (row: Row) => (typeof row.chatId === 'string' ? chatStore.get(row.chatId) : undefined)
const chatAllowed = (req: Request, row: Row) => canSeeChat(req, row)
const viaChat = (req: Request, row: Row) => !chatOf(row) || canSeeChat(req, chatOf(row))

export const accessGuards = express.Router()

accessGuards.use('/api/worlds/:id', guard((id) => worldStore.get(id), canSee))
accessGuards.use('/api/characters/:id', guard((id) => characterStore.get(id), canSeeCharacter))
accessGuards.use('/api/world-info-books/:id', guard((id) => worldInfoBookStore.get(id), canSee))
accessGuards.use('/api/chats/:id', guard((id) => chatStore.get(id), chatAllowed))
accessGuards.use('/api/messages/:id', guard((id) => messageStore.get(id), viaChat))
accessGuards.use('/api/memory-links/:id', guard((id) => memoryLinkStore.get(id), (req, link) => {
  const memory = memoryStore.get(String(link.memoryId))
  return !!memory && viaChat(req, memory)
}))
accessGuards.use('/api/memories/:id', guard((id) => memoryStore.get(id), viaChat))
accessGuards.use('/api/objectives/:id', guard((id) => objectiveStore.get(id), viaChat))
accessGuards.use('/api/chat-facts/:id', guard((id) => chatFactStore.get(id), viaChat))
accessGuards.use('/api/stories/:id', guard((id) => storyStore.get(id), (req, story) => storyVisible(req, story)))
accessGuards.use('/api/assistant-threads/:id', guard((id) => assistantThreadStore.get(id), owns))
accessGuards.use('/api/presets/:id', guard((id) => presetStore.get(id), owns))
accessGuards.use('/api/themes/:id', guard((id) => themeStore.get(id), owns))
accessGuards.use('/api/instruct-templates/:id', guard((id) => instructTemplateStore.get(id), owns))
accessGuards.use('/api/personas/:id', guard((id) => personaStore.get(id), canSee))

// Routes that name their chat in the query or body (`?chatId=`, `{ chatId }`) rather than the path.
accessGuards.use('/api', (req, res, next) => {
  const ids = [req.query?.chatId, (req.body as Row | undefined)?.chatId].filter((id): id is string => typeof id === 'string' && !!id)
  for (const id of ids) {
    const chat = chatStore.get(id)
    if (chat && !canSeeChat(req, chat)) return notFound(res)
  }
  next()
})

/** A story is its starter's, like its scenes. One made before stories had owners goes by its scenes. */
export function storyVisible(req: Request, story: Row): boolean {
  if (typeof story.ownerUserId === 'string' && story.ownerUserId) return owns(req, story)
  const scenes = chatStore.list({ orderBy: 'createdAt' }).filter((c) => c.storyId === story.id)
  return scenes.length ? scenes.every((c) => canSeeChat(req, c)) : owns(req, story)
}

/**
 * Files under /avatars belong to a character, world, persona, or story by their folder, and are served only
 * to someone who can see it. Shared libraries (`vrm-library`, `vrma-library`) and pack media
 * (content-hashed, referenced by rows the reader can already see) are everyone's.
 */
export function avatarGuard(req: Request, res: Response, next: express.NextFunction) {
  let path = req.path
  try { path = decodeURIComponent(req.path) } catch { return notFound(res) }
  const [kind, id = ''] = path.split('/').filter(Boolean)
  const allowed = (() => {
    switch (kind) {
      case 'characters': return canSeeCharacter(req, characterStore.get(id))
      case 'worlds': return canSee(req, worldStore.get(id))
      case 'personas': return canSee(req, personaStore.get(id))
      // A moment's folder is its story's id, or a lone scene's own.
      case 'stories': {
        const story = storyStore.get(id)
        return story ? storyVisible(req, story) : canSeeChat(req, chatStore.get(id))
      }
      case 'vrm-library': case 'vrma-library': case 'pack-media': return true
      default: return false
    }
  })()
  if (!allowed) return notFound(res)
  next()
}
