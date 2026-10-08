import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let owner = ''
let member = ''
beforeAll(async () => {
  t = await startTestServer('memory-recalls')
  owner = await t.setupOwner('recall_owner', 'synthetic-owner-password')
  member = await t.addMember(owner, 'recall_member', 'synthetic-member-password')
})
afterAll(async () => { await t?.close() })
const call = (route: string, method = 'GET', body?: unknown, cookie = owner) => t.call(route, method, { body, cookie })

async function scene() {
  const world = (await call('/api/worlds', 'POST', { name: 'Harbor', modules: { deepMemory: true }, description: '', lorebook: { entries: [] } })).body
  const brisa = (await call('/api/characters', 'POST', { card: { name: 'Brisa' }, worldId: world.id })).body
  const chat = (await call('/api/chats', 'POST', { characterId: brisa.id, title: 'Quay' })).body
  const say = async (text: string, createdAt = Date.now()) => (await call('/api/messages', 'POST', { chatId: chat.id, role: 'char', name: 'Brisa', text, createdAt })).body
  const memory = (await call('/api/memories', 'POST', { chatId: chat.id, text: 'Brisa crossed the quay.', witnesses: [brisa.id], location: ' Quay ', createdAt: 500 })).body
  const recall = (messageId: string, memoryIds = [memory.id]) => call('/api/memories/recalls', 'POST', { chatId: chat.id, characterId: brisa.id, messageId, memoryIds })
  const read = async () => (await call(`/api/chats/${chat.id}/memories?characterId=${brisa.id}`)).body
  return { world, brisa, chat, say, memory, recall, read }
}

