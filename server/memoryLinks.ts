import type { Request } from 'express'
import { characterStore, memoryLinkStore, messageStore, newId } from './db.ts'
import { canSeeCharacter } from './access.ts'
import { normalizeLink, type MemoryLink, type MemoryLinkInput } from '../src/lib/memory/links.ts'
import type { CharacterMemory } from '../src/lib/types.ts'

export const linksFor = (memoryId: string): MemoryLink[] => memoryLinkStore.list({ where: 'memoryId = ?', params: [memoryId], orderBy: 'createdAt' }) as unknown as MemoryLink[]
export const withLinks = (memory: CharacterMemory, chain?: ReadonlySet<string>): CharacterMemory => ({ ...memory,
  links: linksFor(memory.id).map((link) => {
    const closedInChat = link.closedByMessageId ? messageStore.get(link.closedByMessageId)?.chatId : undefined
    return typeof closedInChat === 'string' && chain && !chain.has(closedInChat)
      ? { ...link, validTo: null, closedByMessageId: null } : link
  }) })
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
  for (const link of links) memoryLinkStore.insert({ ...link, id: newId(), memoryId, validFrom: now, validTo: null, closedByMessageId: null, createdAt: now })
}
export function removeMemoryLinks(memoryId: string): void {
  // Includes engine-only edges pointing at the memory from a surviving replacement.
  for (const link of memoryLinkStore.list({ where: 'memoryId = ? OR (fromKind = ? AND fromId = ?) OR (toKind = ? AND toId = ?)', params: [memoryId, 'memory', memoryId, 'memory', memoryId] })) memoryLinkStore.remove(String(link.id))
}
export function reopenLinks(messageId: string): void {
  for (const link of memoryLinkStore.list()) if (link.relation === 'supersedes' && link.sourceMessageId === messageId) memoryLinkStore.remove(String(link.id))
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
