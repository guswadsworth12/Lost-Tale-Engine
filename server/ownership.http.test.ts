import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RED_PNG, startTestServer, type TestServer } from './httpTestServer.ts'

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
    // Private to its maker unless shared on purpose.
    expect(world.body).toMatchObject({ visibility: 'private' })
    expect(world.body.ownerUserId).not.toBe('someone-else')
    expect(ids(await t.call('/api/worlds', 'GET', { cookie: bea }))).not.toContain(world.body.id)
    await t.call(`/api/worlds/${world.body.id}`, 'PUT', { cookie: ash, body: { visibility: 'shared' } })
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

    // Sharing the world again shares the world, never the story played in it.
    await t.call(route, 'PUT', { cookie: ash, body: { visibility: 'shared' } })
    expect((await t.call(route, 'GET', { cookie: bea })).status).toBe(200)
    expect((await t.call(`/api/chats/${chat.body.id}`, 'GET', { cookie: bea })).status).toBe(404)
    expect(ids(await t.call('/api/stories', 'GET', { cookie: bea }))).not.toContain(next.body.storyId)
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

  it('gives rows made before ownership to the site owner, who alone can share them', async () => {
    const { worldStore, chatStore } = await import('./db.ts')
    const legacy = worldStore.insert({ id: crypto.randomUUID(), name: 'Old world', description: '', lorebook: { entries: [] }, createdAt: 1, updatedAt: 1 })
    const oldStory = chatStore.insert({ id: crypto.randomUUID(), characterId: crypto.randomUUID(), title: 'Old story', createdAt: 1, updatedAt: 1 })
    expect(ids(await t.call('/api/worlds', 'GET', { cookie: bea }))).not.toContain(legacy.id)
    expect((await t.call(`/api/worlds/${legacy.id}`, 'PUT', { cookie: bea, body: { description: 'Edited by Bea' } })).status).toBe(404)
    expect(ids(await t.call('/api/worlds', 'GET', { cookie: ash }))).toContain(legacy.id)
    expect(ids(await t.call('/api/chats', 'GET', { cookie: ash }))).toContain(oldStory.id)
    expect(ids(await t.call('/api/chats', 'GET', { cookie: bea }))).not.toContain(oldStory.id)
    const shared = await t.call(`/api/worlds/${legacy.id}`, 'PUT', { cookie: ash, body: { visibility: 'shared' } })
    expect(shared.body).toMatchObject({ visibility: 'shared' })
    expect(shared.body.ownerUserId).toBeTruthy()
    expect((await t.call(`/api/worlds/${legacy.id}`, 'GET', { cookie: bea })).status).toBe(200)
  })

  it("keeps a member's stories from everyone else, the site owner included", async () => {
    const card = await t.call('/api/characters', 'POST', { cookie: bea, body: { card: { name: 'Pip' } } })
    const chat = await t.call('/api/chats', 'POST', { cookie: bea, body: { characterId: card.body.id, title: 'Bea alone' } })
    expect(chat.body.ownerUserId).toBeTruthy()
    expect(ids(await t.call('/api/chats', 'GET', { cookie: ash }))).not.toContain(chat.body.id)
    expect((await t.call(`/api/chats/${chat.body.id}`, 'GET', { cookie: ash })).status).toBe(404)
    expect(ids(await t.call('/api/characters', 'GET', { cookie: ash }))).not.toContain(card.body.id)
  })

  it('keeps personal records to their owner', async () => {
    const thread = await t.call('/api/assistant-threads', 'POST', { cookie: ash, body: { title: 'Plans', messages: [] } })
    const preset = await t.call('/api/presets', 'POST', { cookie: ash, body: { name: 'Mine', params: {} } })
    const theme = await t.call('/api/themes', 'POST', { cookie: ash, body: { name: 'Dusk', tokens: {} } })
    const template = await t.call('/api/instruct-templates', 'POST', { cookie: ash, body: { name: 'Plain' } })
    for (const [list, row] of [['/api/assistant-threads', thread], ['/api/presets', preset], ['/api/themes', theme], ['/api/instruct-templates', template]] as const) {
      expect(ids(await t.call(list, 'GET', { cookie: ash })), list).toContain(row.body.id)
      expect(ids(await t.call(list, 'GET', { cookie: bea })), list).not.toContain(row.body.id)
    }
    expect((await t.call(`/api/assistant-threads/${thread.body.id}`, 'GET', { cookie: bea })).status).toBe(404)
    expect((await t.call(`/api/assistant-threads/${thread.body.id}`, 'PUT', { cookie: bea, body: { title: 'Mine now' } })).status).toBe(404)
    expect((await t.call(`/api/presets/${preset.body.id}`, 'DELETE', { cookie: bea })).status).toBe(404)
    expect(ids(await t.call('/api/presets', 'GET', { cookie: ash }))).toContain(preset.body.id)
  })

  it("serves a character's files only to someone who can see it", async () => {
    const hidden = await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Vell' }, avatarDataUrl: RED_PNG } })
    const url = hidden.body.avatarDataUrl as string
    expect(url).toMatch(/^\/avatars\/characters\//)
    expect((await t.call(url, 'GET', { cookie: ash })).status).toBe(200)
    expect((await t.call(url, 'GET', { cookie: bea })).status).toBe(404)
    await t.call(`/api/characters/${hidden.body.id}`, 'PUT', { cookie: ash, body: { visibility: 'shared' } })
    expect((await t.call(url, 'GET', { cookie: bea })).status).toBe(200)
  })

  it("keeps the site owner's voice samples and voice server theirs", async () => {
    expect((await t.call('/api/voice-samples', 'GET', { cookie: bea })).body).toEqual([])
    expect((await t.call('/api/voice-samples', 'POST', { cookie: bea, body: { label: 'x', dataUrl: 'data:audio/wav;base64,AAAA' } })).status).toBe(403)
    expect((await t.call('/api/tts/luxtts', 'POST', { cookie: bea, body: { text: 'hi' } })).status).toBe(403)
  })
})
