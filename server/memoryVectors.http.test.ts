import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { startTestServer, type TestServer } from './httpTestServer.ts'
import { memoryTextHash } from './memoryVectorPlan.ts'

let t: TestServer
let owner = ''
let member = ''
beforeAll(async () => {
  t = await startTestServer('memory-vectors')
  owner = await t.setupOwner('vector_owner', 'synthetic-password-owner')
  member = await t.addMember(owner, 'vector_member', 'synthetic-password-member')
})
afterAll(async () => { await t?.close() })
const call = (route: string, method = 'GET', body?: unknown, cookie = owner) => t.call(route, method, { body, cookie })
// This is exclusively the synthetic database just created by startTestServer, opened read-only.
const stored = (ids: string[]) => {
  const db = new DatabaseSync(path.join(t.dataDir, 'rp.db'), { readOnly: true })
  try { return db.prepare(`SELECT memoryId FROM memory_vectors WHERE memoryId IN (${ids.map(() => '?').join(',')})`).all(...ids).map((r) => r.memoryId) }
  finally { db.close() }
}
const upload = (m: { id: string; text: string }, model = 'synthetic', vector = [3, 4]) => ({ memoryId: m.id, model, dims: vector.length, textHash: memoryTextHash(model, m.text), vector })
async function scene() {
  const world = (await call('/api/worlds', 'POST', { name: 'Harbor', modules: { deepMemory: true }, description: '', lorebook: { entries: [] } })).body
  const character = (await call('/api/characters', 'POST', { card: { name: 'Brisa' }, worldId: world.id })).body
  const chat = (await call('/api/chats', 'POST', { characterId: character.id, title: 'Quay' })).body
  const make = async (text: string, extra = {}) => (await call('/api/memories', 'POST', { chatId: chat.id, text, witnesses: [character.id], createdAt: 500, ...extra })).body
  const memory = await make('Brisa crossed the river.')
  const put = (rows = [upload(memory)]) => call('/api/memory-vectors', 'PUT', { vectors: rows })
  const missing = (model = 'synthetic') => call(`/api/chats/${chat.id}/memory-vectors/missing?model=${model}`)
  const score = (vector = [3, 4], model = 'synthetic') => call(`/api/chats/${chat.id}/memory-similarity`, 'POST', { characterId: character.id, model, vector })
  return { world, character, chat, make, memory, put, missing, score }
}

