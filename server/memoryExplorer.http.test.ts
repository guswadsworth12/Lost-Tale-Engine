import { afterAll, beforeAll, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'
import { selectMemoriesExplained } from '../src/lib/memory/rank.ts'
let server: TestServer, cookie: string, member: string
beforeAll(async () => { server = await startTestServer('explorer'); cookie = await server.setupOwner('explorer_owner', 'synthetic-password-123'); member = await server.addMember(cookie, 'explorer_member', 'synthetic-password-456') })
afterAll(async () => { await server?.close() })
const call = (path: string, method = 'GET', body?: unknown, as = cookie) => server.call(`/api${path}`, method, { body, cookie: as })
const reason = { pinned: false, openThread: false, aboutPresent: [], matchedWords: ['quay'], recent: true, important: false, samePlace: true, linkedThrough: ['Mara'], linkedWeights: { Mara: 1 }, score: 0.6 }
async function setup(deepMemory = true) {
  const world = (await call('/worlds', 'POST', { name: 'Synthetic harbor', modules: { deepMemory }, visibility: 'shared', memoryConsolidation: { enabled: true, dailyCap: 1 } })).body
  const speaker = (await call('/characters', 'POST', { card: { name: 'Mara' }, worldId: world.id, visibility: 'shared' })).body
  const other = (await call('/characters', 'POST', { card: { name: 'Tavi' }, worldId: world.id })).body
  const chat = (await call('/chats', 'POST', { characterId: speaker.id, title: 'The quay' })).body
  const source = (await call('/messages', 'POST', { chatId: chat.id, role: 'char', speakerId: speaker.id, name: 'Mara', text: 'A harbor arrival.' })).body
  const memory = (await call('/memories', 'POST', { chatId: chat.id, text: 'Tavi promised to help at the quay.', witnesses: [speaker.id], about: [other.id], location: ' Quay ', importance: 0.2, sourceMessageId: source.id,
    ...(deepMemory ? { links: [{ fromKind: 'person', fromId: speaker.id, relation: 'owes', toKind: 'person', toId: other.id }, { fromKind: 'person', fromId: other.id, relation: 'keeps', toKind: 'thing', toId: 'brass compass' }] } : {}) })).body
  const reply = (await call('/messages', 'POST', { chatId: chat.id, role: 'char', speakerId: speaker.id, name: 'Mara', text: 'The quay has changed.', swipes: ['The quay has changed.', 'An alternate reply.'], activeSwipe: 0 })).body
  const explorer = (chatId = chat.id) => call(`/chats/${chatId}/memory-explorer?characterId=${speaker.id}`)
  const record = (swipe = 0, reasons: unknown = { [memory.id]: reason }) => call('/memories/recalls', 'POST', { chatId: chat.id, characterId: speaker.id, messageId: reply.id, memoryIds: [memory.id], swipe, reasons })
  memory.links = (await explorer()).body.connections
  const link = memory.links[0]
  return { world, speaker, other, chat, source, memory, reply, explorer, record, link }
}
it('filters knowledge, sibling branches and private chats before building the index and recall counts', async () => {
  const s = await setup()
  const hidden = (await call('/memories', 'POST', { chatId: s.chat.id, text: 'Hidden vault password.', witnesses: [s.other.id], location: 'vault' })).body
  const branch = (await call('/chats', 'POST', { characterId: s.speaker.id })).body
  const sibling = (await call('/chats', 'POST', { characterId: s.speaker.id })).body
  for (const scene of [branch, sibling]) await call(`/chats/${scene.id}`, 'PUT', { previousSceneId: s.chat.id })
  const siblingMemory = (await call('/memories', 'POST', { chatId: sibling.id, text: 'Only in the other story branch.', witnesses: [s.speaker.id], location: 'market' })).body
  const evidence = (await call('/messages', 'POST', { chatId: sibling.id, role: 'char', speakerId: s.speaker.id, text: 'A different telling.' })).body
  await call(`/memories/${s.memory.id}`, 'PUT', { active: false, retiredReason: 'Another telling.', retiredByMessageId: evidence.id })
  const data = (await s.explorer(branch.id)).body
  expect(data.memories.map((m: any) => m.id)).toEqual([s.memory.id])
  expect(data.memories[0].status).toBe('active')
  expect(JSON.stringify(data)).not.toContain(hidden.id)
  expect(JSON.stringify(data)).not.toContain(siblingMemory.id)
  expect(data.subjects.find((e: any) => e.kind === 'thing' && e.id === 'brass compass')).toMatchObject({ memoryIds: [s.memory.id], linkIds: [s.memory.links[1].id] })
  expect(data.subjects.find((e: any) => e.kind === 'place')).toMatchObject({ id: 'quay', memoryIds: [s.memory.id] })
  expect(data.connections[0].startedScene).toBe('The quay')
  expect((await call(`/chats/${s.chat.id}/memory-explorer?characterId=${s.speaker.id}`, 'GET', undefined, member)).status).toBe(404)
  expect((await call(`/chats/${s.chat.id}/memory-explorer?characterId=missing`)).status).toBe(404)
  const memberChat = (await call('/chats', 'POST', { characterId: s.speaker.id }, member)).body
  expect((await call(`/chats/${memberChat.id}/memory-explorer?characterId=${s.other.id}`, 'GET', undefined, member)).status).toBe(404)
  await call(`/memories/${s.memory.id}`, 'PUT', { active: true, retiredByMessageId: null })
  expect((await s.record()).status).toBe(204)
  expect((await s.explorer()).body.memories[0].recall).toMatchObject({ count: 1, lastAt: expect.any(Number) })
})
it('edits only the chosen connection, refuses invalid relations and inactive reopens, and applies access checks', async () => {
  const s = await setup(), id = s.link.id
  expect((await call(`/memory-links/${id}`, 'PUT', { relation: 'invented relation' })).status).toBe(400)
  expect((await call(`/memory-links/${id}`, 'PUT', { relation: 'promised' })).body.relation).toBe('promised')
  for (const [method, suffix, body] of [['PUT', '', { relation: 'loves' }], ['POST', '/close', undefined], ['POST', '/reopen', undefined], ['DELETE', '', undefined]] as const) expect((await call(`/memory-links/${id}${suffix}`, method, body, member)).status).toBe(404)
  const closed = (await call(`/memory-links/${id}/close`, 'POST')).body
  expect(closed).toMatchObject({ closedBy: 'player', closedByMessageId: null, validTo: expect.any(Number) })
  await call(`/memories/${s.memory.id}`, 'PUT', { active: false })
  expect((await call(`/memory-links/${id}/reopen`, 'POST')).status).toBe(400)
  await call(`/memories/${s.memory.id}`, 'PUT', { active: true })
  expect((await call(`/memory-links/${id}/reopen`, 'POST')).body).toMatchObject({ validTo: null, closedByMessageId: null })
  expect((await call(`/memory-links/${id}/reopen`, 'POST')).body.closedBy).toBeUndefined()
  const { memoryLinkStore } = await import('./db.ts')
  memoryLinkStore.update(id, { relation: 'supersedes' })
  for (const [method, suffix, body] of [['PUT', '', { relation: 'owes' }], ['POST', '/close', undefined], ['POST', '/reopen', undefined], ['DELETE', '', undefined]] as const) expect((await call(`/memory-links/${id}${suffix}`, method, body)).status).toBe(400)
  memoryLinkStore.update(id, { relation: 'owes' })
  expect((await call(`/memory-links/${id}`, 'DELETE')).status).toBe(204)
  const data = (await s.explorer()).body
  expect(data.memories).toHaveLength(1)
  expect(data.connections.map((l: any) => l.id)).toEqual([s.memory.links[1].id])
})
it('keeps player closures through rewind, backup and fork; deleting evidence removes the memory and connections', async () => {
  const s = await setup()
  await s.record()
  await call(`/memory-links/${s.link.id}/close`, 'POST')
  const before = (await s.explorer()).body.connections.find((l: any) => l.id === s.link.id)
  const { reopenLinks } = await import('./memoryLinks.ts')
  const { memoryLinkStore } = await import('./db.ts')
  // Even a legacy/stale message pointer cannot override an explicit player closure.
  memoryLinkStore.update(s.link.id, { closedByMessageId: s.reply.id })
  reopenLinks(s.reply.id)
  expect(memoryLinkStore.get(s.link.id)?.validTo).toBe(before.validTo)
  memoryLinkStore.update(s.link.id, { closedByMessageId: null })
  const fork = (await call(`/chats/${s.chat.id}/fork`, 'POST')).body
  const copied = (await s.explorer(fork.id)).body.connections.find((l: any) => l.relation === 'owes')
  expect(copied).toMatchObject({ closedBy: 'player', validTo: before.validTo, weight: before.weight, lastUsedAt: before.lastUsedAt })
  const copiedEvent = (await call('/backup')).body.data.memoryRecallEvents.find((e: any) => e.chatId === fork.id)
  expect((await call(`/messages/${copiedEvent.messageId}/recalls`)).body.memories[0].reasons).toEqual(reason)
  const backup = (await call('/backup')).body
  expect((await call('/restore', 'POST', backup)).status).toBe(204)
  expect((await s.explorer()).body.connections.find((l: any) => l.id === s.link.id)).toMatchObject({ closedBy: 'player', validTo: before.validTo })
  expect((await call(`/messages/${s.reply.id}/recalls`)).body.memories[0].reasons).toEqual(reason)
  // Rewind calls this same hook for messages being removed.
  const { retractMessageMemories } = await import('./memories.ts')
  retractMessageMemories(s.chat.id, s.reply.id)
  expect(memoryLinkStore.get(s.link.id)?.closedBy).toBe('player')
  retractMessageMemories(s.chat.id, s.source.id)
  expect((await s.explorer()).body.memories).toEqual([])
  expect(memoryLinkStore.get(s.link.id)).toBeUndefined()
})
it('shows edits in the next prompt, fades in worlds with the module off, and never alters consolidation scopes', async () => {
  const s = await setup()
  const pick = async () => selectMemoriesExplained((await call(`/chats/${s.chat.id}/memories?characterId=${s.speaker.id}`)).body, { characterId: s.speaker.id, presentIds: [s.speaker.id], recentText: '', deep: { now: Date.now(), nameOf: () => 'Mara' } })
  expect((await pick())[0].reasons.linkedThrough).toContain('Mara')
  await call(`/memory-links/${s.link.id}/close`, 'POST')
  expect((await pick())[0].reasons.linkedThrough).toEqual([])
  await call('/memories/consolidate', 'POST', { characterId: s.speaker.id, ids: [s.memory.id] })
  expect(await pick()).toEqual([])
  expect((await s.explorer()).body.memories[0].status).toBe('faded')
  await call(`/memories/${s.memory.id}/unfade`, 'POST', { characterId: s.speaker.id })
  expect((await pick())[0].memory.id).toBe(s.memory.id)
  const { memoryStore } = await import('./db.ts')
  const scopes = [{ characterId: s.speaker.id, chatId: s.chat.id, runId: 'synthetic-run' }]
  memoryStore.update(s.memory.id, { consolidationScopes: scopes })
  await call('/memories/consolidate', 'POST', { characterId: s.speaker.id, ids: [s.memory.id] })
  await call(`/memories/${s.memory.id}/unfade`, 'POST', { characterId: s.speaker.id })
  expect(memoryStore.get(s.memory.id)?.consolidationScopes).toEqual(scopes)
  expect((await s.explorer()).body.memories[0]).toMatchObject({ status: 'summarized', summaryRunId: 'synthetic-run' })
  const off = await setup(false)
  expect((await off.explorer()).body.connections).toEqual([])
  expect((await off.explorer()).body.subjects.map((e: any) => e.kind)).toEqual(['person', 'place'])
  await call('/memories/consolidate', 'POST', { characterId: off.speaker.id, ids: [off.memory.id] })
  expect((await off.explorer()).body.memories[0].status).toBe('faded')
  await call(`/memories/${off.memory.id}/unfade`, 'POST', { characterId: off.speaker.id })
  await call(`/memories/${off.memory.id}`, 'PUT', { pinned: true })
  expect((await off.explorer()).body.memories[0]).toMatchObject({ status: 'active', pinned: true })
})
it('validates and saves bounded reasons per swipe; legacy/off replies are unrecorded and forgotten memories have no text', async () => {
  const s = await setup()
  for (const invalid of [{ ...reason, prompt: 'arbitrary text' }, { ...reason, score: null }, { ...reason, recent: 'yes' }, { ...reason, matchedWords: Array(11).fill('word') }, { ...reason, linkedThrough: ['x'.repeat(81)] }, { ...reason, linkedWeights: { Mara: 'strong' } }]) expect((await s.record(0, { [s.memory.id]: invalid })).status).toBe(400)
  expect((await s.record()).status).toBe(204)
  const alternate = { ...reason, samePlace: false, score: 0.3 }
  expect((await s.record(1, { [s.memory.id]: alternate })).status).toBe(204)
  const read = (swipe: number) => call(`/messages/${s.reply.id}/recalls?swipe=${swipe}`)
  expect((await read(0)).body).toMatchObject({ characterId: s.speaker.id, recorded: true, memories: [{ id: s.memory.id, text: s.memory.text, reasons: reason }] })
  expect((await read(1)).body.memories[0].reasons).toEqual(alternate)
  expect((await call(`/messages/${s.reply.id}/recalls?swipe=-1`)).status).toBe(400)
  expect((await call(`/messages/${s.reply.id}/recalls`, 'GET', undefined, member)).status).toBe(404)
  // Direct old-format client call deliberately omits the optional metadata.
  const old = await setup()
  await call('/memories/recalls', 'POST', { chatId: old.chat.id, characterId: old.speaker.id, messageId: old.reply.id, memoryIds: [old.memory.id] })
  expect((await call(`/messages/${old.reply.id}/recalls`)).body).toMatchObject({ recorded: false, memories: [] })
  const off = await setup(false)
  expect((await off.record()).status).toBe(409)
  expect((await call(`/messages/${off.reply.id}/recalls`)).body).toMatchObject({ recorded: false, memories: [] })
  await call(`/memories/${s.memory.id}`, 'PUT', { text: 'An updated harbor memory.' })
  expect((await read(0)).body.memories[0].text).toBe('An updated harbor memory.')
  const { memoryStore } = await import('./db.ts')
  memoryStore.update(s.memory.id, { knownBy: [s.other.id] })
  expect((await read(0)).body.memories).toEqual([])
  memoryStore.update(s.memory.id, { knownBy: [s.speaker.id] })
  await call(`/memories/${s.memory.id}`, 'DELETE')
  expect((await read(0)).body).toMatchObject({ recorded: true, memories: [{ text: 'A memory since forgotten', forgotten: true }] })
  expect(JSON.stringify((await read(0)).body)).not.toContain(s.memory.text)
})
