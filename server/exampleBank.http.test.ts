import { afterAll, beforeAll, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'
let t: TestServer, cookie: string
beforeAll(async () => { t = await startTestServer('example-bank'); cookie = await t.setupOwner('example_owner', 'synthetic-example-password') })
afterAll(async () => { await t?.close() })
const call = (path: string, method = 'GET', body?: unknown) => t.call(path, method, { body, cookie })
const entry = { id: 'exchange', situations: ['everyday'], text: '<START>\n{{user}}: Hello.\n{{char}}: Good morning.', enabled: true }
it('validates every entry and rejects invalid create/update atomically without truncation', async () => {
  const saved = await call('/api/characters', 'POST', { card: { name: 'Mara' }, exampleBank: [entry] })
  expect(saved.status).toBe(201)
  for (const bank of [Array.from({ length: 41 }, (_, i) => ({ ...entry, id: String(i) })), [{ ...entry, text: '<START>\n{{char}}: ' + 'x'.repeat(3000) }], [{ ...entry, situations: ['unlisted'] }], [{ ...entry, text: '<START>\n{{user}}: Only a user speaks.' }], [{ ...entry, text: entry.text + '\n<START>\n{{char}}: Another exchange.' }], [{ ...entry, text: '<START>\n' + entry.text }], [{ ...entry, enabled: 'yes' }], [entry, entry]]) {
    expect((await call('/api/characters', 'POST', { card: { name: 'Rejected synthetic card' }, exampleBank: bank })).status).toBe(400)
    expect((await call(`/api/characters/${saved.body.id}`, 'PUT', { exampleBank: bank, card: { name: 'Should not replace Mara' } })).status).toBe(400)
    expect((await call(`/api/characters/${saved.body.id}`)).body).toMatchObject({ card: { name: 'Mara' }, exampleBank: [entry] })
  }
  const atLimit = Array.from({ length: 40 }, (_, i) => ({ ...entry, id: String(i), text: '<START>\n{{char}}: ' + 'x'.repeat(3000 - '<START>\n{{char}}: '.length) }))
  expect((await call(`/api/characters/${saved.body.id}`, 'PUT', { exampleBank: atLimit })).body.exampleBank).toEqual(atLimit)
  await call(`/api/characters/${saved.body.id}`, 'PUT', { exampleBank: null })
  expect((await call(`/api/characters/${saved.body.id}`)).body.exampleBank).toBeUndefined()
})
