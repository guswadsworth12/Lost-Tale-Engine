import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RED_PNG, startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let ash = ''
let bea = ''

beforeAll(async () => {
  t = await startTestServer('moments-http')
  ash = await t.setupOwner('ash_owner', 'ash-owner-password')
  bea = await t.addMember(ash, 'bea_member', 'bea-member-password')
})

afterAll(async () => {
  await t?.close()
})

describe('story moments over HTTP', () => {
  it('saves a moment\'s picture to disk under its story, edits its caption, and deletes both', async () => {
    const lead = (await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Cole' } } })).body
    const first = (await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: lead.id, title: 'Night Watch' } })).body
    const message = (await t.call('/api/messages', 'POST', { cookie: ash, body: { chatId: first.id, role: 'char', name: 'Cole', text: 'The lamp goes out.' } })).body

    // A lone scene is its own story.
    const lone = await t.call(`/api/chats/${first.id}/moments`, 'POST', { cookie: ash, body: { kind: 'moment', caption: 'The lamp goes out', prompt: 'A dark lighthouse.', messageId: message.id, characterIds: [lead.id], image: RED_PNG } })
    expect(lone.status).toBe(201)
    expect(lone.body).toMatchObject({ storyId: first.id, chatId: first.id, messageId: message.id, kind: 'moment', createdBy: expect.any(String) })
    const file = path.join(t.dataDir, lone.body.imageUrl.replace(/^\//, ''))
    expect(fs.existsSync(file)).toBe(true)
    expect((await t.call(lone.body.imageUrl, 'GET', { cookie: ash })).status).toBe(200)

    // A scene of a story files it under the story, with its chapter.
    const second = (await t.call(`/api/chats/${first.id}/next-scene`, 'POST', { cookie: ash, body: { recap: { text: 'The lamp went out.', presentIds: [] } } })).body
    const inStory = (await t.call(`/api/chats/${second.id}/moments`, 'POST', { cookie: ash, body: { kind: 'background', caption: 'The tower', prompt: 'x', image: RED_PNG } })).body
    expect(inStory).toMatchObject({ storyId: second.storyId, chatId: second.id, chapterId: 'chapter-1' })

    expect((await t.call('/api/moments', 'GET', { cookie: ash })).body.map((m: { id: string }) => m.id)).toEqual([lone.body.id, inStory.id])
    const renamed = await t.call(`/api/moments/${lone.body.id}`, 'PATCH', { cookie: ash, body: { caption: ' The dark tower ' } })
    expect(renamed.body.caption).toBe('The dark tower')
    expect((await t.call(`/api/moments/${lone.body.id}`, 'PATCH', { cookie: ash, body: { imageUrl: '/elsewhere.png' } })).status).toBe(400)

    expect((await t.call(`/api/moments/${lone.body.id}`, 'DELETE', { cookie: ash })).status).toBe(204)
    expect(fs.existsSync(file)).toBe(false)
    expect((await t.call('/api/moments', 'GET', { cookie: ash })).body).toHaveLength(1)
  })

  it('hides a trashed scene\'s moments, and deletes them with their pictures when it is purged', async () => {
    const lead = (await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Wren' } } })).body
    const chat = (await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: lead.id, title: 'Low Tide' } })).body
    const moment = (await t.call(`/api/chats/${chat.id}/moments`, 'POST', { cookie: ash, body: { kind: 'moment', caption: 'Low tide', prompt: 'x', image: RED_PNG } })).body
    const file = path.join(t.dataDir, moment.imageUrl.replace(/^\//, ''))
    const ids = async () => (await t.call('/api/moments', 'GET', { cookie: ash })).body.map((m: { id: string }) => m.id)

    await t.call(`/api/chats/${chat.id}`, 'DELETE', { cookie: ash })
    expect(await ids()).not.toContain(moment.id)
    await t.call(`/api/chats/${chat.id}/restore`, 'POST', { cookie: ash })
    expect(await ids()).toContain(moment.id)

    expect((await t.call(`/api/chats/${chat.id}/purge`, 'DELETE', { cookie: ash })).status).toBe(204)
    expect(await ids()).not.toContain(moment.id)
    expect(fs.existsSync(file)).toBe(false)
  })

  it('refuses a moment without a picture or kind, and needs a sign-in', async () => {
    const lead = (await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Wren' } } })).body
    const chat = (await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: lead.id, title: 'Dock' } })).body
    expect((await t.call(`/api/chats/${chat.id}/moments`, 'POST', { cookie: ash, body: { kind: 'moment', image: '/not/data.png' } })).status).toBe(400)
    expect((await t.call(`/api/chats/${chat.id}/moments`, 'POST', { cookie: ash, body: { kind: 'other', image: RED_PNG } })).status).toBe(400)
    expect((await t.call('/api/moments', 'GET')).status).toBe(401)
  })

  it('shows a private story\'s moments only to those who can see it', async () => {
    const hidden = (await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Ash' }, visibility: 'private' } })).body
    const chat = (await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: hidden.id, title: 'Private' } })).body
    const moment = (await t.call(`/api/chats/${chat.id}/moments`, 'POST', { cookie: ash, body: { kind: 'portrait', image: RED_PNG } })).body
    expect((await t.call('/api/moments', 'GET', { cookie: bea })).body.map((m: { id: string }) => m.id)).not.toContain(moment.id)
    expect((await t.call(`/api/moments/${moment.id}`, 'DELETE', { cookie: bea })).status).toBe(404)
    expect((await t.call(`/api/chats/${chat.id}/moments`, 'POST', { cookie: bea, body: { kind: 'moment', image: RED_PNG } })).status).toBe(404)
  })
})
