import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let owner = ''

beforeAll(async () => {
  t = await startTestServer('canon-facts-http')
  owner = await t.setupOwner('canon_owner', 'canon-owner-password')
})

afterAll(async () => {
  await t?.close()
})

describe('who may be told a world canon fact, over HTTP', () => {
  it('keeps the list of characters on a fact, and leaves older facts public', async () => {
    const world = (await t.call('/api/worlds', 'POST', { cookie: owner, body: {
      name: 'Harrow', description: '', lorebook: { entries: [] },
      canonFacts: [
        { id: 'f1', text: 'The east bridge fell last winter.', createdAt: 1 },
        { id: 'f2', text: 'Ash asked Bea to dinner.', createdAt: 2, knownBy: ['ash', ' bea ', 'ash', '', 7] },
      ],
    } })).body
    expect(world.canonFacts).toEqual([
      { id: 'f1', text: 'The east bridge fell last winter.', createdAt: 1 },
      { id: 'f2', text: 'Ash asked Bea to dinner.', createdAt: 2, knownBy: ['ash', 'bea'] },
    ])
  })

  it('reads an empty or malformed list as public, never as "known to nobody"', async () => {
    const world = (await t.call('/api/worlds', 'POST', { cookie: owner, body: {
      name: 'Harrow II', description: '', lorebook: { entries: [] },
      canonFacts: [
        { id: 'a', text: 'One.', createdAt: 1, knownBy: [] },
        { id: 'b', text: 'Two.', createdAt: 2, knownBy: 'ash' },
      ],
    } })).body
    expect(world.canonFacts.map((f: { knownBy?: unknown }) => f.knownBy)).toEqual([undefined, undefined])
  })

  it('keeps knownBy when the world is saved again', async () => {
    const world = (await t.call('/api/worlds', 'POST', { cookie: owner, body: {
      name: 'Harrow III', description: '', lorebook: { entries: [] },
      canonFacts: [{ id: 'f1', text: 'Cole is leaving.', createdAt: 1, knownBy: ['cole'] }],
    } })).body
    const saved = await t.call(`/api/worlds/${world.id}`, 'PUT', { cookie: owner, body: { canonFacts: world.canonFacts } })
    expect(saved.status).toBe(200)
    expect(saved.body.canonFacts[0].knownBy).toEqual(['cole'])
  })
})
