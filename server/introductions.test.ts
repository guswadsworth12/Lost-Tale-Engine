import { beforeEach, expect, it, vi } from 'vitest'
const stores = vi.hoisted(() => ({ chats: { get: vi.fn(), update: vi.fn() }, messages: { list: vi.fn(), get: vi.fn() }, characters: { get: vi.fn() } }))
vi.mock('./db.ts', () => ({ chatStore: stores.chats, messageStore: stores.messages, characterStore: stores.characters }))
import { recordIntroductions } from './introductions.ts'
beforeEach(() => { vi.clearAllMocks(); stores.messages.list.mockReturnValue([]); stores.messages.get.mockReturnValue(undefined) })
it('does not read a transcript with no stranger records', () => {
  for (const strangers of [undefined, {}, { newcomer: { ids: [], since: 1000 } }]) {
    stores.chats.get.mockReturnValue({ id: 'chat', strangers })
    recordIntroductions('chat')
    recordIntroductions('chat', 'new-message')
  }
  expect(stores.messages.list).not.toHaveBeenCalled()
  expect(stores.messages.get).not.toHaveBeenCalled()
})
it('bounds recomputation by stranger arrival and reads only the new message on creation', () => {
  stores.chats.get.mockReturnValue({ id: 'chat', characterId: 'lead', strangers: { newcomer: { ids: ['person'], since: 1000 }, other: { ids: ['person'], since: 1500 } } })
  recordIntroductions('chat')
  expect(stores.messages.list).toHaveBeenCalledExactlyOnceWith({ where: 'chatId = ? AND createdAt >= ?', params: ['chat', 1000], orderBy: 'createdAt' })
  vi.clearAllMocks()
  recordIntroductions('chat', 'new-message')
  expect(stores.messages.get).toHaveBeenCalledExactlyOnceWith('new-message')
  expect(stores.messages.list).not.toHaveBeenCalled()
})