describe('recall counting and lifecycle', () => {
  it('records a deduplicated batch per saved reply and returns only that speaker’s counts', async () => {
    const s = await scene()
    const a = await s.say('The quay is familiar.')
    expect((await s.recall(a.id, [s.memory.id, s.memory.id])).status).toBe(204)
    expect((await s.recall(a.id)).status).toBe(204)
    expect((await s.read())[0]).toMatchObject({ location: 'Quay', recall: { count: 1, lastAt: expect.any(Number) } })
    const b = await s.say('I recall it again.')
    await s.recall(b.id)
    expect((await s.read())[0].recall.count).toBe(2)
    const tavi = (await call('/api/characters', 'POST', { card: { name: 'Tavi' }, worldId: s.world.id })).body
    await call(`/api/memories/${s.memory.id}/share`, 'POST', { to: [tavi.id] })
    expect((await call(`/api/chats/${s.chat.id}/memories?characterId=${tavi.id}`)).body[0]).not.toHaveProperty('recall')
    const otherReply = (await call('/api/messages', 'POST', { chatId: s.chat.id, role: 'char', name: 'Tavi', speakerId: tavi.id, text: 'I remember a different crossing.' })).body
    expect((await call('/api/memories/recalls', 'POST', { chatId: s.chat.id, characterId: tavi.id, messageId: otherReply.id, memoryIds: [s.memory.id] })).status).toBe(204)
    expect((await call(`/api/chats/${s.chat.id}/memories?characterId=${tavi.id}`)).body[0].recall.count).toBe(1)
    expect((await s.read())[0].recall.count).toBe(2)
    await call(`/api/characters/${tavi.id}`, 'DELETE')
    expect((await call('/api/backup')).body.data.memoryRecallEvents.some((r: any) => r.characterId === tavi.id)).toBe(false)
    expect((await call(`/api/chats/${s.chat.id}/memories`)).body[0]).not.toHaveProperty('recall')
    const backup = (await call('/api/backup')).body
    expect(backup.data.memoryRecallEvents.filter((r: any) => r.memoryId === s.memory.id)).toHaveLength(2)
    await call(`/api/memories/${s.memory.id}`, 'DELETE')
    expect((await call('/api/backup')).body.data.memoryRecallEvents.some((r: any) => r.memoryId === s.memory.id)).toBe(false)
    expect((await call('/api/restore', 'POST', backup)).status).toBe(204)
    expect((await s.read())[0].recall.count).toBe(2)
    // Old backups carry no recall table: replace it with an empty one, never keep stale counts.
    delete backup.data.memoryRecallEvents
    backup.data.memoryRecalls = [{ memoryId: s.memory.id, characterId: s.brisa.id, count: 99, lastAt: 1, events: [] }]
    await call('/api/restore', 'POST', backup)
    expect((await s.read())[0]).not.toHaveProperty('recall')
  })

  it('skips stale, unknown and off-branch memories but refuses access problems and failed replies', async () => {
    const s = await scene()
    const a = await s.say('A remembered crossing.')
    expect((await call('/api/memories/recalls', 'POST', { chatId: s.chat.id, characterId: s.brisa.id, messageId: a.id, memoryIds: [s.memory.id] }, member)).status).toBe(404)
    expect((await call('/api/memories/recalls', 'POST', { chatId: 'missing', characterId: s.brisa.id, messageId: a.id, memoryIds: [s.memory.id] })).status).toBe(404)
    expect((await call('/api/memories/recalls', 'POST', { chatId: s.chat.id, characterId: 'missing', messageId: a.id, memoryIds: [s.memory.id] })).status).toBe(404)
    expect((await call('/api/memories/recalls', 'POST', { chatId: s.chat.id, characterId: s.brisa.id, messageId: a.id, swipe: -1, memoryIds: [s.memory.id] })).status).toBe(400)
    expect((await s.recall(a.id, ['missing'])).status).toBe(204)
    const secret = (await call('/api/memories', 'POST', { chatId: s.chat.id, text: 'Tavi hid a key.', witnesses: ['tavi'] })).body
    expect((await s.recall(a.id, [s.memory.id, secret.id, 'missing'])).status).toBe(204)
    expect((await s.read())[0].recall.count).toBe(1)
    expect((await call('/api/backup')).body.data.memoryRecallEvents.filter((r: any) => r.messageId === a.id).map((r: any) => r.memoryId)).toEqual([s.memory.id])
    const other = (await call('/api/chats', 'POST', { characterId: s.brisa.id, title: 'Elsewhere' })).body
    const offBranch = (await call('/api/memories', 'POST', { chatId: other.id, text: 'A different crossing.', witnesses: [s.brisa.id] })).body
    expect((await s.recall(a.id, [offBranch.id])).status).toBe(204)
    await call(`/api/memories/${secret.id}/share`, 'POST', { to: [s.brisa.id], chatId: other.id })
    expect((await s.recall(a.id, [secret.id])).status).toBe(204)
    await call(`/api/messages/${a.id}`, 'PUT', { failed: true })
    expect((await s.recall(a.id)).status).toBe(400)
    expect((await call('/api/memories/recalls', 'POST', { memoryIds: [] })).status).toBe(400)
    await call(`/api/worlds/${s.world.id}`, 'PUT', { modules: { deepMemory: false } })
    await call(`/api/messages/${a.id}`, 'PUT', { failed: false })
    expect((await s.recall(a.id)).status).toBe(409)
  })

  it('preserves credit on swipe selection and continuation, replacing only a regenerated swipe', async () => {
    const s = await scene()
    const a = await s.say('First crossing.')
    const second = (await call('/api/memories', 'POST', { chatId: s.chat.id, text: 'Brisa saw a ferry.', witnesses: [s.brisa.id], createdAt: 600 })).body
    const record = (swipe: number, memoryIds: string[]) => call('/api/memories/recalls', 'POST', {
      chatId: s.chat.id, characterId: s.brisa.id, messageId: a.id, swipe, memoryIds,
    })
    const counts = async () => Object.fromEntries((await s.read()).map((m: any) => [m.id, m.recall?.count ?? 0]))
    await record(0, [s.memory.id])
    await call(`/api/messages/${a.id}`, 'PUT', { text: '', swipes: ['First crossing.', ''], activeSwipe: 1 })
    await call(`/api/messages/${a.id}`, 'PUT', { text: 'The ferry.', swipes: ['First crossing.', 'The ferry.'] })
    await record(1, [second.id])
    expect(await counts()).toEqual({ [s.memory.id]: 0, [second.id]: 1 })
    await call(`/api/messages/${a.id}`, 'PUT', { text: 'First crossing.', activeSwipe: 0 })
    expect(await counts()).toEqual({ [s.memory.id]: 1, [second.id]: 0 })
    // Continuation supplies another memory on the same swipe, without double-counting the original.
    await call(`/api/messages/${a.id}`, 'PUT', { text: 'First crossing. A ferry arrived.', swipes: ['First crossing. A ferry arrived.', 'The ferry.'] })
    await record(0, [s.memory.id, second.id])
    expect(await counts()).toEqual({ [s.memory.id]: 1, [second.id]: 1 })
    await call(`/api/messages/${a.id}`, 'PUT', { text: '' })
    expect((await record(0, [second.id])).status).toBe(400) // Old swipe text cannot credit an unsaved regeneration.
    await call(`/api/messages/${a.id}`, 'PUT', { text: 'A new crossing.', swipes: ['A new crossing.', 'The ferry.'] })
    await record(0, [s.memory.id])
    expect(await counts()).toEqual({ [s.memory.id]: 1, [second.id]: 0 })
    await call(`/api/messages/${a.id}`, 'PUT', { text: 'The ferry.', activeSwipe: 1 })
    expect(await counts()).toEqual({ [s.memory.id]: 0, [second.id]: 1 })
    const fork = (await call(`/api/chats/${s.chat.id}/fork`, 'POST', { messageId: a.id })).body
    const forkRead = async () => (await call(`/api/chats/${fork.id}/memories?characterId=${s.brisa.id}`)).body
    expect((await forkRead()).map((m: any) => [m.text, m.recall?.count ?? 0])).toEqual([
      ['Brisa crossed the quay.', 0], ['Brisa saw a ferry.', 1],
    ])
    const forkMessages = (await call(`/api/chats/${fork.id}/messages`)).body
    await call(`/api/messages/${forkMessages[0].id}`, 'PUT', { activeSwipe: 0, text: 'A new crossing.' })
    expect((await forkRead()).map((m: any) => m.recall?.count ?? 0)).toEqual([1, 0])
    // Removing a trailing swipe removes only its events; deleting the reply removes every swipe.
    await call(`/api/messages/${a.id}`, 'PUT', { text: 'A new crossing.', activeSwipe: 0, swipes: ['A new crossing.'] })
    expect((await call('/api/backup')).body.data.memoryRecallEvents.filter((r: any) => r.messageId === a.id).map((r: any) => r.swipe)).toEqual([0])
    await call(`/api/messages/${a.id}`, 'DELETE')
    expect((await call('/api/backup')).body.data.memoryRecallEvents.some((r: any) => r.messageId === a.id)).toBe(false)
  })

  it('retracts only the deleted message’s rows and leaves unrelated events untouched', async () => {
    const s = await scene()
    const other = await scene()
    const a = await s.say('First reply.')
    const b = await s.say('Second reply.')
    const c = await other.say('An unrelated reply.')
    await s.recall(a.id)
    await s.recall(b.id)
    await other.recall(c.id)
    const before = (await call('/api/backup')).body.data.memoryRecallEvents
    await call(`/api/messages/${a.id}`, 'DELETE')
    expect((await call('/api/backup')).body.data.memoryRecallEvents).toEqual(before.filter((r: any) => r.messageId !== a.id))
  })

  it('records valid picks when other picks were retired or folded before recording', async () => {
    const s = await scene()
    const a = await s.say('A remembered crossing.')
    const retired = (await call('/api/memories', 'POST', { chatId: s.chat.id, text: 'An old ferry.', witnesses: [s.brisa.id] })).body
    const folded = (await call('/api/memories', 'POST', { chatId: s.chat.id, text: 'A harbor day.', witnesses: [s.brisa.id] })).body
    await call(`/api/memories/${retired.id}`, 'PUT', { active: false })
    await call(`/api/memories/${folded.id}`, 'PUT', { consolidatedFor: [s.brisa.id] })
    expect((await s.recall(a.id, [s.memory.id, retired.id, folded.id, 'missing'])).status).toBe(204)
    expect((await call('/api/backup')).body.data.memoryRecallEvents.filter((r: any) => r.messageId === a.id).map((r: any) => r.memoryId)).toEqual([s.memory.id])
  })

  it('undoes reply recalls on message deletion and rewind, including surviving old memories', async () => {
    const s = await scene()
    const a = await s.say('First recollection.', 1000)
    const b = await s.say('Second recollection.', 2000)
    await s.recall(a.id)
    await s.recall(b.id)
    await call(`/api/messages/${b.id}`, 'DELETE')
    expect((await s.read())[0].recall.count).toBe(1)
    const c = await s.say('A fresh turn.', 3000)
    const newMemory = (await call('/api/memories', 'POST', { chatId: s.chat.id, text: 'Brisa met Mira.', witnesses: [s.brisa.id], sourceMessageId: c.id })).body
    await s.recall(c.id, [s.memory.id, newMemory.id])
    expect((await call(`/api/chats/${s.chat.id}/rewind`, 'POST', { messageId: c.id })).status).toBe(200)
    expect((await s.read()).map((m: any) => m.id)).toEqual([s.memory.id])
    expect((await s.read())[0].recall.count).toBe(1)
    expect((await call('/api/backup')).body.data.memoryRecallEvents.some((r: any) => r.memoryId === newMemory.id)).toBe(false)
    await call(`/api/chats/${s.chat.id}/purge`, 'DELETE')
    expect((await call('/api/backup')).body.data.memoryRecallEvents.some((r: any) => r.memoryId === s.memory.id)).toBe(false)
  })

  it('copies recall history with a fork and purges it on character/chat deletion', async () => {
    const s = await scene()
    const a = await s.say('Remember the quay.', 1000)
    await s.recall(a.id)
    const fork = await call(`/api/chats/${s.chat.id}/fork`, 'POST', { messageId: a.id })
    expect(fork.status).toBe(201)
    const copied = (await call(`/api/chats/${fork.body.id}/memories?characterId=${s.brisa.id}`)).body
    expect(copied[0].id).not.toBe(s.memory.id)
    expect(copied[0].recall.count).toBe(1)
    await call(`/api/characters/${s.brisa.id}`, 'DELETE')
    const rows = (await call('/api/backup')).body.data.memoryRecallEvents
    expect(rows.some((r: any) => [s.memory.id, copied[0].id].includes(r.memoryId))).toBe(false)
  })

  it('scopes ancestral recall history to the branch and removes only a purged scene’s contribution', async () => {
    const s = await scene()
    const first = await s.say('An old crossing.', 1000)
    await s.recall(first.id)
    const later = (await call('/api/chats', 'POST', { characterId: s.brisa.id, title: 'Next landing' })).body
    await call(`/api/chats/${later.id}`, 'PUT', { previousSceneId: s.chat.id })
    const reply = (await call('/api/messages', 'POST', { chatId: later.id, role: 'char', name: 'Brisa', text: 'The crossing comes back.', createdAt: 2000 })).body
    await call('/api/memories/recalls', 'POST', { chatId: later.id, characterId: s.brisa.id, messageId: reply.id, memoryIds: [s.memory.id] })
    const read = async (id: string) => (await call(`/api/chats/${id}/memories?characterId=${s.brisa.id}`)).body[0]
    expect((await read(later.id)).recall.count).toBe(2)
    expect((await s.read())[0].recall.count).toBe(1)
    const fork = (await call(`/api/chats/${later.id}/fork`, 'POST', { messageId: reply.id })).body
    expect((await read(fork.id)).id).toBe(s.memory.id)
    expect((await read(fork.id)).recall.count).toBe(2)
    expect((await read(later.id)).recall.count).toBe(2)
    await call(`/api/chats/${fork.id}/purge`, 'DELETE')
    await call(`/api/chats/${later.id}`, 'DELETE')
    await call(`/api/chats/${later.id}/restore`, 'POST')
    expect((await read(later.id)).recall.count).toBe(2)
    await call(`/api/chats/${later.id}/purge`, 'DELETE')
    expect((await s.read())[0].recall.count).toBe(1)
    expect((await call('/api/backup')).body.data.memoryRecallEvents.filter((r: any) => r.memoryId === s.memory.id)).toHaveLength(1)
  })
})
