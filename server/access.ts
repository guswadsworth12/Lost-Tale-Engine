import express, { type Request, type Response } from 'express'
import { currentUser } from './auth.ts'
import { characterStore, chatFactStore, chatStore, memoryStore, messageStore, objectiveStore, storyStore, worldInfoBookStore, worldStore } from './db.ts'
import { characterVisibleTo, chatVisibleTo, visibleTo, type Lookups } from './ownership.ts'

/**
 * Applies `ownership.ts` to the API. Guards here run before any route: whatever names a private
 * world, character, or world-info book, or a chat that uses one, answers 404 to everyone but its
 * owner, exactly as if it didn't exist. List routes filter with `canSee*` themselves.
 */

type Row = Record<string, unknown>

export const lookups: Lookups = {
  character: (id) => characterStore.get(id),
  world: (id) => worldStore.get(id),
}

export function userOf(req: Request) {
  return currentUser(req)
}

export function canSee(req: Request, row: Row | undefined): boolean {
  return visibleTo(row, userOf(req))
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
accessGuards.use('/api/memories/:id', guard((id) => memoryStore.get(id), viaChat))
accessGuards.use('/api/objectives/:id', guard((id) => objectiveStore.get(id), viaChat))
accessGuards.use('/api/chat-facts/:id', guard((id) => chatFactStore.get(id), viaChat))
accessGuards.use('/api/stories/:id', guard((id) => storyStore.get(id), (req, story) => storyVisible(req, story)))

// Routes that name their chat in the query or body (`?chatId=`, `{ chatId }`) rather than the path.
accessGuards.use('/api', (req, res, next) => {
  const ids = [req.query?.chatId, (req.body as Row | undefined)?.chatId].filter((id): id is string => typeof id === 'string' && !!id)
  for (const id of ids) {
    const chat = chatStore.get(id)
    if (chat && !canSeeChat(req, chat)) return notFound(res)
  }
  next()
})

/** A story is visible when all its scenes are; its scenes are chats, so they follow their cast. */
export function storyVisible(req: Request, story: Row): boolean {
  const world = typeof story.worldId === 'string' && story.worldId ? worldStore.get(story.worldId) : undefined
  if (world && !canSee(req, world)) return false
  return chatStore.list({ orderBy: 'createdAt' }).filter((c) => c.storyId === story.id).every((c) => canSeeChat(req, c))
}
