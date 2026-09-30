import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let ash = ''

beforeAll(async () => {
  t = await startTestServer('custom-rules-http')
  ash = await t.setupOwner('ash_owner', 'ash-owner-password')
})

afterAll(async () => {
  await t?.close()
})

// A Blades-style pool: the action rating in d6, the highest die counts.
const custom = {
  dice: { count: 0, sides: 6, pool: true, emptyPool: 2, keep: { which: 'highest', count: 1 } },
  compare: 'result',
  bands: [
    { label: 'Critical', tier: 'strong', topFaces: 2 },
    { label: 'Full success', tier: 'strong', min: 6 },
    { label: 'Partial', tier: 'mixed', min: 4, max: 5 },
    { label: 'Bad outcome', tier: 'miss', max: 3 },
  ],
}
const move = { id: 'prowl', name: 'Prowl', trigger: 'you move unseen', stat: 'Prowl', strong: 'Unseen.', mixed: 'Seen, briefly.', miss: 'Spotted.' }
const campaign = { ruleset: 'Harbor Rules', mode: 'mechanical', resolver: 'custom', relationships: false, dating: false, custom, moves: [move] }

describe('custom rulesets over HTTP', () => {
  it('refuses a world whose ruleset leaves results without an outcome', async () => {
    const broken = { ...campaign, custom: { ...custom, bands: custom.bands.filter((b) => b.label !== 'Partial') } }
    const refused = await t.call('/api/worlds', 'POST', { cookie: ash, body: { name: 'Broken', description: '', lorebook: { entries: [] }, campaign: broken } })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toContain('Nothing covers 4 to 5, between Bad outcome and Full success.')

    const world = await t.call('/api/worlds', 'POST', { cookie: ash, body: { name: 'Harbor', description: '', lorebook: { entries: [] }, campaign } })
    expect(world.status).toBe(201)
    expect(world.body.campaign).toMatchObject({ resolver: 'custom', mode: 'mechanical', custom })
    const edit = await t.call(`/api/worlds/${world.body.id}`, 'PUT', { cookie: ash, body: { campaign: broken } })
    expect(edit.status).toBe(400)
    expect((await t.call(`/api/worlds/${world.body.id}`, 'GET', { cookie: ash })).body.campaign.custom).toEqual(custom)
  })

  it('rolls the world\'s own dice on the server and records the band it lands in', async () => {
    const world = await t.call('/api/worlds', 'POST', { cookie: ash, body: { name: 'Docks', description: '', lorebook: { entries: [] }, campaign } })
    const lead = await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Bea' }, worldId: world.body.id } })
    const chat = await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: lead.body.id, title: 'Night work', scene: { turnPolicy: 'gm' } } })
    const labels = new Set<string>()
    for (let i = 0; i < 12; i++) {
      const rolled = await t.call(`/api/chats/${chat.body.id}/roll`, 'POST', { cookie: ash, body: { messageId: `prowl-${i}`, moveId: 'prowl', modifier: 3, action: 'Slip past the guard', text: 'I slip past.' } })
      expect(rolled.status).toBe(201)
      const roll = rolled.body.campaignRoll
      // Three dice, the highest counts, and the band follows from it: the server can't pick a band the dice don't give.
      expect(roll).toMatchObject({ resolver: 'custom', dice: expect.any(Array), detail: expect.stringContaining('3d6') })
      expect(roll.dice).toHaveLength(3)
      expect(roll.total).toBe(Math.max(...roll.dice))
      const sixes = roll.dice.filter((d: number) => d === 6).length
      const expected = sixes >= 2 ? 'Critical' : roll.total === 6 ? 'Full success' : roll.total >= 4 ? 'Partial' : 'Bad outcome'
      expect(roll.degree).toBe(expected)
      expect(roll.tier).toBe({ Critical: 'strong', 'Full success': 'strong', Partial: 'mixed', 'Bad outcome': 'miss' }[expected as 'Partial'])
      labels.add(roll.degree)
    }
    expect(labels.size).toBeGreaterThan(1)
  })
})
