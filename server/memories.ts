import { cleanConsolidations, cleanMemoryConsolidations, runsIn } from './consolidation.ts'
import express from 'express'
import { validRecallReasons } from './recallReasons.ts'
import { chainOf, memoriesIn, worldOf } from './memoryContext.ts'
export { chainOf, memoriesIn } from './memoryContext.ts'
import { LINK_WEIGHT } from '../src/lib/memory/linkWeight.ts'
import { withLinks, withLinksMany, validateLinks, saveLinks, removeMemoryLinks, reopenLinks, copyLinks } from './memoryLinks.ts'
import { retractIntroductions, forkIntroductions } from './introductions.ts'
import { replacementFor, type MemoryLinkInput } from '../src/lib/memory/links.ts'
import { characterStore, chatStore, db, memoryLinkStore, memoryRecallStore, memoryVectorStore, memoryStore, messageStore, newId, storyStore, worldStore } from './db.ts'
import { canSeeCharacter, canSeeChat } from './access.ts'
import {
  consolidateFor,
  forkMemories,
  forkTellings,
  memoryAsSeenFrom,
  nextWatermark,
  normalizeMemoryInput,
  normalizeMemoryPatch,
  retractMessage,
  shareMemory,
  uniqueIds,
  type NewMemory,
} from './memoryPlan.ts'
import { modulesForWorld } from '../src/lib/world/worldTemplates.ts'
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

/** Fills `storyId`/`worldId` from the chat (the world falling back to the lead character's). */
function withChatContext(m: NewMemory, chat: Row): NewMemory {
  const out = { ...m }
  if (!out.storyId && str(chat.storyId)) out.storyId = str(chat.storyId)
  if (!out.worldId) {
    const worldId = worldOf(chat)
    if (worldId) out.worldId = worldId
  }
  return out
}

function deepMemoryForChat(chat: Row): boolean {
  const worldId = worldOf(chat)
  return modulesForWorld(worldStore.get(worldId) as Parameters<typeof modulesForWorld>[0]).deepMemory
}

// ---- Hooks for app.ts ----

/** Part of `purgeChat`: the chat's own memories go with it. */
export function purgeChatMemories(chatId: string): void {
  cleanConsolidations(chatId)
  memoryRecallStore.purgeChat(chatId)
  for (const m of memoryStore.list({ where: 'chatId = ?', params: [chatId] })) {
    removeMemoryLinks(String(m.id))
    memoryVectorStore.remove(String(m.id))
    memoryRecallStore.removeMemory(String(m.id))
    memoryStore.remove(String(m.id))
  }
}

/**
 * A message is being deleted or rewritten: memories it produced go, tellings it recorded are undone.
 * Checks the whole visible chain, since a scene can tell someone a memory made in an earlier one.
 * Text edits keep recall events and retirements; deletion and rewind undo them and restart the retired batch.
 */
export function retractMessageMemories(chatId: string, messageId: string, textChange = false): void {
  if (!chatId || !messageId) return
  const memories = memoriesIn(chainOf(chatId))
  cleanConsolidations(chatId, messageId, memories)
  if (!textChange) memoryRecallStore.retract(messageId)
  retractIntroductions(chatId, messageId)
  if (!textChange) {
    reopenLinks(messageId)
    const starts = memories.filter((m) => m.retiredByMessageId === messageId && m.retiredBatchFrom !== undefined).map((m) => m.retiredBatchFrom! - 1)
    const chat = chatStore.get(chatId)
    if (starts.length && typeof chat?.memoryScribedUpTo === 'number' && chat.memoryScribedUpTo > Math.min(...starts)) {
      chatStore.update(chatId, { memoryScribedUpTo: Math.min(...starts) })
    }
  }
  const plan = retractMessage(memories, messageId, !textChange)
  for (const id of plan.remove) { removeMemoryLinks(id); memoryVectorStore.remove(id); memoryRecallStore.removeMemory(id); memoryStore.remove(id) }
  for (const { id, patch } of plan.update) memoryStore.update(id, { ...patch, updatedAt: Date.now() })
}

