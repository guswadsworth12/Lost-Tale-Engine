import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let owner = ''

beforeAll(async () => {
  t = await startTestServer('rewind-http')
  owner = await t.setupOwner('rewind_owner', 'rewind-owner-password')
})

afterAll(async () => {
  await t?.close()
})

describe('rewinding a scene over HTTP (#57)', () => {
  it('undoes the messages and everything they did: memories, facts, relationship changes, objectives, scene state, and the clock when asked', async () => {
    const call = (route: string, method: string, body?: unknown) => t.call(route, method, { cookie: owner, body })
    const world = (await call('/api/worlds', 'POST', { name: 'Harbor', description: '', lorebook: { entries: [] } })).body
    await call(`/api/worlds/${world.id}`, 'PUT', { currentDay: 5, currentPhaseIndex: 0 })
    const bea = (await call('/api/characters', 'POST', { card: { name: 'Bea' }, worldId: world.id })).body
    const chat = (await call('/api/chats', 'POST', { characterId: bea.id, title: 'Docks', affection: 0 })).body
    const say = async (text: string, at: number) => (await call('/api/messages', 'POST', { chatId: chat.id, role: 'user', name: 'You', text, createdAt: at })).body

    const m1 = await say('Hello.', 1000)
    await call(`/api/chats/${chat.id}`, 'PUT', { affection: 10, gmNotes: 'kept' })
    const m2 = await say('I give her a shell.', 2000)
    // What that turn did: affection, a date, a fact, a relationship change, an objective, a memory, the clock.
    await call(`/api/chats/${chat.id}`, 'PUT', { affection: 30, activeEvent: { id: 'date', title: 'Walk' } })
    await call('/api/chat-facts', 'POST', { chatId: chat.id, text: 'Bea keeps the shell.', sourceMessageId: m2.id })
    await call('/api/relationship-events', 'POST', { chatId: chat.id, reason: 'A gift', deltas: { affection: 20 }, sourceMessageId: m2.id })
    await call('/api/objectives', 'POST', { chatId: chat.id, title: 'Walk the pier', status: 'active', tasks: [], createdBy: 'ai' })
    await call('/api/memories', 'POST', { chatId: chat.id, text: 'You gave Bea a shell.', witnesses: [bea.id], sourceMessageId: m2.id })
    await call(`/api/worlds/${world.id}`, 'PUT', { currentDay: 6, currentPhaseIndex: 1 })
    await say('We walk.', 3000)

    const preview = await call(`/api/chats/${chat.id}/rewind`, 'POST', { messageId: m2.id, dryRun: true })
    expect(preview.status).toBe(200)
    expect(preview.body).toEqual({
      summary: { messages: 2, facts: 1, relationshipChanges: 1, objectivesRemoved: 1, objectivesReopened: 0, stateRestored: true },
      clock: { day: 5, phaseIndex: 0, suggested: true },
    })
    // A preview changes nothing.
    expect((await call(`/api/chats/${chat.id}/messages`, 'GET')).body).toHaveLength(3)

    const done = await call(`/api/chats/${chat.id}/rewind`, 'POST', { messageId: m2.id, restoreClock: true })
    expect(done.status).toBe(200)
    expect(done.body.clockRestored).toBe(true)
    expect(fs.existsSync(path.join(t.dataDir, 'backups', done.body.backup))).toBe(true)

    expect((await call(`/api/chats/${chat.id}/messages`, 'GET')).body.map((m: { id: string }) => m.id)).toEqual([m1.id])
    const after = (await call(`/api/chats/${chat.id}`, 'GET')).body
    expect(after.affection).toBe(10)
    expect(after.activeEvent).toBeUndefined()
    expect(after.gmNotes).toBe('kept')
    expect((await call(`/api/chats/${chat.id}/chat-facts`, 'GET')).body).toEqual([])
    expect((await call(`/api/chats/${chat.id}/relationship-events`, 'GET')).body).toEqual([])
    expect((await call(`/api/objectives?chatId=${chat.id}`, 'GET')).body).toEqual([])
    expect((await call(`/api/chats/${chat.id}/memories`, 'GET')).body).toEqual([])
    expect((await call(`/api/worlds/${world.id}`, 'GET')).body).toMatchObject({ currentDay: 5, currentPhaseIndex: 0 })
  })

  it('leaves the clock alone unless asked, refuses an ended scene, and answers 404 for a message elsewhere', async () => {
    const call = (route: string, method: string, body?: unknown) => t.call(route, method, { cookie: owner, body })
    const world = (await call('/api/worlds', 'POST', { name: 'Fen', description: '', lorebook: { entries: [] } })).body
    const kai = (await call('/api/characters', 'POST', { card: { name: 'Kai' }, worldId: world.id })).body
    const chat = (await call('/api/chats', 'POST', { characterId: kai.id, title: 'Reeds' })).body
    const m1 = (await call('/api/messages', 'POST', { chatId: chat.id, role: 'user', name: 'You', text: 'Hi', createdAt: 10 })).body
    await call(`/api/worlds/${world.id}`, 'PUT', { currentDay: 3 })
    const kept = await call(`/api/chats/${chat.id}/rewind`, 'POST', { messageId: m1.id })
    expect(kept.body.clockRestored).toBe(false)
    expect((await call(`/api/worlds/${world.id}`, 'GET')).body.currentDay).toBe(3)

    expect((await call(`/api/chats/${chat.id}/rewind`, 'POST', { messageId: 'elsewhere' })).status).toBe(404)
    const m2 = (await call('/api/messages', 'POST', { chatId: chat.id, role: 'user', name: 'You', text: 'Again', createdAt: 20 })).body
    await call(`/api/chats/${chat.id}`, 'PUT', { endedAt: 30 })
    expect((await call(`/api/chats/${chat.id}/rewind`, 'POST', { messageId: m2.id })).status).toBe(409)
  })
})