describe('optional memory vectors', () => {
  it('normalizes blobs, scores cosine, invalidates text/model changes, and rejects stale/different dimensions', async () => {
    const s = await scene()
    expect((await s.missing()).body).toMatchObject({ total: 1, missing: [{ memoryId: s.memory.id, textHash: memoryTextHash('synthetic', s.memory.text) }] })
    expect((await s.put()).status).toBe(204)
    expect((await s.missing()).body.total).toBe(0)
    expect((await s.score()).body[s.memory.id]).toBeCloseTo(1)
    expect((await s.score([-4, 3])).body[s.memory.id]).toBeCloseTo(0)
    expect((await s.score([-3, -4])).body[s.memory.id]).toBeCloseTo(-1)
    expect((await s.put([upload(s.memory, 'synthetic', [1, 0, 0])])).status).toBe(400)
    expect((await s.score([1, 0, 0])).status).toBe(400)
    expect((await s.put([upload(s.memory, 'synthetic', [0, 0])])).status).toBe(400)
    await call(`/api/memories/${s.memory.id}`, 'PUT', { text: 'Brisa crossed the ferry landing.' })
    expect((await s.missing()).body.total).toBe(1)
    expect((await s.score()).body).toEqual({})
    expect((await s.put()).status).toBe(409)
    const current = { ...s.memory, text: 'Brisa crossed the ferry landing.' }
    expect((await s.put([upload(current)])).status).toBe(204)
    expect((await s.missing('other-synthetic')).body.total).toBe(1)
    expect((await s.score([3, 4], 'other-synthetic')).body).toEqual({})
    expect((await s.put([upload(current, 'other-synthetic', [1, 0, 0])])).status).toBe(204)
    expect((await s.missing('other-synthetic')).body.total).toBe(0)
    expect((await s.missing()).body.total).toBe(1)
    expect((await s.put(Array.from({ length: 33 }, () => upload(current)))).status).toBe(400)
  })

  it('filters knowledge, branch, retirement and folding before scoring and enforces account access', async () => {
    const s = await scene()
    const secret = await s.make('A hidden key.', { witnesses: ['tavi'] })
    const retired = await s.make('A past route.')
    const folded = await s.make('An old crossing.')
    const sibling = (await call('/api/chats', 'POST', { characterId: s.character.id, title: 'Other route' })).body
    const offBranch = (await call('/api/memories', 'POST', { chatId: sibling.id, text: 'Another secret.', witnesses: [s.character.id] })).body
    await call(`/api/memories/${retired.id}`, 'PUT', { active: false })
    await call(`/api/memories/${folded.id}`, 'PUT', { consolidatedFor: [s.character.id] })
    expect((await s.put([s.memory, secret, retired, folded, offBranch].map((m) => upload(m)))).status).toBe(204)
    expect(Object.keys((await s.score()).body)).toEqual([s.memory.id])
    const scoped = await s.missing('fresh-model')
    expect(scoped.body.missing.some((m: any) => m.memoryId === offBranch.id)).toBe(false)
    expect((await call(`/api/chats/${s.chat.id}/memory-vectors/missing?model=synthetic`, 'GET', undefined, member)).status).toBe(404)
    expect((await call('/api/memory-vectors', 'PUT', { vectors: [upload(s.memory)] }, member)).status).toBe(404)
    expect((await call(`/api/chats/${s.chat.id}/memory-similarity`, 'POST', { characterId: s.character.id, model: 'synthetic', vector: [1, 0] }, member)).status).toBe(404)
    expect((await call(`/api/chats/${s.chat.id}/memory-similarity`, 'POST', { characterId: 'missing', model: 'synthetic', vector: [1, 0] })).status).toBe(404)
    await call(`/api/worlds/${s.world.id}`, 'PUT', { modules: { deepMemory: false } })
    expect((await s.missing()).status).toBe(409)
    expect((await s.put()).status).toBe(409)
    expect((await s.score()).status).toBe(409)
  })

  it('caps backfill at 32 and sends text/hashes without vectors', async () => {
    const s = await scene()
    for (let i = 0; i < 35; i++) await s.make(`Brisa inspected parcel ${i}.`)
    const batch = (await s.missing()).body
    expect(batch.total).toBe(36)
    expect(batch.missing).toHaveLength(32)
    expect(batch.missing.every((row: any) => !('vector' in row))).toBe(true)
  })

  it('copies identical vectors on fork and removes them on memory delete, rewind, chat purge and character deletion', async () => {
    const s = await scene()
    const reply = (await call('/api/messages', 'POST', { chatId: s.chat.id, role: 'char', text: 'A familiar quay.', createdAt: 1000 })).body
    await s.put()
    const fork = (await call(`/api/chats/${s.chat.id}/fork`, 'POST', { messageId: reply.id })).body
    const copies = (await call(`/api/chats/${fork.id}/memories`)).body
    expect(stored([copies[0].id])).toEqual([copies[0].id])
    expect((await call(`/api/chats/${fork.id}/memory-vectors/missing?model=synthetic`)).body.total).toBe(0)
    await call(`/api/memories/${copies[0].id}`, 'DELETE')
    expect(stored([copies[0].id])).toEqual([])
    const next = (await call('/api/messages', 'POST', { chatId: s.chat.id, role: 'char', text: 'A new quay.', createdAt: 2000 })).body
    const generated = await s.make('A new memory.', { sourceMessageId: next.id, createdAt: 2000 })
    await s.put([upload(generated)])
    await call(`/api/chats/${s.chat.id}/rewind`, 'POST', { messageId: next.id })
    expect(stored([generated.id, s.memory.id])).toEqual([s.memory.id])
    await call(`/api/chats/${s.chat.id}/purge`, 'DELETE')
    expect(stored([s.memory.id])).toEqual([])
    const other = await scene()
    await other.put()
    await call(`/api/characters/${other.character.id}`, 'DELETE')
    expect(stored([other.memory.id])).toEqual([])
  })

  it('retracts derived vectors when source text is rewritten and clears all derived data on restore', async () => {
    const s = await scene()
    const reply = (await call('/api/messages', 'POST', { chatId: s.chat.id, role: 'char', text: 'An old route.' })).body
    const generated = await s.make('The remembered route.', { sourceMessageId: reply.id })
    await s.put([upload(s.memory), upload(generated)])
    await call(`/api/messages/${reply.id}`, 'PUT', { text: 'A rewritten route.' })
    expect(stored([generated.id, s.memory.id])).toEqual([s.memory.id])
    const backup = (await call('/api/backup')).body
    expect(Object.keys(backup.data)).not.toContain('memoryVectors')
    expect(JSON.stringify(backup.data)).not.toContain('textHash')
    expect((await call('/api/restore', 'POST', backup)).status).toBe(204)
    expect(stored([s.memory.id])).toEqual([])
    expect((await s.missing()).body.total).toBe(1)
  })
})
