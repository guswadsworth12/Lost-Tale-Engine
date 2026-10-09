import type { Request } from 'express'
import { characterStore, db, memoryLinkStore, messageStore, newId } from './db.ts'
import { canSeeCharacter } from './access.ts'
import { normalizeLink, type MemoryLink, type MemoryLinkInput } from '../src/lib/memory/links.ts'
import type { CharacterMemory } from '../src/lib/types.ts'

export const linksFor = (memoryId: string): MemoryLink[] => memoryLinkStore.list({ where: 'memoryId = ?', params: [memoryId], orderBy: 'createdAt' }) as unknown as MemoryLink[]
// Bound each IN clause below SQLite's variable limit; fetch closing messages once per chunk.
export function withLinksMany(memories: CharacterMemory[], chain?: ReadonlySet<string>): CharacterMemory[] {
  const links: MemoryLink[] = []
  const ids = memories.map((m) => m.id)
  for (let at = 0; at < ids.length; at += 500) {
    const chunk = ids.slice(at, at + 500)
    links.push(...memoryLinkStore.list({ where: `memoryId IN (${chunk.map(() => '?').join(',')})`, params: chunk, orderBy: 'createdAt' }) as unknown as MemoryLink[])
  }
  const closingIds = [...new Set(links.flatMap((l) => l.closedByMessageId ? [l.closedByMessageId] : []))]
  const closingChats = new Map<string, string>()
  if (chain) for (let at = 0; at < closingIds.length; at += 500) {
    const chunk = closingIds.slice(at, at + 500)
    for (const message of messageStore.list({ where: `id IN (${chunk.map(() => '?').join(',')})`, params: chunk })) closingChats.set(String(message.id), String(message.chatId))
  }
  const grouped = new Map<string, MemoryLink[]>()
  for (const link of links) {
    const closedInChat = link.closedByMessageId ? closingChats.get(link.closedByMessageId) : undefined
    const visible = closedInChat && chain && !chain.has(closedInChat) ? { ...link, validTo: null, closedByMessageId: null } : link
    const group = grouped.get(link.memoryId) ?? []
    group.push(visible)
    grouped.set(link.memoryId, group)
  }
  return memories.map((memory) => ({ ...memory, links: grouped.get(memory.id) ?? [] }))
}
export const withLinks = (memory: CharacterMemory, chain?: ReadonlySet<string>): CharacterMemory => withLinksMany([memory], chain)[0]
export function validateLinks(raw: unknown, req: Request): MemoryLinkInput[] | { error: string } {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 3) return { error: 'At most 3 links per memory.' }
  const links = raw.map((l) => normalizeLink(l, (id) => {
    const character = characterStore.get(id)
    return character && canSeeCharacter(req, character) ? id : undefined
  }))
  return links.every((l) => l !== undefined) ? links as MemoryLinkInput[] : { error: 'Invalid memory link.' }
}
export function saveLinks(memoryId: string, links: MemoryLinkInput[], now: number): void {
  for (const link of links) memoryLinkStore.insert({ ...link, id: newId(), memoryId, validFrom: now, validTo: null, closedByMessageId: null, createdAt: now, lastUsedAt: now })
}
export function removeMemoryLinks(memoryId: string): void {
  // Includes engine-only edges pointing at the memory from a surviving replacement.
  for (const link of memoryLinkStore.list({ where: 'memoryId = ? OR (fromKind = ? AND fromId = ?) OR (toKind = ? AND toId = ?)', params: [memoryId, 'memory', memoryId, 'memory', memoryId] })) memoryLinkStore.remove(String(link.id))
}
export function reopenLinks(messageId: string): void {
  db.prepare('DELETE FROM memory_links WHERE sourceMessageId = ?').run(messageId)
  for (const link of memoryLinkStore.list({ where: 'closedByMessageId = ?', params: [messageId] })) memoryLinkStore.update(String(link.id), { validTo: null, closedByMessageId: null })
}
export function copyLinks(memoryIds: Map<string, string>, messageIds: Map<string, string>, sourceIds: Set<string>): void {
  for (const [source, target] of memoryIds) for (const link of linksFor(source)) {
    const closedByMessageId = link.closedByMessageId ? messageIds.get(link.closedByMessageId) ?? null : null
    const mapped = { ...link, id: newId(), memoryId: target, closedByMessageId, validTo: link.closedByMessageId && !closedByMessageId ? null : link.validTo,
      fromId: link.fromKind === 'memory' ? memoryIds.get(link.fromId) ?? link.fromId : link.fromId,
      toId: link.toKind === 'memory' ? memoryIds.get(link.toId) ?? link.toId : link.toId }
    if (link.relation === 'supersedes' && ((link.sourceMessageId && !messageIds.has(link.sourceMessageId)) || (sourceIds.has(link.toId) && !memoryIds.has(link.toId)))) continue
    if (link.sourceMessageId) mapped.sourceMessageId = messageIds.get(link.sourceMessageId)
    memoryLinkStore.insert(mapped)
  }
}
