import { afterAll, beforeAll, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'
let t: TestServer, cookie = ''
beforeAll(async () => { t = await startTestServer('phase3-links'); cookie = await t.setupOwner('link_owner', 'synthetic-link-password') })
afterAll(async () => { await t?.close() })
const call = (path: string, method = 'GET', body?: unknown) => t.call(path, method, { body, cookie })
const allLinks = async () => (await call('/api/backup')).body.data.memoryLinks as any[]
async function scene(on = true) {
  const world = (await call('/api/worlds', 'POST', { name: 'Synthetic harbor', modules: { deepMemory: on } })).body
  const person = async (name: string) => (await call('/api/characters', 'POST', { card: { name }, worldId: world.id })).body
  const lead = await person('Mara'), newcomer = await person('Tavi'), third = await person('Rowan')
  const chat = (await call('/api/chats', 'POST', { characterId: lead.id, title: 'Harbor', participants: [newcomer.id, third.id] })).body
  const message = async (text: string, at: number) => (await call('/api/messages', 'POST', { chatId: chat.id, role: 'char', speakerId: lead.id, name: 'Mara', text, createdAt: at })).body
  const link = { fromKind: 'person', fromId: lead.id, relation: 'owes', toKind: 'person', toId: third.id }
  const make = async (text: string, extra = {}) => (await call('/api/memories', 'POST', { chatId: chat.id, text, witnesses: [lead.id], about: [lead.id, third.id], createdAt: 1000, ...(on ? { links: [link] } : {}), ...extra })).body
  return { world, lead, newcomer, third, chat, message, make, link }
}
it('validates entity ids, kinds, relations, caps and atomic memory/link batches', async () => {
  const s = await scene()
  const row = { chatId: s.chat.id, text: 'A remembered debt.', witnesses: [s.lead.id], links: [s.link] }
  for (const links of [[{ ...s.link, fromId: 'unknown' }], [{ ...s.link, relation: 'supersedes' }], [{ ...s.link, fromKind: 'memory' }], [{ ...s.link, toKind: 'thing', toId: 'x'.repeat(61) }], [{ ...s.link, validTo: null }], Array(4).fill(s.link)]) {
    expect((await call('/api/memories', 'POST', { ...row, links })).status).toBe(400)
  }
  const member = await t.addMember(cookie, 'link_member', 'synthetic-link-member-password')
  expect((await t.call('/api/memories/batch', 'POST', { cookie: member, body: { memories: [{ ...row, links: [{ fromKind: 'place', fromId: 'quay', relation: 'keeps', toKind: 'thing', toId: 'key' }] }] } })).status).toBe(404)
  expect((await call('/api/memories/batch', 'POST', { memories: [row, { ...row, links: [{ ...s.link, relation: 'unknown' }] }] })).status).toBe(400)
  expect((await call(`/api/chats/${s.chat.id}/memories`)).body).toEqual([])
  expect((await call('/api/memories/batch', 'POST', { memories: Array(11).fill({ ...row, links: Array(3).fill(s.link) }) })).status).toBe(400)
  const made = await s.make('Mara owes Rowan a favor.')
  const visible = (await call(`/api/chats/${s.chat.id}/memories?characterId=${s.lead.id}`)).body
  expect(visible[0].links).toMatchObject([{ memoryId: made.id, validTo: null, closedByMessageId: null }])
  expect((await call(`/api/chats/${s.chat.id}/memories?characterId=${s.newcomer.id}`)).body).toEqual([])
  await call(`/api/memories/${made.id}`, 'PUT', { consolidatedFor: [s.lead.id] })
  expect((await call(`/api/chats/${s.chat.id}/memories?characterId=${s.lead.id}`)).body).toEqual([])
})
for (const on of [false, true]) it(`undoes retirement on rewind with the module ${on ? 'on' : 'off'}, and removes supersedes created by that message`, async () => {
  const s = await scene(on)
  const source = await s.message('An old debt.', 1000)
  const old = await s.make('Mara owes Rowan.', { sourceMessageId: source.id })
  const replacementMessage = await s.message('A replacement state.', 1500)
  const added = await s.make('Mara repaid Rowan.', { sourceMessageId: replacementMessage.id })
  const retiring = await s.message('The debt is settled.', 2000)
  expect((await call(`/api/memories/${old.id}`, 'PUT', { active: false, retiredReason: 'repaid', retiredByMessageId: retiring.id, replacementIds: [added.id] })).status).toBe(200)
  if (on) {
    expect((await allLinks()).find((l) => l.memoryId === old.id).closedByMessageId).toBe(retiring.id)
    expect((await allLinks()).find((l) => l.relation === 'supersedes' && l.memoryId === added.id).toId).toBe(old.id)
    await call(`/api/memories/${old.id}`, 'PUT', { active: true })
    const history = (await call(`/api/chats/${s.chat.id}/memories?characterId=${s.lead.id}`)).body.find((m: any) => m.id === old.id)
    expect(history.links[0].validTo).toEqual(expect.any(Number))
    await call(`/api/memories/${old.id}`, 'PUT', { active: false })
  }
  const fork = (await call(`/api/chats/${s.chat.id}/fork`, 'POST', { messageId: replacementMessage.id })).body
  const forkMemories = (await call(`/api/chats/${fork.id}/memories`)).body
  const oldCopy = forkMemories.find((m: any) => m.text === old.text)
  expect(oldCopy.active).toBe(true)
  expect(oldCopy.retiredByMessageId).toBeUndefined()
  if (on) expect((await allLinks()).find((l) => l.memoryId === oldCopy.id)).toMatchObject({ fromId: s.lead.id, toId: s.third.id, validTo: null })
  expect((await call(`/api/chats/${s.chat.id}/rewind`, 'POST', { messageId: retiring.id })).status).toBe(200)
  const restored = (await call(`/api/chats/${s.chat.id}/memories`)).body.find((m: any) => m.id === old.id)
  expect(restored.active).toBe(true)
  expect(restored.retiredReason).toBeUndefined()
  expect(restored.retiredByMessageId).toBeUndefined()
  if (on) {
    expect((await allLinks()).filter((l) => l.memoryId === old.id).every((l) => l.validTo === null && l.closedByMessageId === null)).toBe(true)
    expect((await allLinks()).some((l) => l.relation === 'supersedes' && l.memoryId === added.id)).toBe(false)
  }
})
it('filters branch tellings and retirement without leaking links into a sibling scene', async () => {
  const s = await scene()
  const memory = await s.make('A private harbor debt.')
  const child = (await call('/api/chats', 'POST', { characterId: s.lead.id })).body
  await call(`/api/chats/${child.id}`, 'PUT', { previousSceneId: s.chat.id })
  const sibling = (await call('/api/chats', 'POST', { characterId: s.lead.id })).body
  await call(`/api/chats/${sibling.id}`, 'PUT', { previousSceneId: s.chat.id })
  const message = (await call('/api/messages', 'POST', { chatId: child.id, role: 'char', text: 'Tavi heard the debt.', createdAt: 2000 })).body
  await call(`/api/memories/${memory.id}/share`, 'POST', { to: [s.newcomer.id], messageId: message.id, chatId: child.id })
  expect((await call(`/api/chats/${child.id}/memories?characterId=${s.newcomer.id}`)).body[0].links).toHaveLength(1)
  expect((await call(`/api/chats/${sibling.id}/memories?characterId=${s.newcomer.id}`)).body).toEqual([])
  await call(`/api/memories/${memory.id}`, 'PUT', { active: false, retiredByMessageId: message.id })
  expect((await call(`/api/chats/${child.id}/memories?characterId=${s.lead.id}`)).body).toEqual([])
  expect((await call(`/api/chats/${sibling.id}/memories?characterId=${s.lead.id}`)).body[0].links[0].validTo).toBeNull()
})
it('records first introductions with witnesses, retracts edits/delete/rewind, and remaps kept introductions on fork', async () => {
  const s = await scene()
  await call(`/api/chats/${s.chat.id}`, 'PUT', { strangers: { [s.newcomer.id]: { ids: [s.third.id], since: 1 } } })
  const first = await s.message('Mara says, "Rowan will help."', 1000)
  const intro = (await call(`/api/chats/${s.chat.id}`)).body.introductions[0]
  expect(intro).toMatchObject({ newcomerId: s.newcomer.id, personId: s.third.id, byId: s.lead.id, messageId: first.id, at: 1000 })
  expect(intro.witnessIds).toContain(s.newcomer.id)
  await s.message('Mara repeats, "Rowan will help."', 1500)
  expect((await call(`/api/chats/${s.chat.id}`)).body.introductions).toHaveLength(1)
  const fork = (await call(`/api/chats/${s.chat.id}/fork`, 'POST', { messageId: first.id })).body
  const copied = (await call(`/api/chats/${fork.id}`)).body.introductions[0]
  expect(copied.messageId).not.toBe(first.id)
  expect((await call(`/api/chats/${fork.id}/messages`)).body.some((m: any) => m.id === copied.messageId)).toBe(true)
  await call(`/api/messages/${first.id}`, 'PUT', { text: 'No name is spoken.' })
  expect((await call(`/api/chats/${s.chat.id}`)).body.introductions[0].at).toBe(1500)
  const latest = (await call(`/api/chats/${s.chat.id}/messages`)).body.find((m: any) => m.createdAt === 1500)
  await call(`/api/messages/${latest.id}`, 'DELETE')
  expect((await call(`/api/chats/${s.chat.id}`)).body.introductions).toEqual([])
  await call(`/api/chats/${fork.id}/rewind`, 'POST', { messageId: copied.messageId })
  expect((await call(`/api/chats/${fork.id}`)).body.introductions ?? []).toEqual([])
})
it('cleans links on every removal path, including incoming supersedes, and preserves real links in backup/restore', async () => {
  const s = await scene()
  const old = await s.make('An old connection.'), next = await s.make('A new connection.')
  const closing = await s.message('A replacement.', 2000)
  await call(`/api/memories/${old.id}`, 'PUT', { active: false, retiredByMessageId: closing.id, replacementIds: [next.id] })
  await call(`/api/memories/${old.id}`, 'DELETE')
  expect((await allLinks()).some((l) => l.memoryId === old.id || (l.toKind === 'memory' && l.toId === old.id))).toBe(false)
  const source = await s.message('A transient event.', 3000)
  const transient = await s.make('A transient connection.', { sourceMessageId: source.id })
  await call(`/api/messages/${source.id}`, 'DELETE')
  expect((await allLinks()).some((l) => l.memoryId === transient.id)).toBe(false)
  const backup = (await call('/api/backup')).body
  expect(backup.data.memoryLinks.some((l: any) => l.memoryId === next.id)).toBe(true)
  await call(`/api/chats/${s.chat.id}/purge`, 'DELETE')
  expect((await allLinks()).some((l) => l.memoryId === next.id)).toBe(false)
  expect((await call('/api/restore', 'POST', backup)).status).toBe(204)
  expect((await allLinks()).some((l) => l.memoryId === next.id)).toBe(true)
  await call(`/api/characters/${s.lead.id}`, 'DELETE')
  expect((await allLinks()).some((l) => l.memoryId === next.id)).toBe(false)
})

it('remaps closed link messages and supersedes memory ids when forking after the retirement', async () => {
  const s = await scene()
  const oldMessage = await s.message('An earlier promise.', 1000)
  const old = await s.make('An earlier remembered promise.', { sourceMessageId: oldMessage.id })
  const closing = await s.message('A changed promise.', 2000)
  const next = await s.make('The changed remembered promise.', { sourceMessageId: closing.id })
  await call(`/api/memories/${old.id}`, 'PUT', { active: false, retiredByMessageId: closing.id, replacementIds: [next.id] })
  const fork = (await call(`/api/chats/${s.chat.id}/fork`, 'POST', { messageId: closing.id })).body
  const copies = (await call(`/api/chats/${fork.id}/memories`)).body
  const oldCopy = copies.find((m: any) => m.text === old.text), newCopy = copies.find((m: any) => m.text === next.text)
  const closed = (await allLinks()).find((l) => l.memoryId === oldCopy.id)
  expect(closed.closedByMessageId).not.toBe(closing.id)
  expect(closed.closedByMessageId).toBe(oldCopy.retiredByMessageId)
  expect(closed.validTo).toEqual(expect.any(Number))
  const supersedes = (await allLinks()).find((l) => l.memoryId === newCopy.id && l.relation === 'supersedes')
  expect(supersedes.fromId).toBe(newCopy.id)
  expect(supersedes.toId).toBe(oldCopy.id)
})
