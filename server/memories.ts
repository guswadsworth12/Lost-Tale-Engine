import express from 'express'
import { characterStore, chatStore, db, memoryStore, messageStore, newId, storyStore } from './db.ts'
import { canSeeChat } from './access.ts'
import {
  consolidateFor,
  forkMemories,
  forkTellings,
  memoryAsSeenFrom,
  nextWatermark,
  normalizeMemoryInput,
  normalizeMemoryPatch,
  retractMessage,
  sceneChainIds,
  shareMemory,
  uniqueIds,
  type NewMemory,
} from './memoryPlan.ts'
import type { CharacterMemory } from '../src/lib/types.ts'

/**
 * Per-character memory. A memory lives in the scene (chat) it happened in and is visible from that
 * scene and every scene that follows on from it (`sceneChainIds`). The planning logic is in
 * `memoryPlan.ts`; this file is the routes plus the hooks `app.ts` calls when chats and messages
 * change underneath memories.
 */

type Row = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const asMemory = (r: Row) => r as unknown as CharacterMemory
const asRow = (m: object) => m as Row
/** Most memories one batch may create. */
const BATCH_MAX = 200

/** Every scene id visible from `chatId`, current first. */
function chainOf(chatId: string): string[] {
  return sceneChainIds(chatId, (id) => chatStore.get(id), (id) => storyStore.get(id))
}

function memoriesIn(chatIds: string[]): CharacterMemory[] {
  if (!chatIds.length) return []
  return memoryStore
    .list({ where: `chatId IN (${chatIds.map(() => '?').join(', ')})`, params: chatIds, orderBy: 'createdAt' })
    .map(asMemory)
}

/** Fills `storyId`/`worldId` from the chat (the world falling back to the lead character's). */
function withChatContext(m: NewMemory, chat: Row): NewMemory {
  const out = { ...m }
  if (!out.storyId && str(chat.storyId)) out.storyId = str(chat.storyId)
  if (!out.worldId) {
    const worldId = str(chat.worldId) || str(characterStore.get(str(chat.characterId))?.worldId)
    if (worldId) out.worldId = worldId
  }
  return out
}

// ---- Hooks for app.ts ----

/** Part of `purgeChat`: the chat's own memories go with it. */
export function purgeChatMemories(chatId: string): void {
  for (const m of memoryStore.list({ where: 'chatId = ?', params: [chatId] })) memoryStore.remove(m.id as string)
}

/**
 * A message is being deleted or rewritten: memories it produced go, tellings it recorded are undone.
 * Checks the whole visible chain, since a scene can tell someone a memory made in an earlier one.
 */
export function retractMessageMemories(chatId: string, messageId: string): void {
  if (!chatId || !messageId) return
  const plan = retractMessage(memoriesIn(chainOf(chatId)), messageId)
  for (const id of plan.remove) memoryStore.remove(id)
  for (const { id, patch } of plan.update) memoryStore.update(id, { ...patch, updatedAt: Date.now() })
}

/** Part of forking a chat: copies the memories that belong to the kept part of its transcript. */
export function forkChatMemories(
  sourceChatId: string,
  idMap: Map<string, string>,
  cutoffCreatedAt: number | undefined,
  newChatId: string,
): void {
  const source = memoriesIn([sourceChatId])
  for (const row of forkMemories(source, idMap, cutoffCreatedAt, newChatId, newId)) memoryStore.insert(asRow(row))
  // Earlier scenes' memories stay where they are; what was told of them in the kept part is told in the fork too.
  for (const { id, toldVia } of forkTellings(memoriesIn(chainOf(sourceChatId)), sourceChatId, idMap, newChatId)) {
    memoryStore.update(id, { toldVia, updatedAt: Date.now() })
  }
}

// ---- Routes ----

export const memoriesRouter = express.Router()

/** Memories visible from a scene, oldest first, inactive and consolidated ones included. `?characterId=` narrows to what that character knows. */
memoriesRouter.get('/chats/:id/memories', (req, res) => {
  if (!chatStore.get(req.params.id)) return res.status(404).json({ error: 'Not found' })
  const characterId = str(req.query.characterId)
  const chain = chainOf(req.params.id)
  const inChain = new Set(chain)
  const rows = memoriesIn(chain).map((m) => memoryAsSeenFrom(m, inChain))
  res.json(characterId ? rows.filter((m) => (m.knownBy ?? []).includes(characterId)) : rows)
})

/** Everything a character knows, across every chat, newest first, labelled with its scene and story. */
memoriesRouter.get('/characters/:id/memories', (req, res) => {
  const characterId = req.params.id
  const chats = new Map<string, Row | undefined>()
  const stories = new Map<string, Row | undefined>()
  const chatOf = (id: string) => {
    if (!chats.has(id)) chats.set(id, chatStore.get(id))
    return chats.get(id)
  }
  const storyOf = (id: string) => {
    if (!id) return undefined
    if (!stories.has(id)) stories.set(id, storyStore.get(id))
    return stories.get(id)
  }
  const rows = memoryStore
    .list({ orderBy: 'createdAt DESC' })
    .map(asMemory)
    .filter((m) => (m.knownBy ?? []).includes(characterId))
    // Memories from someone else's private story stay theirs, even for a character everyone shares.
    .filter((m) => !chatOf(m.chatId) || canSeeChat(req, chatOf(m.chatId)))
    .map((m) => {
      const chat = chatOf(m.chatId)
      // The scene's story as it is now: a lone chat joins a story when its first scene ends.
      const story = storyOf(str(chat?.storyId) || m.storyId || '')
      const sceneLabel = str(chat?.sceneTitle) || str(chat?.title)
      return {
        ...m,
        ...(sceneLabel ? { sceneLabel } : {}),
        ...(str(story?.title) ? { storyTitle: str(story?.title) } : {}),
      }
    })
  res.json(rows)
})

