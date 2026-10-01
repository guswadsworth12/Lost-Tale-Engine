import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let ash = ''

beforeAll(async () => {
  t = await startTestServer('scene-lead-http')
  ash = await t.setupOwner('ash_owner', 'ash-owner-password')
})

afterAll(async () => {
  await t?.close()
})

const recap = (text: string) => ({ recap: { text, presentIds: [] } })
const card = async (name: string) => (await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name } } })).body.id as string

describe('changing a scene\'s lead over HTTP', () => {
  it('hands the lead over with both relationships, and keeps the old lead\'s lines theirs', async () => {
    const [orra, aveline, rend] = [await card('Orra'), await card('Aveline'), await card('Rend')]
    const chat = (await t.call('/api/chats', 'POST', { cookie: ash, body: {
      characterId: orra, participants: [aveline], playerCharacterId: rend, title: 'The Seal', affection: 20,
      scene: { turnPolicy: 'gm', presentCharacterIds: [orra, aveline] },
    } })).body
    await t.call(`/api/chats/${chat.id}`, 'PUT', { cookie: ash, body: { participantRelationships: { [aveline]: { affection: 35 } } } })
    const said = (await t.call('/api/messages', 'POST', { cookie: ash, body: { chatId: chat.id, role: 'char', name: 'Orra', text: 'Hold the line.' } })).body

    expect((await t.call(`/api/chats/${chat.id}/lead`, 'PUT', { cookie: ash, body: { characterId: rend } })).status).toBe(409)
    expect((await t.call(`/api/chats/${chat.id}/lead`, 'PUT', { cookie: ash, body: { characterId: 'nobody' } })).status).toBe(404)

    const changed = await t.call(`/api/chats/${chat.id}/lead`, 'PUT', { cookie: ash, body: { characterId: aveline, keepPrevious: false } })
    expect(changed.status).toBe(200)
    expect(changed.body).toMatchObject({ characterId: aveline, affection: 35, participantRelationships: { [orra]: { affection: 20 } }, scene: { presentCharacterIds: [aveline] } })
    expect(changed.body.participants).toBeUndefined()
    const lines = (await t.call(`/api/chats/${chat.id}/messages`, 'GET', { cookie: ash })).body
    expect(lines.find((m: { id: string }) => m.id === said.id)).toMatchObject({ speakerId: orra, name: 'Orra' })

    // The next scene starts with the new lead; an ended scene keeps its own.
    const next = await t.call(`/api/chats/${chat.id}/next-scene`, 'POST', { cookie: ash, body: recap('The seal held.') })
    expect(next.body.characterId).toBe(aveline)
    expect((await t.call(`/api/chats/${chat.id}/lead`, 'PUT', { cookie: ash, body: { characterId: orra } })).status).toBe(409)

    // Choosing a different lead when ending a scene.
    const third = await t.call(`/api/chats/${next.body.id}/next-scene`, 'POST', { cookie: ash, body: { ...recap('They went below.'), next: { presentIds: [orra], leadId: orra } } })
    expect(third.body).toMatchObject({ characterId: orra, affection: 20, participantRelationships: { [aveline]: { affection: 35 } } })
  })
})

describe('deleting one scene over HTTP', () => {
  it('opens the scene before again, and puts the deleted one back in its place from the trash', async () => {
    const lead = await card('Bea')
    const first = (await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: lead, title: 'Low Tide' } })).body
    const second = (await t.call(`/api/chats/${first.id}/next-scene`, 'POST', { cookie: ash, body: recap('They met at the dock.') })).body
    const third = (await t.call(`/api/chats/${second.id}/next-scene`, 'POST', { cookie: ash, body: recap('The ferry never came.') })).body
    const storyId = second.storyId

    const removed = await t.call(`/api/chats/${third.id}/scene`, 'DELETE', { cookie: ash })
    expect(removed.status).toBe(200)
    expect(removed.body.openSceneId).toBe(second.id)
    const scenes = (await t.call(`/api/stories/${storyId}/scenes`, 'GET', { cookie: ash })).body
    expect(scenes.map((s: { id: string }) => s.id)).toEqual([first.id, second.id])
    const reopened = (await t.call(`/api/chats/${second.id}`, 'GET', { cookie: ash })).body
    expect(reopened.endedAt).toBeUndefined()
    expect(reopened.recap).toBeUndefined()

    const restored = await t.call(`/api/chats/${third.id}/restore`, 'POST', { cookie: ash })
    expect(restored.status).toBe(200)
    expect(restored.body.deletedAt).toBeUndefined()
    expect((await t.call(`/api/chats/${second.id}`, 'GET', { cookie: ash })).body).toMatchObject({ endedAt: expect.any(Number), recap: { text: 'The ferry never came.' } })
    expect((await t.call(`/api/stories/${storyId}/scenes`, 'GET', { cookie: ash })).body.map((s: { id: string }) => s.id)).toEqual([first.id, second.id, third.id])

    // Deleted again and played on from the scene before: it can't go back in its place.
    await t.call(`/api/chats/${third.id}/scene`, 'DELETE', { cookie: ash })
    await t.call('/api/messages', 'POST', { cookie: ash, body: { chatId: second.id, role: 'user', text: 'We take the long way.' } })
    const refused = await t.call(`/api/chats/${third.id}/restore`, 'POST', { cookie: ash })
    expect(refused.status).toBe(409)
    expect(refused.body.error).toMatch(/moved on/)
    // The next scene takes the freed number.
    const redo = await t.call(`/api/chats/${second.id}/next-scene`, 'POST', { cookie: ash, body: recap('They took the long way.') })
    expect(redo.body.sceneNumber).toBe(3)
  })

  it('refuses the only scene of a story, and a chat outside one', async () => {
    const lead = await card('Cal')
    const lone = (await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: lead, title: 'Alone' } })).body
    expect((await t.call(`/api/chats/${lone.id}/scene`, 'DELETE', { cookie: ash })).status).toBe(400)
  })
})