/** Part of forking a chat: copies the memories that belong to the kept part of its transcript. */
export function forkChatMemories(
  sourceChatId: string,
  idMap: Map<string, string>,
  cutoffCreatedAt: number | undefined,
  newChatId: string,
  fullFork = false,
): void {
  const source = memoriesIn([sourceChatId])
  const retainedMemoryIds = new Set(fullFork ? runsIn(sourceChatId).filter((r) => !r.undoneAt).flatMap((r) => [...r.summaryIds, ...r.originalIds]) : [])
  const sourceIds = new Set(source.map((m) => m.id))
  const memoryIds = new Map<string, string>()
  for (const row of forkMemories(source, idMap, cutoffCreatedAt, newChatId, (sourceId) => {
    const id = newId()
    if (sourceId) memoryIds.set(sourceId, id)
    return id
  }, retainedMemoryIds)) {
    memoryStore.insert(asRow(row))
  }
  if (runsIn(sourceChatId).length) {
    const runIds = new Map<string, string>()
    const copiedRuns = runsIn(sourceChatId).filter((run) => !run.undoneAt && run.summaryIds.every((id) => memoryIds.has(id))).map((run) => {
      const id = newId(); runIds.set(run.id, id)
      return { ...run, id, copiedFrom: run.copiedFrom ?? run.id, chatId: newChatId, summaryIds: run.summaryIds.map((id) => memoryIds.get(id)!), originalIds: run.originalIds.map((id) => memoryIds.get(id) ?? id) }
    })
    chatStore.update(newChatId, { consolidationRuns: copiedRuns, consolidationAttempts: [] })
    for (const memory of memoriesIn([newChatId])) {
      const scopes = memory.consolidationScopes?.flatMap((s) => s.chatId !== sourceChatId ? [s] : runIds.has(s.runId) ? [{ ...s, chatId: newChatId, runId: runIds.get(s.runId)! }] : [])
      memoryStore.update(memory.id, { consolidationScopes: scopes?.length ? scopes : undefined })
    }
    for (const run of copiedRuns) for (const id of run.originalIds) {
      const memory = memoryStore.get(id) as unknown as CharacterMemory | undefined
      if (!memory || memory.chatId === newChatId) continue
      memoryStore.update(id, { consolidationScopes: [...(memory.consolidationScopes ?? []), { characterId: run.characterId, chatId: newChatId, runId: run.id }] })
    }
  }
  copyLinks(memoryIds, idMap, sourceIds)
  forkIntroductions(sourceChatId, newChatId, idMap)
  for (const [sourceId, targetId] of memoryIds) memoryVectorStore.copy(sourceId, targetId)
  for (const event of memoryRecallStore.forChat(sourceChatId)) {
    if (!idMap.has(event.messageId) || (sourceIds.has(event.memoryId) && !memoryIds.has(event.memoryId))) continue
    memoryRecallStore.insert({ ...event, memoryId: memoryIds.get(event.memoryId) ?? event.memoryId,
      chatId: newChatId, messageId: idMap.get(event.messageId)! })
  }
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
  const character = characterId ? characterStore.get(characterId) : undefined
  if (character && !canSeeCharacter(req, character)) return res.status(404).json({ error: 'Not found' })
  const chain = chainOf(req.params.id)
  const inChain = new Set(chain)
  const rows = memoriesIn(chain).filter((m) => canSeeChat(req, chatStore.get(m.chatId))).map((m) => memoryAsSeenFrom(m, inChain))
  if (!characterId) return res.json(rows)
  const recalls = new Map(memoryRecallStore.counts(characterId, chain).map(({ memoryId, count, lastAt }) => [memoryId, { count, lastAt }]))
  const deep = deepMemoryForChat(chatStore.get(req.params.id)!)
  const visible = rows.filter((m) => m.knownBy.includes(characterId) && (!deep || (m.active && !m.consolidatedFor?.includes(characterId))))
  res.json((deep ? withLinksMany(visible, inChain) : visible).map((m) => {
    const recall = recalls.get(m.id)
    return recall ? { ...m, recall } : m
  }))
})