memoriesRouter.post('/memories', (req, res) => {
  const input = normalizeMemoryInput(req.body, Date.now())
  if ('error' in input) return res.status(400).json({ error: input.error })
  const chat = chatStore.get(input.chatId)
  if (!chat) return res.status(404).json({ error: `Chat ${input.chatId} not found` })
  const created = memoryStore.insert(asRow({ ...withChatContext(input, chat), id: newId() }))
  res.status(201).json(created)
})

/** `{ memories: [...] }`: all validated before any is written, then written together. */
memoriesRouter.post('/memories/batch', (req, res) => {
  const list = (req.body as Row | undefined)?.memories
  if (!Array.isArray(list)) return res.status(400).json({ error: 'Expected { memories: [...] }.' })
  if (list.length > BATCH_MAX) return res.status(400).json({ error: `At most ${BATCH_MAX} memories per batch.` })
  const now = Date.now()
  const chats = new Map<string, Row | undefined>()
  const ready: Row[] = []
  for (const [i, raw] of list.entries()) {
    const input = normalizeMemoryInput(raw, now)
    if ('error' in input) return res.status(400).json({ error: `memories[${i}]: ${input.error}` })
    if (!chats.has(input.chatId)) chats.set(input.chatId, chatStore.get(input.chatId))
    const chat = chats.get(input.chatId)
    if (!chat) return res.status(404).json({ error: `memories[${i}]: chat ${input.chatId} not found` })
    ready.push(asRow({ ...withChatContext(input, chat), id: newId() }))
  }
  db.exec('BEGIN')
  try {
    for (const row of ready) memoryStore.insert(row)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  res.status(201).json(ready)
})

memoriesRouter.put('/memories/:id', (req, res) => {
  const existing = memoryStore.get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const patch = normalizeMemoryPatch(req.body, asMemory(existing), Date.now())
  if ('error' in patch) return res.status(400).json({ error: patch.error })
  res.json(memoryStore.update(req.params.id, asRow(patch)))
})

/** `{ to: string[], by?, messageId? }`: someone was told. Ids that already know it are skipped. */
memoriesRouter.post('/memories/:id/share', (req, res) => {
  const existing = memoryStore.get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Not found' })
  const body = (req.body ?? {}) as Row
  if (!uniqueIds(body.to).length) return res.status(400).json({ error: 'Expected { to: [characterId, ...] }.' })
  const memory = asMemory(existing)
  // The scene the telling happened in: given, or the scene its message belongs to.
  const chatId = str(body.chatId) || str(str(body.messageId) ? messageStore.get(str(body.messageId))?.chatId : '')
  const shared = shareMemory(memory, { to: body.to, by: body.by, messageId: body.messageId, chatId }, Date.now())
  if (shared === memory) return res.json(existing)
  res.json(memoryStore.update(req.params.id, { toldVia: shared.toldVia, knownBy: shared.knownBy, updatedAt: shared.updatedAt }))
})

/** `{ characterId, ids }`: these memories are now in that character's journal. Memories the character does not know are skipped. Returns the rows changed. */
memoriesRouter.post('/memories/consolidate', (req, res) => {
  const body = (req.body ?? {}) as Row
  const characterId = str(body.characterId).trim()
  const ids = uniqueIds(body.ids)
  if (!characterId || !Array.isArray(body.ids)) return res.status(400).json({ error: 'Expected { characterId, ids: [...] }.' })
  const now = Date.now()
  const updated: Row[] = []
  db.exec('BEGIN')
  try {
    for (const id of ids) {
      const existing = memoryStore.get(id)
      const patch = existing ? consolidateFor(asMemory(existing), characterId, now) : null
      if (!patch) continue
      const row = memoryStore.update(id, asRow(patch))
      if (row) updated.push(row)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  res.json(updated)
})

/** The player's "forget": gone for good. */
memoriesRouter.delete('/memories/:id', (req, res) => {
  memoryStore.remove(req.params.id)
  res.status(204).end()
})

/** `{ upTo }`: the scribe has read this chat's messages up to `upTo` (a message createdAt). */
memoriesRouter.post('/chats/:id/memory-watermark', (req, res) => {
  const upTo = (req.body as Row | undefined)?.upTo
  const from = (req.body as Row | undefined)?.from as number | null | undefined
  if (typeof upTo !== 'number' || !Number.isFinite(upTo)) return res.status(400).json({ error: 'Expected { upTo: number }.' })
  const chat = chatStore.get(req.params.id)
  if (!chat) return res.status(404).json({ error: 'Not found' })
  const current = typeof chat.memoryScribedUpTo === 'number' ? chat.memoryScribedUpTo : undefined
  // Bookkeeping only: updatedAt is left alone so the chat list does not reorder.
  res.json(chatStore.update(req.params.id, { memoryScribedUpTo: nextWatermark(current, upTo, typeof from === 'number' || from === null ? from : undefined) }))
})
