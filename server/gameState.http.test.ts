import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { gameStateFrom, type CampaignTrack } from '../src/lib/world/gameState.ts'

let server: http.Server
let dataDir: string
let originalDataDir: string | undefined
let originalLoadEnvFile: typeof process.loadEnvFile
let sessionCookie = ''

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-tales-state-http-'))
  originalDataDir = process.env.LOST_TALES_DATA_DIR
  originalLoadEnvFile = process.loadEnvFile
  process.env.LOST_TALES_DATA_DIR = dataDir
  // The test provides its own data directory; do not read the checkout's private .env.
  process.loadEnvFile = () => {}
  const { app } = await import('./app.ts')
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const db = await import('./db.ts')
  expect(db.dataDir).toBe(dataDir)
  // The API needs a signed-in user: set up the first account (allowed from loopback) and keep its cookie.
  const setup = await call('/api/auth/setup', 'POST', { username: 'test_owner', password: 'test-owner-password' })
  expect(setup.status).toBe(201)
  sessionCookie = String(setup.headers['set-cookie']?.[0] ?? '').split(';')[0]
})

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  const { db } = await import('./db.ts')
  db.close()
  process.loadEnvFile = originalLoadEnvFile
  if (originalDataDir === undefined) delete process.env.LOST_TALES_DATA_DIR
  else process.env.LOST_TALES_DATA_DIR = originalDataDir
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true })
})

function call(route: string, method: string, body?: unknown): Promise<{ status: number; body: Record<string, any>; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port,
      path: route, method, headers: { 'Content-Type': 'application/json', ...(sessionCookie ? { Cookie: sessionCookie } : {}) } }, (res) => {
      let content = ''
      res.on('data', (data) => { content += data })
      res.on('end', () => resolve({ status: res.statusCode!, body: content ? JSON.parse(content) : {}, headers: res.headers }))
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

describe('tracked state over HTTP', () => {
  it('records a roll\'s effects once, and follows the branch through retry, fork, rewind, and the next scene', async () => {
    const tracks: CampaignTrack[] = [
      { id: 'supplies', name: 'Supplies', kind: 'resource', max: 3 },
      { id: 'trouble', name: 'Trouble', kind: 'clock', max: 4, perScene: true, gmOnly: true },
      { id: 'hurt', name: 'Hurt', kind: 'condition', perCharacter: true },
    ]
    // Every result costs a supply, and a miss also fills the clock: the dice are random, the rule is not.
    const forage = { id: 'forage', name: 'Forage', trigger: 'you search for food', stat: 'Wits', strong: 'You find some.', mixed: 'You find a little.', miss: 'You find trouble.',
      effects: { strong: [{ trackId: 'supplies', delta: -1 }], mixed: [{ trackId: 'supplies', delta: -1 }], miss: [{ trackId: 'supplies', delta: -1 }, { trackId: 'trouble', delta: 1 }] } }
    const campaign = { ruleset: 'Test', mode: 'mechanical', resolver: 'pbta', relationships: false, dating: false, tracks, moves: [forage] }
    const world = await call('/api/worlds', 'POST', { name: 'Test world', description: '', lorebook: { entries: [] }, campaign })
    expect(world.status).toBe(201)
    expect(world.body.campaign.tracks).toEqual(tracks)
    expect(world.body.campaign.moves[0].effects).toEqual(forage.effects)
    const lead = await call('/api/characters', 'POST', { card: { name: 'Bea' }, worldId: world.body.id })
    const player = await call('/api/characters', 'POST', { card: { name: 'Wren' }, worldId: world.body.id, playerOnly: true })
    const chat = await call('/api/chats', 'POST', { characterId: lead.body.id, playerCharacterId: player.body.id, title: 'Foraging', scene: { turnPolicy: 'gm' } })
    const route = `/api/chats/${chat.body.id}/roll`
    const stateOf = async (chatId: string) => {
      const saved = await call(`/api/chats/${chatId}`, 'GET')
      const messages = await call(`/api/chats/${chatId}/messages`, 'GET')
      return gameStateFrom(tracks, saved.body.gameState, messages.body as never, { playerId: player.body.id }).state
    }

    const request = { messageId: 'forage-1', moveId: 'forage', modifier: 0, action: 'Search the ruins', text: 'I search the ruins.' }
    const first = await call(route, 'POST', request)
    expect(first.status).toBe(201)
    const roll = first.body.campaignRoll
    expect(roll.stateChanges).toEqual([
      { trackId: 'supplies', delta: -1, who: player.body.id, source: 'roll', rollId: roll.id },
      ...(roll.tier === 'miss' ? [{ trackId: 'trouble', delta: 1, who: player.body.id, source: 'roll', rollId: roll.id }] : []),
    ])
    const troubleAfterFirst = roll.tier === 'miss' ? 1 : 0

    // A repeated submission replays the saved roll: no second message, no second cost.
    const retry = await call(route, 'POST', request)
    expect(retry.status).toBe(200)
    expect(retry.body).toEqual(first.body)
    expect((await call(`/api/chats/${chat.body.id}/messages`, 'GET')).body).toHaveLength(1)
    expect((await stateOf(chat.body.id)).supplies).toBe(2)
    // The recorded effects are as fixed as the dice.
    expect((await call(`/api/messages/${request.messageId}`, 'PUT', { campaignRoll: { ...roll, stateChanges: [] } })).status).toBe(409)

    const second = await call(route, 'POST', { ...request, messageId: 'forage-2' })
    expect(second.status).toBe(201)
    const troubleAfterSecond = troubleAfterFirst + (second.body.campaignRoll.tier === 'miss' ? 1 : 0)
    expect(await stateOf(chat.body.id)).toMatchObject({ supplies: 1 })

    // A fork at the first roll starts from the state at that point.
    const fork = await call(`/api/chats/${chat.body.id}/fork`, 'POST', { messageId: 'forage-1' })
    expect(fork.status).toBe(201)
    expect((await stateOf(fork.body.id)).supplies).toBe(2)
    expect((await stateOf(chat.body.id)).trouble ?? 0).toBe(troubleAfterSecond)

    // Rewinding past the second roll gives its supply back.
    expect((await call('/api/messages/forage-2', 'DELETE')).status).toBe(204)
    const rewound = await stateOf(chat.body.id)
    expect(rewound.supplies).toBe(2)
    expect(rewound.trouble ?? 0).toBe(troubleAfterFirst)

    // The player's correction rides the latest message and follows the branch like any other change.
    await call('/api/messages/forage-1', 'PUT', { stateEdits: [{ trackId: 'hurt', set: true, source: 'player' }] })
    expect(await stateOf(chat.body.id)).toMatchObject({ supplies: 2, [`hurt@${player.body.id}`]: true })

    // The next scene opens on the state the server folds from this branch; the threat clock starts empty.
    const next = await call(`/api/chats/${chat.body.id}/next-scene`, 'POST', { recap: { text: 'They found a little food.', presentIds: [lead.body.id] } })
    expect(next.status).toBe(201)
    expect(next.body.gameState).toEqual({ supplies: 2, [`hurt@${player.body.id}`]: true })

    // Starting values are sanitized on save, and null clears them.
    const edited = await call(`/api/chats/${next.body.id}`, 'PUT', { gameState: { supplies: 1, bad: 'x', gear: ['rope', 5] } })
    expect(edited.body.gameState).toEqual({ supplies: 1, gear: ['rope'] })
    expect((await call(`/api/chats/${next.body.id}`, 'PUT', { gameState: null })).body.gameState).toBeNull()
  })
})