/** One best-effort batch per saved swipe; stale or no-longer-known memories are skipped. */
memoriesRouter.post('/memories/recalls', (req, res) => {
  const body = req.body ?? {}
  const characterId = str(body.characterId).trim()
  const chatId = str(body.chatId)
  const messageId = str(body.messageId)
  const swipe = body.swipe ?? 0
  if (!characterId || !chatId || !messageId || !Number.isSafeInteger(swipe) || swipe < 0 || !Array.isArray(body.memoryIds) || body.memoryIds.length > BATCH_MAX
    || body.memoryIds.some((id: unknown) => typeof id !== 'string' || !id.trim())) {
    return res.status(400).json({ error: 'Expected a scene, speaker, saved reply and up to 200 memory ids.' })
  }
  const chat = chatStore.get(chatId)
  const character = characterStore.get(characterId)
  if (!chat || !character || !canSeeChat(req, chat) || !canSeeCharacter(req, character)) return res.status(404).json({ error: 'Not found' })
  if (!deepMemoryForChat(chat)) return res.status(409).json({ error: 'Deep Memory is off.' })
  const message = messageStore.get(messageId)
  const swipeText = swipe === (message?.activeSwipe ?? 0) ? message?.text
    : Array.isArray(message?.swipes) ? message.swipes[swipe] : undefined
  if (!message || message.chatId !== chatId || message.role !== 'char' || message.failed || !str(swipeText).trim()
    || (str(message.speakerId) || str(chat.characterId)) !== characterId) return res.status(400).json({ error: 'A saved reply from this speaker is required.' })
  const chain = new Set(chainOf(chatId))
  const ids = uniqueIds(body.memoryIds).filter((id) => {
    const row = memoryStore.get(id)
    if (!row || !chain.has(str(row.chatId)) || !canSeeChat(req, chatStore.get(str(row.chatId)))) return false
    const m = memoryAsSeenFrom(asMemory(row), chain)
    return m.active && m.kind !== 'journal' && m.knownBy.includes(characterId) && !m.consolidatedFor?.includes(characterId)
  })
  const reasons = body.reasons
  if (reasons !== undefined && (!reasons || typeof reasons !== 'object' || Array.isArray(reasons) || Object.keys(reasons).length > BATCH_MAX
    || Object.entries(reasons).some(([id, value]) => !body.memoryIds.includes(id) || !validRecallReasons(value)))) return res.status(400).json({ error: 'Invalid memory reasons.' })
  const at = Date.now()
  db.exec('BEGIN')
  try {
    for (const memoryId of ids) {
      const saved = memoryRecallStore.insert({ memoryId, characterId, chatId, messageId, swipe, at, reasons: reasons?.[memoryId] })
      if (!saved.changes) continue
      for (const link of withLinks(asMemory(memoryStore.get(memoryId)!), chain).links ?? []) {
        if (link.validTo !== null || link.validFrom > at || link.relation === 'supersedes') continue
        memoryLinkStore.update(link.id, { weight: Math.min(LINK_WEIGHT.cap, (link.weight ?? 1) + LINK_WEIGHT.increment), lastUsedAt: at })
      }
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  res.status(204).end()
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
  if (!chat || !canSeeChat(req, chat)) return res.status(404).json({ error: 'Not found' })
  const links = validateLinks(req.body?.links, req)
  if ('error' in links) return res.status(400).json(links)
  if (links.length && !deepMemoryForChat(chat)) return res.status(409).json({ error: 'Deep Memory is off.' })
  let created: Row
  db.exec('BEGIN')
  try {
    created = memoryStore.insert(asRow({ ...withChatContext(input, chat), id: newId() }))
    saveLinks(String(created.id), links, Date.now())
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
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
  const linksByMemory = new Map<string, MemoryLinkInput[]>()
  let totalLinks = 0
  for (const [i, raw] of list.entries()) {
    const input = normalizeMemoryInput(raw, now)
    if ('error' in input) return res.status(400).json({ error: `memories[${i}]: ${input.error}` })
    if (!chats.has(input.chatId)) chats.set(input.chatId, chatStore.get(input.chatId))
    const chat = chats.get(input.chatId)
    if (!chat || !canSeeChat(req, chat)) return res.status(404).json({ error: 'Not found' })
    const links = validateLinks(raw?.links, req)
    if ('error' in links) return res.status(400).json(links)
    if (links.length && !deepMemoryForChat(chat)) return res.status(409).json({ error: 'Deep Memory is off.' })
    totalLinks += links.length
    if (totalLinks > 30) return res.status(400).json({ error: 'At most 30 links per batch.' })
    const id = newId()
    linksByMemory.set(id, links)
    ready.push(asRow({ ...withChatContext(input, chat), id }))
  }
  db.exec('BEGIN')
  try {
    for (const row of ready) { memoryStore.insert(row); saveLinks(String(row.id), linksByMemory.get(String(row.id))!, now) }
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
  const messageId = patch.retiredByMessageId
  const message = messageId ? messageStore.get(messageId) : undefined
  const chat = message ? chatStore.get(str(message.chatId)) : chatStore.get(str(existing.chatId))
  if (messageId && (!message || !chat || !canSeeChat(req, chat) || !chainOf(str(message.chatId)).includes(str(existing.chatId)))) return res.status(400).json({ error: 'Retirement needs a message in this story branch.' })
  const retirementPatch = messageId && message ? { retiredInChatId: String(message.chatId) } : {}
  const replacements = req.body?.replacementIds ?? []
  if (!Array.isArray(replacements) || replacements.length > 30 || replacements.some((id: unknown) => typeof id !== 'string')) return res.status(400).json({ error: 'Invalid replacement memories.' })
  const additions: CharacterMemory[] = []
  for (const id of replacements) {
    const row = memoryStore.get(id)
    if (!row || !message || row.chatId !== message.chatId || !canSeeChat(req, chatStore.get(str(row.chatId)))) return res.status(400).json({ error: 'Replacement memory is outside this batch scene.' })
    additions.push(withLinks(asMemory(row)))
  }
  db.exec('BEGIN')
  try {
    if (existing.origin !== 'consolidation' && patch.text !== undefined && patch.text !== existing.text) cleanMemoryConsolidations(req.params.id)
    if (patch.active === false && messageId && chat && deepMemoryForChat(chat)) {
      const old = withLinks(asMemory(existing)), now = Date.now()
      for (const link of old.links ?? []) if (link.validTo === null) memoryLinkStore.update(link.id, { validTo: now, closedByMessageId: messageId })
      const replacement = replacementFor(old, additions)
      if (replacement && replacement.id !== old.id) memoryLinkStore.insert({ id: newId(), memoryId: replacement.id,
        fromKind: 'memory', fromId: replacement.id, relation: 'supersedes', toKind: 'memory', toId: old.id,
        validFrom: now, validTo: null, closedByMessageId: null, createdAt: now, sourceMessageId: messageId })
    }
    const updated = memoryStore.update(req.params.id, asRow({ ...patch, ...retirementPatch }))
    db.exec('COMMIT')
    res.json(updated)
  } catch (error) { db.exec('ROLLBACK'); throw error }
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
  cleanMemoryConsolidations(req.params.id)
  removeMemoryLinks(req.params.id)
  memoryVectorStore.remove(req.params.id)
  memoryRecallStore.removeMemory(req.params.id)
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
