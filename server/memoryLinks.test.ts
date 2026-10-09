import { beforeEach, expect, it, vi } from 'vitest'
const stores = vi.hoisted(() => ({ links: { list: vi.fn(), update: vi.fn(), remove: vi.fn() }, messages: { list: vi.fn(), get: vi.fn() }, run: vi.fn(), prepare: vi.fn() }))
vi.mock('./db.ts', () => ({ characterStore: { get: vi.fn() }, memoryLinkStore: stores.links, messageStore: stores.messages, newId: vi.fn(), db: { prepare: stores.prepare } }))
import { reopenLinks, withLinksMany } from './memoryLinks.ts'
import type { CharacterMemory } from '../src/lib/types.ts'
beforeEach(() => { vi.clearAllMocks(); stores.prepare.mockReturnValue({ run: stores.run }); stores.messages.list.mockReturnValue([]); stores.links.list.mockReturnValue([]) })
it('retrieves 1,001 visible memories and their repeated closure messages in bounded batches, preserving branch closure views', () => {
  const memories = Array.from({ length: 1001 }, (_, i) => ({ id: `memory-${i}` }) as CharacterMemory)
  stores.links.list.mockImplementation(({ params }: { params: string[] }) => params.map((id) => ({ memoryId: id, closedByMessageId: 'closing', validTo: 123 })))
  stores.messages.list.mockReturnValue([{ id: 'closing', chatId: 'other-branch' }])
  const result = withLinksMany(memories, new Set(['here']))
  expect(stores.links.list.mock.calls.map(([opts]) => opts.params.length)).toEqual([500, 500, 1])
  expect(stores.messages.list).toHaveBeenCalledTimes(1)
  expect(stores.messages.list.mock.calls[0][0]).toEqual({ where: 'id IN (?)', params: ['closing'] })
  expect(stores.messages.get).not.toHaveBeenCalled()
  expect(result.every((m) => m.links?.[0].validTo === null)).toBe(true)
  stores.messages.list.mockReturnValue([])
  expect(withLinksMany(memories.slice(0, 1), new Set(['here']))[0].links?.[0].validTo).toBe(123)
})
it('removes retirement provenance through its indexed column without listing unrelated links', () => {
  reopenLinks('retiring-message')
  expect(stores.prepare).toHaveBeenCalledWith('DELETE FROM memory_links WHERE sourceMessageId = ?')
  expect(stores.run).toHaveBeenCalledWith('retiring-message')
  expect(stores.links.list).toHaveBeenCalledExactlyOnceWith({ where: 'closedByMessageId = ?', params: ['retiring-message'] })
})
