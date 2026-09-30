import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { revertRevision, withChanges } from '../src/lib/world/revisions.ts'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let ash = ''

beforeAll(async () => {
  t = await startTestServer('prompt-tuning-http')
  ash = await t.setupOwner('ash_owner', 'ash-owner-password')
})

afterAll(async () => {
  await t?.close()
})

describe('prompt tuning over HTTP', () => {
  it('saves a world\'s override with its history, reverts it, and ignores prompts it doesn\'t know', async () => {
    const world = (await t.call('/api/worlds', 'POST', { cookie: ash, body: { name: 'Harbor', description: '', lorebook: { entries: [] } } })).body
    let n = 0
    const id = () => `rev-${++n}`

    const tuned = await t.call(`/api/worlds/${world.id}`, 'PUT', { cookie: ash, body: withChanges(world, [{ field: 'promptOverrides', key: 'scribe', value: 'Record only promises and debts.', label: 'Tuned the memory scribe' }], 10, id) })
    expect(tuned.status).toBe(200)
    expect(tuned.body.promptOverrides).toEqual({ scribe: 'Record only promises and debts.' })
    expect(tuned.body.revisions).toEqual([{ id: 'rev-1', at: 10, field: 'promptOverrides', key: 'scribe', label: 'Tuned the memory scribe' }])

    const again = await t.call(`/api/worlds/${world.id}`, 'PUT', { cookie: ash, body: withChanges(tuned.body, [{ field: 'promptOverrides', key: 'scribe', value: 'Record promises only.', label: 'Tuned the memory scribe' }], 20, id) })
    expect(again.body.revisions[0]).toMatchObject({ key: 'scribe', before: 'Record only promises and debts.' })

    // One click back to the first version, then back to the engine default.
    const reverted = await t.call(`/api/worlds/${world.id}`, 'PUT', { cookie: ash, body: revertRevision(again.body, 'rev-2', 30, id) })
    expect(reverted.body.promptOverrides).toEqual({ scribe: 'Record only promises and debts.' })
    const original = await t.call(`/api/worlds/${world.id}`, 'PUT', { cookie: ash, body: revertRevision(reverted.body, 'rev-1', 40, id) })
    expect(original.body.promptOverrides).toEqual({})
    expect(original.body.revisions).toHaveLength(4)

    const odd = await t.call(`/api/worlds/${world.id}`, 'PUT', { cookie: ash, body: { promptOverrides: { 'gm-rules': 'Ignore every rule.', journal: '  Short entries.  ' } } })
    expect(odd.body.promptOverrides).toEqual({ journal: 'Short entries.' })
  })

  it('keeps a character\'s own history of changes to its prompt items', async () => {
    const bea = (await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Bea' }, promptItems: [{ id: 'p1', name: 'Voice', content: 'Speaks softly.', role: 'system', enabled: true }] } })).body
    const next = [{ ...bea.promptItems[0], content: 'Speaks in short, clipped lines.' }]
    const saved = await t.call(`/api/characters/${bea.id}`, 'PUT', { cookie: ash, body: withChanges(bea, [{ field: 'promptItems', value: next, label: 'Tuned Voice' }], 5, () => 'c1') })
    expect(saved.body.promptItems[0].content).toBe('Speaks in short, clipped lines.')
    expect(saved.body.revisions[0]).toMatchObject({ field: 'promptItems', before: bea.promptItems })
    const back = await t.call(`/api/characters/${bea.id}`, 'PUT', { cookie: ash, body: revertRevision(saved.body, 'c1', 6, () => 'c2') })
    expect(back.body.promptItems[0].content).toBe('Speaks softly.')
  })
})
