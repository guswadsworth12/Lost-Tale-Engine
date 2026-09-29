import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let ash = ''
let bea = ''

beforeAll(async () => {
  t = await startTestServer('ownership-http')
  ash = await t.setupOwner('ash_owner', 'ash-owner-password')
  bea = await t.addMember(ash, 'bea_member', 'bea-member-password')
})

afterAll(async () => {
  await t?.close()
})

const ids = (reply: { body: { id: string }[] }) => reply.body.map((row) => row.id)

describe('private worlds, characters, and books', () => {
  it('keeps a private world and everything using it away from everyone but its owner', async () => {
    const world = await t.call('/api/worlds', 'POST', { cookie: ash, body: { name: 'Salt Coast', description: '', lorebook: { entries: [] }, ownerUserId: 'someone-else' } })
    expect(world.status).toBe(201)
    expect(world.body).toMatchObject({ visibility: 'shared' })
    expect(world.body.ownerUserId).not.toBe('someone-else')
    expect(ids(await t.call('/api/worlds', 'GET', { cookie: bea }))).toContain(world.body.id)

    // Only the owner changes who sees it.
    expect((await t.call(`/api/worlds/${world.body.id}`, 'PUT', { cookie: bea, body: { visibility: 'private' } })).status).toBe(403)
    expect((await t.call(`/api/worlds/${world.body.id}`, 'PUT', { cookie: ash, body: { visibility: 'private' } })).body.visibility).toBe('private')

    const route = `/api/worlds/${world.body.id}`
    expect(ids(await t.call('/api/worlds', 'GET', { cookie: bea }))).not.toContain(world.body.id)
    expect((await t.call(route, 'GET', { cookie: bea })).status).toBe(404)
    expect((await t.call(route, 'PUT', { cookie: bea, body: { name: 'Mine now' } })).status).toBe(404)
    expect((await t.call(route, 'DELETE', { cookie: bea })).status).toBe(404)
    expect((await t.call(route, 'GET', { cookie: ash })).body.name).toBe('Salt Coast')

    // Bea can't put a character in it, or reach one living there.
    expect((await t.call('/api/characters', 'POST', { cookie: bea, body: { card: { name: 'Cole' }, worldId: world.body.id } })).status).toBe(404)
    const lead = await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Wren' }, worldId: world.body.id } })
    expect(lead.status).toBe(201)
    const chat = await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: lead.body.id, title: 'Fog' } })
    const message = await t.call('/api/messages', 'POST', { cookie: ash, body: { chatId: chat.body.id, role: 'user', text: 'The lighthouse is dark.' } })
    expect(message.status).toBe(201)

    expect(ids(await t.call('/api/chats', 'GET', { cookie: bea }))).not.toContain(chat.body.id)
    expect(ids(await t.call('/api/chats', 'GET', { cookie: ash }))).toContain(chat.body.id)
    for (const path of [`/api/chats/${chat.body.id}`, `/api/chats/${chat.body.id}/messages`, `/api/messages/${message.body.id}`, `/api/characters/${lead.body.id}`, `/api/objectives?chatId=${chat.body.id}`]) {
      expect((await t.call(path, 'GET', { cookie: bea })).status, path).toBe(404)
    }
    expect((await t.call('/api/messages', 'POST', { cookie: bea, body: { chatId: chat.body.id, role: 'user', text: 'Hi' } })).status).toBe(404)
    expect((await t.call('/api/messages/search?q=lighthouse', 'GET', { cookie: bea })).body).toEqual([])
    expect((await t.call('/api/messages/search?q=lighthouse', 'GET', { cookie: ash })).body).toHaveLength(1)
    expect((await t.call(`/api/characters/roster?worldId=${world.body.id}`, 'GET', { cookie: bea })).body).toEqual([])
    expect((await t.call('/api/assistant-library/search?q=lighthouse', 'GET', { cookie: bea })).body).toEqual([])

    // A story from its scenes goes the same way.
    const next = await t.call(`/api/chats/${chat.body.id}/next-scene`, 'POST', { cookie: ash, body: { recap: { text: 'The light went out.', presentIds: [] } } })
    expect(next.status).toBe(201)
    expect(ids(await t.call('/api/stories', 'GET', { cookie: bea }))).not.toContain(next.body.storyId)
    expect((await t.call(`/api/stories/${next.body.storyId}`, 'GET', { cookie: bea })).status).toBe(404)
    expect(ids(await t.call('/api/stories', 'GET', { cookie: ash }))).toContain(next.body.storyId)

    // Shared again, it's everyone's again.
    await t.call(route, 'PUT', { cookie: ash, body: { visibility: 'shared' } })
    expect((await t.call(`/api/chats/${chat.body.id}`, 'GET', { cookie: bea })).status).toBe(200)
  })

  it('keeps a private character out of anyone else\'s chats', async () => {
    const hidden = await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Lyra' }, visibility: 'private' } })
    expect(hidden.body).toMatchObject({ visibility: 'private' })
    const mine = await t.call('/api/characters', 'POST', { cookie: bea, body: { card: { name: 'Cole' } } })
    expect(ids(await t.call('/api/characters', 'GET', { cookie: bea }))).not.toContain(hidden.body.id)
    expect((await t.call('/api/chats', 'POST', { cookie: bea, body: { characterId: hidden.body.id } })).status).toBe(404)
    expect((await t.call('/api/chats', 'POST', { cookie: bea, body: { characterId: mine.body.id, participants: [hidden.body.id] } })).status).toBe(404)
    const chat = await t.call('/api/chats', 'POST', { cookie: bea, body: { characterId: mine.body.id } })
    expect((await t.call(`/api/chats/${chat.body.id}`, 'PUT', { cookie: bea, body: { playerCharacterId: hidden.body.id } })).status).toBe(404)
  })

  it('keeps private world-info books to their owner', async () => {
    const book = await t.call('/api/world-info-books', 'POST', { cookie: ash, body: { name: 'Secrets', book: { entries: [] }, visibility: 'private' } })
    expect(book.status).toBe(201)
    expect(ids(await t.call('/api/world-info-books', 'GET', { cookie: bea }))).not.toContain(book.body.id)
    expect((await t.call(`/api/world-info-books/${book.body.id}`, 'PUT', { cookie: bea, body: { name: 'Mine' } })).status).toBe(404)
    expect((await t.call('/api/world-info-books', 'POST', { cookie: bea, body: { id: book.body.id, name: 'Hijack', book: { entries: [] } } })).body.id).not.toBe(book.body.id)
  })

  it('leaves rows made before ownership shared, and only the site owner can take one private', async () => {
    const { worldStore } = await import('./db.ts')
    const legacy = worldStore.insert({ id: crypto.randomUUID(), name: 'Old world', description: '', lorebook: { entries: [] }, createdAt: 1, updatedAt: 1 })
    expect(ids(await t.call('/api/worlds', 'GET', { cookie: bea }))).toContain(legacy.id)
    expect((await t.call(`/api/worlds/${legacy.id}`, 'PUT', { cookie: bea, body: { visibility: 'private' } })).status).toBe(403)
    expect((await t.call(`/api/worlds/${legacy.id}`, 'PUT', { cookie: bea, body: { description: 'Edited by Bea' } })).status).toBe(200)
    const taken = await t.call(`/api/worlds/${legacy.id}`, 'PUT', { cookie: ash, body: { visibility: 'private' } })
    expect(taken.body).toMatchObject({ visibility: 'private', description: 'Edited by Bea' })
    expect(taken.body.ownerUserId).toBeTruthy()
    expect((await t.call(`/api/worlds/${legacy.id}`, 'GET', { cookie: bea })).status).toBe(404)
  })
})
