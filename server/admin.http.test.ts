import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let ash = ''
let bea = ''
let cy = ''

beforeAll(async () => {
  t = await startTestServer('admin-http')
  ash = await t.setupOwner('ash_owner', 'ash-owner-password')
  bea = await t.addMember(ash, 'bea_member', 'bea-member-password')
  cy = await t.addMember(ash, 'cy_member', 'cy-member-password')
})

afterAll(async () => {
  await t?.close()
})

const userId = async (username: string) =>
  ((await t.call('/api/users', 'GET', { cookie: ash })).body as { id: string; username: string }[]).find((u) => u.username === username)!.id

describe('cleaning up after a removed account', () => {
  it('lists what they left behind, then deletes what only they had and hands the owner the rest', async () => {
    const lone = await t.call('/api/characters', 'POST', { cookie: bea, body: { card: { name: 'Lone' } } })
    const loneChat = await t.call('/api/chats', 'POST', { cookie: bea, body: { characterId: lone.body.id, title: 'Alone' } })
    await t.call('/api/messages', 'POST', { cookie: bea, body: { chatId: loneChat.body.id, role: 'user', text: 'Hello?' } })
    const guide = await t.call('/api/characters', 'POST', { cookie: bea, body: { card: { name: 'Guide' }, visibility: 'shared' } })
    const cyChat = await t.call('/api/chats', 'POST', { cookie: cy, body: { characterId: guide.body.id, title: 'Tour' } })
    expect(cyChat.status).toBe(201)

    const beaId = await userId('bea_member')
    expect((await t.call(`/api/users/${beaId}`, 'DELETE', { cookie: ash })).status).toBe(204)

    // Owners only.
    expect((await t.call('/api/admin/leftovers', 'GET', { cookie: cy })).status).toBe(403)
    const leftovers = await t.call('/api/admin/leftovers', 'GET', { cookie: ash })
    expect(leftovers.body).toEqual([
      expect.objectContaining({ formerOwnerId: beaId, username: 'bea_member', counts: { characters: 2, chats: 1 }, total: 3, shared: 1 }),
    ])
    // Nobody can reach them meanwhile, the owner included.
    expect((await t.call(`/api/characters/${lone.body.id}`, 'GET', { cookie: ash })).status).toBe(404)

    expect((await t.call(`/api/admin/leftovers/${await userId('cy_member')}`, 'POST', { cookie: ash, body: { action: 'delete' } })).status).toBe(400)
    const cleaned = await t.call(`/api/admin/leftovers/${beaId}`, 'POST', { cookie: ash, body: { action: 'delete' } })
    expect(cleaned.body).toEqual({ adopted: 1, deleted: 2 })

    // Hers alone: gone, with the chat and its messages. Shared, and in Cy's story: now the owner's, still shared.
    expect((await t.call(`/api/characters/${lone.body.id}`, 'GET', { cookie: ash })).status).toBe(404)
    expect((await t.call(`/api/chats/${loneChat.body.id}`, 'GET', { cookie: ash })).status).toBe(404)
    expect((await t.call('/api/messages/search?q=Hello', 'GET', { cookie: ash })).body).toEqual([])
    const kept = await t.call(`/api/characters/${guide.body.id}`, 'GET', { cookie: ash })
    expect(kept.body).toMatchObject({ ownerUserId: expect.any(String), visibility: 'shared' })
    expect((await t.call(`/api/chats/${cyChat.body.id}`, 'GET', { cookie: cy })).status).toBe(200)
    expect((await t.call('/api/admin/leftovers', 'GET', { cookie: ash })).body).toEqual([])
    // Backed up before anything was deleted.
    expect(fs.readdirSync(path.join(t.dataDir, 'backups')).some((f) => f.startsWith('before-cleanup-'))).toBe(true)
  })

  it('can take everything over instead, private things staying private', async () => {
    const dot = await t.addMember(ash, 'dot_member', 'dot-member-password')
    const world = await t.call('/api/worlds', 'POST', { cookie: dot, body: { name: 'Quiet Isle', description: '', lorebook: { entries: [] } } })
    const dotId = await userId('dot_member')
    await t.call(`/api/users/${dotId}`, 'DELETE', { cookie: ash })
    expect((await t.call(`/api/admin/leftovers/${dotId}`, 'POST', { cookie: ash, body: { action: 'adopt' } })).body).toEqual({ adopted: 1, deleted: 0 })
    expect((await t.call(`/api/worlds/${world.body.id}`, 'GET', { cookie: ash })).body).toMatchObject({ name: 'Quiet Isle', visibility: 'private' })
    expect((await t.call(`/api/worlds/${world.body.id}`, 'GET', { cookie: cy })).status).toBe(404)
  })
})
