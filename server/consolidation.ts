import express from 'express'
import { characterStore, chatStore, db, memoryStore, memoryVectorStore, memoryRecallStore, messageStore, newId, worldStore } from './db.ts'
import { canSeeChat, canSeeCharacter } from './access.ts'
import { chainOf, memoriesIn } from './memories.ts'
import { memoryAsSeenFrom } from './memoryPlan.ts'
import { withLinksMany, removeMemoryLinks } from './memoryLinks.ts'
import { buildConsolidationPrompt, consolidationAllowed, consolidationClusters, tryParseConsolidation, type ConsolidationRun } from '../src/lib/memory/consolidation.ts'
import type { CharacterMemory, WorldCard } from '../src/lib/types.ts'
const str = (v: unknown) => typeof v === 'string' ? v : ''
export const runsIn = (chatId: string): ConsolidationRun[] => (chatStore.get(chatId)?.consolidationRuns ?? []) as ConsolidationRun[]
const worldOf = (chat: Record<string, unknown>) => str(chat.worldId) || str(characterStore.get(str(chat.characterId))?.worldId)
export const worldRuns = (worldId: string) => chatStore.list().filter((c) => worldOf(c) === worldId).flatMap((c) => runsIn(str(c.id)))
const attemptsIn = (chatId: string): { id: string; characterId: string; at: number }[] => (chatStore.get(chatId)?.consolidationAttempts ?? runsIn(chatId).filter((r) => !r.copiedFrom).map((r) => ({ id: r.id, characterId: r.characterId, at: r.at }))) as { id: string; characterId: string; at: number }[]
const worldAttempts = (worldId: string) => chatStore.list().filter((c) => worldOf(c) === worldId).flatMap((c) => attemptsIn(str(c.id)))
/** Only remove this run's folds; leave later edits, other knowers and sibling runs alone. */
export function undoConsolidation(run: ConsolidationRun): void {
  if (run.undoneAt) return
  for (const id of run.summaryIds) {
    removeMemoryLinks(id); memoryVectorStore.remove(id); memoryRecallStore.removeMemory(id); memoryStore.remove(id)
  }
  for (const id of run.originalIds) {
    const row = memoryStore.get(id) as unknown as CharacterMemory | undefined
    if (!row) continue
    const scopes = row.consolidationScopes?.filter((s) => s.runId !== run.id) ?? []
    const folded = scopes.some((s) => s.characterId === run.characterId)
    const ids = row.consolidatedFor?.filter((id) => id !== run.characterId || folded)
    memoryStore.update(id, { consolidationScopes: scopes.length ? scopes : undefined, consolidatedFor: ids?.length ? ids : undefined })
  }
  chatStore.update(run.chatId, { consolidationRuns: runsIn(run.chatId).map((r) => r.id === run.id ? { ...r, undoneAt: Date.now() } : r) })
}
export function cleanMemoryConsolidations(memoryId: string): void {
  for (const chat of chatStore.list()) for (const run of runsIn(str(chat.id))) {
    if (run.originalIds.includes(memoryId) || run.summaryIds.includes(memoryId)) undoConsolidation(run)
  }
}
export function cleanConsolidations(chatId: string, messageId?: string): void {
  for (const chat of chatStore.list()) for (const run of runsIn(str(chat.id))) {
    if ((!messageId && run.chatId === chatId) || (messageId && run.sourceMessageId === messageId) || run.originalIds.some((id) => {
      const memory = memoryStore.get(id) as unknown as CharacterMemory | undefined
      return memory && (messageId ? memory.sourceMessageId === messageId || memory.toldVia?.some((t) => t.messageId === messageId) : memory.chatId === chatId)
    })) undoConsolidation(run)
  }
}
// Ephemeral reservations prevent concurrent tabs from making duplicate calls. Only the daily attempt counter is saved before the call; memory rows require strict parsing.
const pending = new Map<string, { chatId: string; characterId: string; clusters: string[][]; snapshots: string[]; at: number }>()
export const consolidationRouter = express.Router()
consolidationRouter.get('/worlds/:id/consolidations', (req, res) => res.json(worldRuns(req.params.id).filter((r) => canSeeChat(req, chatStore.get(r.chatId)))))
consolidationRouter.post('/chats/:id/consolidation/prepare', (req, res) => {
  const chatId = req.params.id, characterId = str(req.body?.characterId), chat = chatStore.get(chatId), character = characterStore.get(characterId)
  if (!chat || !character || !canSeeChat(req, chat) || !canSeeCharacter(req, character)) return res.status(404).json({ error: 'Not found' })
  const at = Date.now(), worldId = worldOf(chat), world = worldStore.get(worldId) as unknown as WorldCard | undefined
  for (const [id, p] of pending) if (at - p.at > 120_000) pending.delete(id)
  if (!consolidationAllowed(world, worldAttempts(worldId), characterId, at) || [...pending.values()].some((p) => p.characterId === characterId && worldOf(chatStore.get(p.chatId) ?? {}) === worldId)) return res.json(null)
  const chain = new Set(chainOf(chatId))
  const memories = memoriesIn([...chain]).filter((m) => canSeeChat(req, chatStore.get(m.chatId))).map((m) => memoryAsSeenFrom(m, chain))
  const clusters = consolidationClusters(withLinksMany(memories.filter((m) => m.knownBy.includes(characterId)), chain), characterId, at)
  if (!clusters.length) return res.json(null)
  const id = newId()
  pending.set(id, { chatId, characterId, clusters: clusters.map((group) => group.map((m) => m.id)), snapshots: clusters.flat().map((m) => JSON.stringify(memoryStore.get(m.id))), at })
  chatStore.update(chatId, { consolidationAttempts: [...attemptsIn(chatId).filter((a) => Math.floor(a.at / 86400_000) === Math.floor(at / 86400_000)), { id, characterId, at }] })
  res.json({ id, prompt: buildConsolidationPrompt(clusters, characterId) })
})
consolidationRouter.post('/chats/:id/consolidation/:token', (req, res) => {
  const token = req.params.token, p = pending.get(token), chat = chatStore.get(req.params.id)
  if (!p || p.chatId !== req.params.id || !chat || !canSeeChat(req, chat) || !canSeeCharacter(req, characterStore.get(p.characterId))) return res.status(404).json({ error: 'Not found' })
  pending.delete(token)
  if (req.body?.cancel) return res.status(204).end()
  const summaries = tryParseConsolidation(str(req.body?.raw), p.clusters.length)
  if (!summaries) return res.status(400).json({ error: 'Consolidation returned invalid JSON; no memories were changed.' })
  const at = Date.now(), chain = new Set(chainOf(p.chatId)), worldId = worldOf(chat)
  if (at - p.at > 120_000 || !consolidationAllowed(worldStore.get(worldId) as unknown as WorldCard, worldAttempts(worldId).filter((a) => a.id !== token), p.characterId, at)) return res.status(409).json({ error: 'Consolidation is no longer available.' })
  const clusters = p.clusters.map((group) => group.map((id) => memoryStore.get(id) as unknown as CharacterMemory | undefined))
  if (clusters.flat().some((m, i) => JSON.stringify(m) !== p.snapshots[i])) return res.status(409).json({ error: 'Memories changed during consolidation; nothing was saved.' })
  if (clusters.some((group) => group.some((m) => !m || !chain.has(m.chatId) || !canSeeChat(req, chatStore.get(m.chatId)) || !memoryAsSeenFrom(m, chain).knownBy.includes(p.characterId) || !m.active || m.pinned || m.unresolved || memoryAsSeenFrom(m, chain).consolidatedFor?.includes(p.characterId)))) return res.status(409).json({ error: 'Memories changed during consolidation; nothing was saved.' })
  const sourceMessageId = str(messageStore.list({ where: 'chatId = ?', params: [p.chatId], orderBy: 'createdAt DESC' })[0]?.id) || undefined
  const run: ConsolidationRun = { id: newId(), chatId: p.chatId, characterId: p.characterId, sourceMessageId, at, summaryIds: [], originalIds: p.clusters.flat() }
  db.exec('BEGIN')
  try {
    clusters.forEach((group, i) => {
      const id = newId(); run.summaryIds.push(id)
      memoryStore.insert({ id, chatId: p.chatId, worldId, kind: 'learned', text: summaries[i], witnesses: [p.characterId], knownBy: [p.characterId], importance: Math.max(...group.map((m) => m!.importance)), origin: 'consolidation', sourceMessageId, active: true, createdAt: at, updatedAt: at })
      for (const memory of group) memoryStore.update(memory!.id, { consolidatedFor: [...new Set([...(memory!.consolidatedFor ?? []), p.characterId])], consolidationScopes: [...(memory!.consolidationScopes ?? []), { characterId: p.characterId, chatId: p.chatId, runId: run.id }] })
    })
    chatStore.update(p.chatId, { consolidationRuns: [...runsIn(p.chatId), run] })
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
  res.json(run)
})
consolidationRouter.post('/chats/:id/consolidations/:runId/undo', (req, res) => {
  const chat = chatStore.get(req.params.id), run = runsIn(req.params.id).find((r) => r.id === req.params.runId)
  if (!chat || !run || run.undoneAt || !canSeeChat(req, chat)) return res.status(404).json({ error: 'Not found' })
  db.exec('BEGIN')
  try { undoConsolidation(run); db.exec('COMMIT') } catch (error) { db.exec('ROLLBACK'); throw error }
  res.status(204).end()
})
