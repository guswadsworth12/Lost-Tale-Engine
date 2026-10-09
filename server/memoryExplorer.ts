import express from 'express'
import { chatStore, characterStore, memoryStore, memoryLinkStore, memoryRecallStore, messageStore, worldStore } from './db.ts'
import { canSeeChat, canSeeCharacter } from './access.ts'
import { chainOf, memoriesIn, worldOf } from './memoryContext.ts'
import { memoryAsSeenFrom } from './memoryPlan.ts'
import { withLinksMany } from './memoryLinks.ts'
import { modulesForWorld } from '../src/lib/world/worldTemplates.ts'
import { effectiveLinkWeight } from '../src/lib/memory/linkWeight.ts'
import { placeKey } from '../src/lib/memory/rank.ts'
import { LINK_RELATIONS, type MemoryLink, type EntityKind } from '../src/lib/memory/links.ts'
import { validRecallReasons } from './recallReasons.ts'
import type { ExplorerSubject, MemoryExplorer, ReplyRecalls } from '../src/lib/memory/explorer.ts'
import type { CharacterMemory, WorldCard } from '../src/lib/types.ts'
const str = (v: unknown) => typeof v === 'string' ? v : ''
const label = (id: string) => str(chatStore.get(id)?.sceneTitle) || str(chatStore.get(id)?.title) || 'Untitled scene'
const knownIn = (req: express.Request, chatId: string, characterId: string) => {
  const chain = new Set(chainOf(chatId).filter((id) => canSeeChat(req, chatStore.get(id))))
  // Knowledge and account visibility are checked before fetching connections or building the index.
  const memories = memoriesIn([...chain]).filter((m) => canSeeChat(req, chatStore.get(m.chatId)))
    .map((m) => memoryAsSeenFrom(m, chain)).filter((m) => m.knownBy.includes(characterId))
  return { chain, memories }
}
export const memoryExplorerRouter = express.Router()
memoryExplorerRouter.get('/chats/:id/memory-explorer', (req, res) => {
  const chatId = req.params.id, characterId = str(req.query.characterId), chat = chatStore.get(chatId)
  if (!chat || !canSeeChat(req, chat) || !canSeeCharacter(req, characterStore.get(characterId))) return res.status(404).json({ error: 'Not found' })
  const { chain, memories } = knownIn(req, chatId, characterId)
  const deepMemory = modulesForWorld(worldStore.get(worldOf(chat)) as unknown as WorldCard).deepMemory
  const recalls = new Map(memoryRecallStore.counts(characterId, [...chain]).map(({ memoryId, count, lastAt }) => [memoryId, { count, lastAt }]))
  const now = Date.now()
  const subjects = new Map<string, ExplorerSubject>()
  const add = (kind: EntityKind, id: string, memoryId: string, linkId?: string, displayLabel?: string) => {
    if (!id) return
    const key = `${kind}:${id}`, subject = subjects.get(key) ?? { key, kind, id, memoryIds: [], linkIds: [] }
    if (displayLabel && !subject.displayLabel) subject.displayLabel = displayLabel
    if (!subject.memoryIds.includes(memoryId)) subject.memoryIds.push(memoryId)
    if (linkId && !subject.linkIds.includes(linkId)) subject.linkIds.push(linkId)
    subjects.set(key, subject)
  }
  const rows = deepMemory ? withLinksMany(memories, chain) : memories
  const byId = new Map(rows.map((m) => [m.id, m]))
  const connections = rows.flatMap((m) => m.links ?? []).map((link) => {
    const memory = byId.get(link.memoryId)!
    const closingMessage = link.closedByMessageId ? messageStore.get(link.closedByMessageId) : undefined
    const closingChat = closingMessage && chatStore.get(str(closingMessage.chatId))
    return { ...link, effectiveWeight: effectiveLinkWeight(link, now), startedScene: label(memory.chatId),
      ...(closingChat && canSeeChat(req, closingChat) ? { endedScene: label(str(closingChat.id)) } : {}) }
  })
  for (const m of rows) {
    for (const id of m.about ?? []) add('person', id, m.id)
    if (placeKey(m.location)) add('place', placeKey(m.location), m.id, undefined, m.location?.trim())
    for (const l of m.links ?? []) {
      if (l.fromKind !== 'memory') add(l.fromKind, l.fromId, m.id, l.id)
      if (l.toKind !== 'memory') add(l.toKind, l.toId, m.id, l.id)
    }
  }
  const data: MemoryExplorer = { characterId, deepMemory, subjects: [...subjects.values()], connections, memories: rows.map((m) => {
    const scope = m.consolidationScopes?.find((s) => s.characterId === characterId && chain.has(s.chatId))
    return { ...m, links: undefined, consolidationScopes: m.consolidationScopes?.filter((s) => chain.has(s.chatId)), status: !m.active ? 'retired' : scope ? 'summarized' : m.consolidatedFor?.includes(characterId) ? 'faded' : 'active',
      summaryRunId: scope?.runId, recall: recalls.get(m.id) ?? { count: 0, lastAt: 0 } }
  }) }
  res.json(data)
})
// Access guard resolves the connection's memory, whose scene belongs to this account.
const editableLink = (id: string) => memoryLinkStore.get(id) as unknown as MemoryLink | undefined
memoryExplorerRouter.put('/memory-links/:id', (req, res) => {
  const link = editableLink(req.params.id)
  if (!link) return res.status(404).json({ error: 'Not found' })
  if (link.relation === 'supersedes' || !(LINK_RELATIONS as readonly unknown[]).includes(req.body?.relation)) return res.status(400).json({ error: 'This connection cannot use that relation.' })
  res.json(memoryLinkStore.update(link.id, { relation: req.body.relation }))
})
for (const action of ['close', 'reopen'] as const) memoryExplorerRouter.post(`/memory-links/:id/${action}`, (req, res) => {
  const link = editableLink(req.params.id)
  if (!link) return res.status(404).json({ error: 'Not found' })
  if (link.relation === 'supersedes') return res.status(400).json({ error: 'A replacement connection cannot be edited.' })
  if (action === 'reopen') {
    const chatId = str(req.body?.chatId), chat = chatStore.get(chatId)
    if (!chat || !canSeeChat(req, chat)) return res.status(404).json({ error: 'Not found' })
    const chain = new Set(chainOf(chatId).filter((id) => canSeeChat(req, chatStore.get(id))))
    const memory = memoryStore.get(link.memoryId) as unknown as CharacterMemory | undefined
    if (!memory || !chain.has(memory.chatId)) return res.status(400).json({ error: 'This connection is outside the selected scene’s branch.' })
    if (!memoryAsSeenFrom(memory, chain).active) return res.status(400).json({ error: 'This memory is retired. Its connection cannot be reopened.' })
  }
  res.json(memoryLinkStore.update(link.id, action === 'close' ? { validTo: Date.now(), closedByMessageId: null, closedBy: 'player' } : { validTo: null, closedByMessageId: null, closedBy: undefined }))
})
memoryExplorerRouter.delete('/memory-links/:id', (req, res) => {
  const link = editableLink(req.params.id)
  if (!link) return res.status(404).json({ error: 'Not found' })
  if (link.relation === 'supersedes') return res.status(400).json({ error: 'A replacement connection cannot be edited.' })
  memoryLinkStore.remove(link.id); res.status(204).end()
})
memoryExplorerRouter.post('/memories/:id/unfade', (req, res) => {
  const row = memoryStore.get(req.params.id), characterId = str(req.body?.characterId)
  if (!row || !canSeeCharacter(req, characterStore.get(characterId))) return res.status(404).json({ error: 'Not found' })
  const chatId = str(req.body?.chatId), chat = chatStore.get(chatId)
  if (!chat || !canSeeChat(req, chat)) return res.status(404).json({ error: 'Not found' })
  if (!knownIn(req, chatId, characterId).memories.some((m) => m.id === req.params.id)) return res.status(400).json({ error: 'This character does not know that memory.' })
  const ids = (row.consolidatedFor as string[] | undefined)?.filter((id) => id !== characterId)
  res.json(memoryStore.update(req.params.id, { consolidatedFor: ids?.length ? ids : undefined, updatedAt: Date.now() }))
})
memoryExplorerRouter.get('/messages/:id/recalls', (req, res) => {
  const message = messageStore.get(req.params.id), chat = message && chatStore.get(str(message.chatId))
  if (!message || !chat || !canSeeChat(req, chat)) return res.status(404).json({ error: 'Not found' })
  const characterId = str(message.speakerId) || str(chat.characterId)
  if (!canSeeCharacter(req, characterStore.get(characterId))) return res.status(404).json({ error: 'Not found' })
  const swipe = req.query.swipe === undefined ? Number(message.activeSwipe ?? 0) : Number(req.query.swipe)
  if (!Number.isSafeInteger(swipe) || swipe < 0) return res.status(400).json({ error: 'Invalid swipe.' })
  const { memories } = knownIn(req, str(chat.id), characterId), known = new Map(memories.map((m) => [m.id, m]))
  const data: ReplyRecalls = { characterId, recorded: false, memories: [] }
  for (const event of memoryRecallStore.forReply(str(message.id), characterId, swipe)) {
    if (!event.reasons) continue
    let reasons: unknown
    try { reasons = JSON.parse(event.reasons) } catch { continue }
    if (!validRecallReasons(reasons)) continue
    const memory = known.get(event.memoryId)
    // Forgotten and no longer known/visible memories never leave the server, including their reasons.
    if (!memory) continue
    data.recorded = true
    data.memories.push({ id: memory.id, text: memory.text, reasons })
  }
  res.json(data)
})
