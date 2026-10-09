import { beforeAll, afterAll, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'
let server: TestServer, cookie: string
beforeAll(async () => { server = await startTestServer('phase5'); cookie = await server.setupOwner('memory_owner', 'synthetic-password-123') })
afterAll(async () => { await server?.close() })
const call = (path: string, method = 'GET', body?: unknown) => server.call(`/api${path}`, method, { body, cookie })
async function setup(enabled = true) {
  const world = (await call('/worlds', 'POST', { name: 'Synthetic harbor', modules: { deepMemory: true }, ...(enabled ? { memoryConsolidation: { enabled: true, dailyCap: 1 } } : {}) })).body
  const person = async (name: string) => (await call('/characters', 'POST', { card: { name }, worldId: world.id })).body
  const speaker = await person('Mara'), other = await person('Tavi')
  const chat = (await call('/chats', 'POST', { characterId: speaker.id })).body
  const source = (await call('/messages', 'POST', { chatId: chat.id, role: 'char', name: 'Mara', text: 'Mara remembers the quay.', speakerId: speaker.id })).body
  const originals = []
  for (let i = 0; i < 3; i++) originals.push((await call('/memories', 'POST', { chatId: chat.id, text: `A quay event ${i}.`, witnesses: [speaker.id, other.id], importance: 0.2 + i * 0.1, location: 'quay', sourceMessageId: source.id, links: [{ fromKind: 'person', fromId: speaker.id, relation: 'works with', toKind: 'person', toId: other.id }] })).body)
  await call('/memories', 'POST', { chatId: chat.id, text: 'Hidden vault password.', witnesses: [other.id], location: 'quay' })
  const prepare = () => call(`/chats/${chat.id}/consolidation/prepare`, 'POST', { characterId: speaker.id })
  return { world, speaker, other, chat, source, originals, prepare }
}
it('is off by default; module off forbids the optional pass regardless of the sub-option', async () => {
  const s = await setup(false)
  expect(s.world.memoryConsolidation).toBeUndefined()
  expect((await s.prepare()).body).toBeNull()
  await call(`/worlds/${s.world.id}`, 'PUT', { modules: { deepMemory: false }, memoryConsolidation: { enabled: true, dailyCap: 1 } })
  expect((await s.prepare()).body).toBeNull()
})
it('reserves one call, rejects invalid replies without side effects, folds for only the speaker and undoes exactly', async () => {
  const s = await setup()
  await call(`/worlds/${s.world.id}`, 'PUT', { memoryConsolidation: { enabled: true, dailyCap: 2 } })
  const before = (await call(`/chats/${s.chat.id}/memories`)).body
  let p = (await s.prepare()).body
  expect(p.prompt).not.toContain('Hidden vault password')
  expect((await s.prepare()).body).toBeNull()
  expect((await call(`/chats/${s.chat.id}/consolidation/${p.id}`, 'POST', { raw: 'bad' })).status).toBe(400)
  expect((await call(`/chats/${s.chat.id}/memories`)).body).toEqual(before)
  expect((await call(`/worlds/${s.world.id}/consolidations`)).body).toEqual([])
  p = (await s.prepare()).body
  const run = (await call(`/chats/${s.chat.id}/consolidation/${p.id}`, 'POST', { raw: '{"summaries":["Mara remembers three events at the quay."]}' })).body
  const visible = (await call(`/chats/${s.chat.id}/memories?characterId=${s.speaker.id}`)).body
  expect(visible).toHaveLength(1)
  expect(visible[0]).toMatchObject({ origin: 'consolidation', witnesses: [s.speaker.id], knownBy: [s.speaker.id], importance: 0.4, kind: 'learned', chatId: s.chat.id })
  expect((await call(`/chats/${s.chat.id}/memories?characterId=${s.other.id}`)).body.map((m: any) => m.id)).toEqual(expect.arrayContaining(s.originals.map((m) => m.id)))
  expect((await s.prepare()).body).toBeNull()
  expect((await call(`/chats/${s.chat.id}/consolidations/${run.id}/undo`, 'POST')).status).toBe(204)
  expect((await call(`/chats/${s.chat.id}/memories`)).body).toEqual(before)
  expect((await s.prepare()).body).toBeNull() // Undo does not reset today's model-call cap.
})
it('keeps originals visible in sibling branches and restores them when a source message is edited', async () => {
  const s = await setup()
  const branch = (await call('/chats', 'POST', { characterId: s.speaker.id, previousSceneId: s.chat.id })).body
  const sibling = (await call('/chats', 'POST', { characterId: s.speaker.id, previousSceneId: s.chat.id })).body
  await call(`/chats/${branch.id}`, 'PUT', { previousSceneId: s.chat.id })
  await call(`/chats/${sibling.id}`, 'PUT', { previousSceneId: s.chat.id })
  const p = (await call(`/chats/${branch.id}/consolidation/prepare`, 'POST', { characterId: s.speaker.id })).body
  expect(p).not.toBeNull()
  await call(`/chats/${branch.id}/consolidation/${p.id}`, 'POST', { raw: '{"summaries":["Three quay events."]}' })
  expect((await call(`/chats/${sibling.id}/memories?characterId=${s.speaker.id}`)).body.map((m: any) => m.id)).toEqual(s.originals.map((m) => m.id))
  expect((await call(`/chats/${branch.id}/memories?characterId=${s.speaker.id}`)).body).toHaveLength(1)
  await call(`/messages/${s.source.id}`, 'PUT', { text: 'Edited source.' })
  expect((await call(`/worlds/${s.world.id}/consolidations`)).body[0].undoneAt).toBeTypeOf('number')
  expect((await call(`/chats/${branch.id}/memories`)).body.some((m: any) => m.origin === 'consolidation')).toBe(false)
})
it('raises link weights only for new valid recalls; caps, forks and backup/restore retain weights', async () => {
  const s = await setup()
  const reply = (await call('/messages', 'POST', { chatId: s.chat.id, role: 'char', speakerId: s.speaker.id, name: 'Mara', text: 'The quay.' })).body
  const recall = { chatId: s.chat.id, characterId: s.speaker.id, messageId: reply.id, memoryIds: [s.originals[0].id] }
  expect((await call('/memories/recalls', 'POST', recall)).status).toBe(204)
  const links = async () => (await call('/backup')).body.data.memoryLinks
  let link = (await links()).find((l: any) => l.memoryId === s.originals[0].id)
  expect(link.weight).toBe(1.1); expect(link.lastUsedAt).toBeTypeOf('number')
  await call('/memories/recalls', 'POST', recall)
  expect((await links()).find((l: any) => l.id === link.id).weight).toBe(1.1)
  for (let i = 0; i < 12; i++) {
    const message = (await call('/messages', 'POST', { chatId: s.chat.id, role: 'char', speakerId: s.speaker.id, name: 'Mara', text: `Recall ${i}` })).body
    await call('/memories/recalls', 'POST', { ...recall, messageId: message.id })
  }
  link = (await links()).find((l: any) => l.id === link.id)
  expect(link.weight).toBe(2)
  const fork = (await call(`/chats/${s.chat.id}/fork`, 'POST')).body
  const copied = (await call(`/chats/${fork.id}/memories?characterId=${s.speaker.id}`)).body.find((m: any) => m.text === s.originals[0].text)
  expect(copied.links[0]).toMatchObject({ weight: 2, lastUsedAt: link.lastUsedAt })
  const backup = (await call('/backup')).body
  expect((await call('/restore', 'POST', backup)).status).toBe(204)
  expect((await links()).find((l: any) => l.id === link.id)).toEqual(link)

})
it('copies consolidation records on full forks, undoes a copy without changing its source, and round-trips records', async () => {
  const s = await setup()
  const p = (await s.prepare()).body
  const run = (await call(`/chats/${s.chat.id}/consolidation/${p.id}`, 'POST', { raw: '{"summaries":["Mara remembers the quay events."]}' })).body
  const fork = (await call(`/chats/${s.chat.id}/fork`, 'POST')).body
  const copiedRuns = (await call(`/chats/${fork.id}`)).body.consolidationRuns
  expect(copiedRuns).toHaveLength(1)
  expect(copiedRuns[0]).toMatchObject({ copiedFrom: run.id, chatId: fork.id, characterId: s.speaker.id })
  expect(copiedRuns[0].summaryIds).not.toEqual(run.summaryIds)
  expect((await call(`/chats/${fork.id}/memories?characterId=${s.speaker.id}`)).body).toHaveLength(1)
  const backup = (await call('/backup')).body
  expect((await call('/restore', 'POST', backup)).status).toBe(204)
  expect((await call(`/chats/${fork.id}`)).body.consolidationRuns).toEqual(copiedRuns)
  await call(`/chats/${fork.id}/consolidations/${copiedRuns[0].id}/undo`, 'POST')
  expect((await call(`/chats/${fork.id}/memories?characterId=${s.speaker.id}`)).body).toHaveLength(3)
  expect((await call(`/chats/${s.chat.id}/memories?characterId=${s.speaker.id}`)).body).toHaveLength(1)
  expect((await s.prepare()).body).toBeNull()
  // Run records are server-owned; a chat update cannot forge an Undo target.
  await call(`/chats/${s.chat.id}`, 'PUT', { consolidationRuns: [], consolidationAttempts: [] })
  expect((await call(`/chats/${s.chat.id}`)).body.consolidationRuns).toHaveLength(1)
  expect((await s.prepare()).body).toBeNull()
})
it('rejects stale knowledge before committing and cleans dependent summaries when an original is forgotten', async () => {
  const s = await setup()
  await call(`/worlds/${s.world.id}`, 'PUT', { memoryConsolidation: { enabled: true, dailyCap: 2 } })
  let p = (await s.prepare()).body
  await call(`/memories/${s.originals[0].id}`, 'PUT', { pinned: true })
  expect((await call(`/chats/${s.chat.id}/consolidation/${p.id}`, 'POST', { raw: '{"summaries":["Quay events."]}' })).status).toBe(409)
  expect((await call(`/worlds/${s.world.id}/consolidations`)).body).toEqual([])
  await call(`/memories/${s.originals[0].id}`, 'PUT', { pinned: false })
  p = (await s.prepare()).body
  await call(`/chats/${s.chat.id}/consolidation/${p.id}`, 'POST', { raw: '{"summaries":["Quay events."]}' })
  await call(`/memories/${s.originals[0].id}`, 'DELETE')
  const remaining = (await call(`/chats/${s.chat.id}/memories?characterId=${s.speaker.id}`)).body
  expect(remaining).toHaveLength(2)
  expect(remaining.every((m: any) => m.origin !== 'consolidation')).toBe(true)
})
it('does not strengthen links when the module is off, and failed attempts consume the daily cap without changing memories', async () => {
  const s = await setup()
  const before = (await call(`/chats/${s.chat.id}/memories`)).body
  const p = (await s.prepare()).body
  await call(`/chats/${s.chat.id}/consolidation/${p.id}`, 'POST', { raw: 'invalid' })
  expect((await s.prepare()).body).toBeNull()
  expect((await call(`/chats/${s.chat.id}/memories`)).body).toEqual(before)
  await call(`/worlds/${s.world.id}`, 'PUT', { modules: { deepMemory: false } })
  expect((await call('/memories/recalls', 'POST', { chatId: s.chat.id, characterId: s.speaker.id, messageId: s.source.id, memoryIds: [s.originals[0].id] })).status).toBe(409)
  const links = (await call('/backup')).body.data.memoryLinks.filter((l: any) => l.memoryId === s.originals[0].id)
  expect(links).toHaveLength(1); expect(links[0].weight).toBeNull(); expect(links[0].lastUsedAt).toBe(links[0].createdAt)
})
