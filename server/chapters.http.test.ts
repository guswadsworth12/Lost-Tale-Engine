import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let ash = ''

beforeAll(async () => {
  t = await startTestServer('chapters-http')
  ash = await t.setupOwner('ash_owner', 'ash-owner-password')
})

afterAll(async () => {
  await t?.close()
})

const recap = (text: string) => ({ recap: { text, presentIds: [] } })

describe('chapters over HTTP', () => {
  it('plays a story from before chapters on unchanged, then names, ends, and branches its chapters', async () => {
    const lead = await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Bea' } } })
    const first = await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: lead.body.id, title: 'Homecoming' } })

    // Ending a scene the way it always worked: no chapter fields asked for, none needed.
    const second = await t.call(`/api/chats/${first.body.id}/next-scene`, 'POST', { cookie: ash, body: recap('They met at the dock.') })
    expect(second.status).toBe(201)
    const storyId = second.body.storyId
    expect((await t.call(`/api/stories/${storyId}`, 'GET', { cookie: ash })).body).not.toHaveProperty('chapters')
    expect(second.body).toMatchObject({ sceneNumber: 2, chapterId: 'chapter-1', chapterSceneNumber: 2 })

    // Naming the chapter writes the implicit first chapter down.
    const named = await t.call(`/api/chats/${second.body.id}/chapter`, 'PUT', { cookie: ash, body: { title: 'The Fog', goal: 'Get home before the tide.' } })
    expect(named.status).toBe(200)
    expect(named.body.chapters).toMatchObject([{ id: 'chapter-1', number: 1, title: 'The Fog', goal: 'Get home before the tide.' }])

    // Ending the chapter records its recap and opens scene 1 of chapter 2.
    const third = await t.call(`/api/chats/${second.body.id}/next-scene`, 'POST', { cookie: ash, body: {
      ...recap('The ferry never came.'),
      chapter: { recap: { text: 'They reached the coast, but the ferry was gone.', openThreads: ['Where did the ferry go?'] }, next: { title: 'Low Tide' } },
    } })
    expect(third.status).toBe(201)
    const story = (await t.call(`/api/stories/${storyId}`, 'GET', { cookie: ash })).body
    expect(story.chapters).toMatchObject([
      { id: 'chapter-1', title: 'The Fog', endedAt: expect.any(Number), recap: { openThreads: ['Where did the ferry go?'], sceneIds: [first.body.id, second.body.id] } },
      { id: third.body.chapterId, number: 2, title: 'Low Tide' },
    ])
    expect(third.body).toMatchObject({ sceneNumber: 3, chapterSceneNumber: 1, previousSceneId: second.body.id })

    // Earlier scenes keep their recaps and their place; the story's scenes still come back in order.
    const scenes = (await t.call(`/api/stories/${storyId}/scenes`, 'GET', { cookie: ash })).body
    expect(scenes.map((s: { id: string }) => s.id)).toEqual([first.body.id, second.body.id, third.body.id])
    expect(scenes[0].recap.text).toBe('They met at the dock.')
    expect(scenes[1].recap.text).toBe('The ferry never came.')

    // A fork of the chapter's last scene is another take on it: it plays on in chapter 1, and can't end it twice.
    const fork = await t.call(`/api/chats/${second.body.id}/fork`, 'POST', { cookie: ash, body: {} })
    expect(fork.body).toMatchObject({ chapterId: 'chapter-1', chapterSceneNumber: 2 })
    const refused = await t.call(`/api/chats/${fork.body.id}/next-scene`, 'POST', { cookie: ash, body: { ...recap('Another way.'), chapter: { recap: { text: 'x' } } } })
    expect(refused.status).toBe(409)
    const onward = await t.call(`/api/chats/${fork.body.id}/next-scene`, 'POST', { cookie: ash, body: recap('Another way.') })
    expect(onward.body).toMatchObject({ chapterId: 'chapter-1', chapterSceneNumber: 3 })

    // The ended chapter's recap stays reviewable and correctable.
    const fixed = await t.call(`/api/chats/${third.body.id}/chapter`, 'PUT', { cookie: ash, body: { chapterId: 'chapter-1', recap: { text: 'They reached the coast; the ferry had left without them.' } } })
    expect(fixed.body.chapters[0].recap.text).toContain('without them')
    expect((await t.call(`/api/chats/${third.body.id}/chapter`, 'PUT', { cookie: ash, body: { recap: { text: 'too soon' } } })).status).toBe(409)
  })

  it('lets a lone chat name its first chapter from the start', async () => {
    const lead = await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Cole' } } })
    const chat = await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: lead.body.id, title: 'Night Watch' } })
    const story = await t.call(`/api/chats/${chat.body.id}/chapter`, 'PUT', { cookie: ash, body: { title: 'The Lamp' } })
    expect(story.body).toMatchObject({ title: 'Night Watch', chapters: [{ id: 'chapter-1', title: 'The Lamp' }] })
    expect((await t.call(`/api/chats/${chat.body.id}`, 'GET', { cookie: ash })).body).toMatchObject({ storyId: story.body.id, sceneNumber: 1, chapterId: 'chapter-1' })
  })
})
