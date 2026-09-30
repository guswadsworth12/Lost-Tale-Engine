import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveStage } from '../src/lib/vn/stageDirection.ts'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let ash = ''

beforeAll(async () => {
  t = await startTestServer('stage-http')
  ash = await t.setupOwner('ash_owner', 'ash-owner-password')
})

afterAll(async () => {
  await t?.close()
})

describe('Visual Novel direction over HTTP', () => {
  it('keeps a saved three-character layout through a reload and reuses it in another scene', async () => {
    const world = (await t.call('/api/worlds', 'POST', { cookie: ash, body: { name: 'Harbor', description: '', lorebook: { entries: [] } } })).body
    const [bea, cole, wren] = await Promise.all(['Bea', 'Cole', 'Wren'].map(async (name) =>
      (await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name }, worldId: world.id } })).body.id as string))
    const layout = {
      id: 'table', name: 'At the table', width: 90, depth: 50, focus: 'step', updatedAt: 5,
      cues: { [bea]: { x: 0.3, depth: 0.2, enter: 'fade' }, [cole]: { x: 0.5, depth: 0.8, scale: 1.2 }, [wren]: { x: 0.7, depth: 0.2, exit: 'slide-right' } },
    }
    const saved = await t.call(`/api/worlds/${world.id}`, 'PUT', { cookie: ash, body: { stageLayouts: [layout, { name: 'No id' }] } })
    expect(saved.body.stageLayouts).toEqual([layout])

    const first = (await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: bea, participants: [cole, wren], title: 'Supper' } })).body
    const second = (await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: cole, participants: [bea, wren], title: 'Breakfast' } })).body
    await t.call(`/api/chats/${first.id}`, 'PUT', { cookie: ash, body: { stage: { layoutId: 'table' } } })
    // The second scene uses the same layout but pins Wren somewhere else.
    await t.call(`/api/chats/${second.id}`, 'PUT', { cookie: ash, body: { stage: { layoutId: 'table', cues: { [wren]: { x: 0.4, depth: 0.6 } } } } })

    // A reload reads everything back from the server.
    const layouts = (await t.call(`/api/worlds/${world.id}`, 'GET', { cookie: ash })).body.stageLayouts
    const one = (await t.call(`/api/chats/${first.id}`, 'GET', { cookie: ash })).body
    const two = (await t.call(`/api/chats/${second.id}`, 'GET', { cookie: ash })).body
    expect(one.stage).toEqual({ layoutId: 'table' })
    const a = resolveStage([bea, cole, wren], bea, one.stage, layouts)
    const b = resolveStage([cole, bea, wren], cole, two.stage, layouts)
    const at = (stage: typeof a, id: string) => stage.figures.find((f) => f.id === id)!
    expect(at(b, bea).point).toEqual(at(a, bea).point)
    expect(at(b, cole)).toMatchObject({ point: at(a, cole).point, scale: 1.2 })
    expect(at(a, wren)).toMatchObject({ point: { x: 0.7, depth: 0.2 }, exit: 'slide-right', source: 'layout' })
    expect(at(b, wren)).toMatchObject({ point: { x: 0.4, depth: 0.6 }, source: 'pinned' })

    // The next scene opens with the cast where the last one left them.
    const next = await t.call(`/api/chats/${second.id}/next-scene`, 'POST', { cookie: ash, body: { recap: { text: 'They ate.', presentIds: [] } } })
    expect(next.body.stage).toEqual(two.stage)
  })

  it('stores only known shapes, and returns a scene to automatic direction', async () => {
    const lead = (await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Ash' } } })).body.id
    const chat = (await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: lead } })).body
    const odd = await t.call(`/api/chats/${chat.id}`, 'PUT', { cookie: ash, body: { stage: { width: 400, focus: 'spin', cues: { [lead]: { x: 0.5, depth: 7, enter: 'teleport' }, junk: 'x' } } } })
    expect(odd.body.stage).toEqual({ width: 100, cues: { [lead]: { x: 0.5, depth: 1 } } })
    const cleared = await t.call(`/api/chats/${chat.id}`, 'PUT', { cookie: ash, body: { stage: null } })
    expect(cleared.body.stage ?? undefined).toBeUndefined()
    expect((await t.call(`/api/chats/${chat.id}`, 'PUT', { cookie: ash, body: { stage: {} } })).body.stage ?? undefined).toBeUndefined()
  })
})
