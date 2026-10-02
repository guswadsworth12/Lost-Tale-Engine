import { afterAll, beforeAll, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let owner = ''

beforeAll(async () => {
  t = await startTestServer('outfits-http')
  owner = await t.setupOwner('outfit_owner', 'outfit-owner-password')
})

afterAll(async () => {
  await t?.close()
})

it('keeps each outfit or form its kind and description through a save', async () => {
  const outfits = [
    { id: 'wisp', label: 'wisp', kind: 'form', description: '  A drifting mote of green light.  ' },
    { id: 'gown', label: 'gown', kind: 'outfit', description: 'A dark green gown.' },
    { id: 'plain', label: 'plain', kind: 'robot', description: '   ' },
  ]
  const created = await t.call('/api/characters', 'POST', { cookie: owner, body: { card: { name: 'Wren' }, outfits } })
  expect(created.status).toBe(201)
  expect(created.body.outfits).toMatchObject([
    { id: 'wisp', kind: 'form', description: 'A drifting mote of green light.' },
    { id: 'gown', kind: 'outfit', description: 'A dark green gown.' },
    { id: 'plain' },
  ])
  // An unknown kind and a blank description are dropped rather than stored.
  expect(created.body.outfits[2].kind).toBeUndefined()
  expect(created.body.outfits[2].description).toBeUndefined()

  const saved = await t.call(`/api/characters/${created.body.id}`, 'PUT', { cookie: owner, body: { outfits: created.body.outfits } })
  expect(saved.body.outfits[0]).toMatchObject({ kind: 'form', description: 'A drifting mote of green light.' })
})
