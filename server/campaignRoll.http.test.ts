import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CAMPAIGN_PRESETS, STARTER_PBTA_CAMPAIGN } from '../src/lib/world/campaign.ts'

let server: http.Server
let dataDir: string
let originalDataDir: string | undefined
let originalLoadEnvFile: typeof process.loadEnvFile
let sessionCookie = ''

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-tales-roll-http-'))
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
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(content), headers: res.headers }))
    })
    req.on('error', reject)
    req.end(body === undefined ? undefined : JSON.stringify(body))
  })
}

describe('server-owned roll HTTP API', () => {
  it('persists one roll, replays exact retries, rejects conflicts and client-authored changes', async () => {
    const campaign = { ...STARTER_PBTA_CAMPAIGN, mode: 'mechanical' }
    const world = await call('/api/worlds', 'POST', { name: 'Test world', description: '', gmNotes: 'The bridge is trapped.', lorebook: { entries: [] }, campaign })
    expect(world.status).toBe(201)
    expect(world.body.gmNotes).toBe('The bridge is trapped.')
    expect(world.body.campaign.stats[0]).toMatchObject({ id: 'nerve', name: 'Nerve' })
    expect(world.body.campaign.moves[0].statId).toBe('nerve')
    const lead = await call('/api/characters', 'POST', { card: { name: 'Lead' }, worldId: world.body.id })
    const player = await call('/api/characters', 'POST', { card: { name: 'Player' }, worldId: world.body.id, playerOnly: true })
    expect(lead.status).toBe(201)
    expect(player.status).toBe(201)
    const chat = await call('/api/chats', 'POST', { characterId: lead.body.id, playerCharacterId: player.body.id, title: 'A scene', scene: { turnPolicy: 'gm' } })
    expect(chat.status).toBe(201)
    expect(chat.body.scene?.turnPolicy).toBe('gm')

    const request = { messageId: 'roll-message-1', moveId: campaign.moves[0].id, modifier: -5, action: 'Cross the bridge', text: 'I cross the bridge.' }
    const route = `/api/chats/${chat.body.id}/roll`
    const first = await call(route, 'POST', request)
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ id: request.messageId, chatId: chat.body.id, role: 'user', name: 'Player', text: request.text,
      campaignRoll: { moveId: request.moveId, modifier: -5, action: request.action } })
    const roll = first.body.campaignRoll
    expect(roll.dice).toHaveLength(2)
    expect(roll.dice.every((die: number) => Number.isInteger(die) && die >= 1 && die <= 6)).toBe(true)
    expect(roll.total).toBe(roll.dice[0] + roll.dice[1] - 5)
    expect(roll.tier).toBe(roll.total >= 10 ? 'strong' : roll.total >= 7 ? 'mixed' : 'miss')
    expect(roll.outcome).toBe(campaign.moves[0][roll.tier as 'strong' | 'mixed' | 'miss'])

    const retry = await call(route, 'POST', request)
    expect(retry.status).toBe(200)
    expect(retry.body).toEqual(first.body)
    expect((await call(route, 'POST', { ...request, action: 'Different action' })).status).toBe(409)
    expect((await call('/api/messages', 'POST', { id: 'forged', chatId: chat.body.id, role: 'user', text: 'Forged', campaignRoll: roll })).status).toBe(409)
    expect((await call(`/api/messages/${request.messageId}`, 'PUT', { campaignRoll: { ...roll, tier: 'strong' } })).status).toBe(409)
    expect((await call(`/api/messages/${request.messageId}`, 'PUT', { text: 'Changed after rolling' })).status).toBe(400)
    expect((await call(`/api/messages/${request.messageId}`, 'GET')).body).toEqual(first.body)

    const savedSheet = await call(`/api/characters/${player.body.id}`, 'PUT', { sheet: { worldId: world.body.id, stats: { nerve: 2, wits: 0, heart: 1, grit: -1 } } })
    expect(savedSheet.body.sheet.stats.nerve).toBe(2)
    const sheetRequest = { ...request, messageId: 'sheet-roll', modifier: 2 }
    expect((await call(route, 'POST', { ...sheetRequest, modifier: -5 })).status).toBe(409)
    const sheetRoll = await call(route, 'POST', sheetRequest)
    expect(sheetRoll.status).toBe(201)
    expect(sheetRoll.body.campaignRoll.modifier).toBe(2)
    expect(sheetRoll.body.campaignRoll).toMatchObject({ modifierSource: 'sheet', sheetStatId: 'nerve' })
    expect(sheetRoll.body.campaignRoll.total).toBe(sheetRoll.body.campaignRoll.dice[0] + sheetRoll.body.campaignRoll.dice[1] + 2)
    expect((await call(route, 'POST', sheetRequest)).body).toEqual(sheetRoll.body)

    expect((await call(`/api/worlds/${world.body.id}`, 'PUT', { modules: { campaignRules: false } })).status).toBe(200)
    expect((await call(route, 'POST', { ...sheetRequest, messageId: 'disabled-roll' })).status).toBe(400)
  })

  it('uses a portable d20 sheet and records an actual failed DC check', async () => {
    const campaign = CAMPAIGN_PRESETS.find((entry) => entry.id === 'dnd-5-2')!.campaign
    const world = await call('/api/worlds', 'POST', { name: 'D20 world', description: '', lorebook: { entries: [] }, campaign })
    const oldWorld = await call('/api/worlds', 'POST', { name: 'Old home', description: '', lorebook: { entries: [] } })
    const lead = await call('/api/characters', 'POST', { card: { name: 'Lead' }, worldId: world.body.id })
    const player = await call('/api/characters', 'POST', { card: { name: 'Player' }, worldId: oldWorld.body.id, playerOnly: true,
      sheets: { [world.body.id]: { stats: { strength: 18 } } } })
    const chat = await call('/api/chats', 'POST', { characterId: lead.body.id, playerCharacterId: player.body.id, title: 'D20 check' })
    const route = `/api/chats/${chat.body.id}/roll`
    const request = { messageId: 'd20-failed-check', moveId: campaign.moves[0].id, modifier: 4, target: 30, action: 'Lift the gate', text: 'I lift the gate.' }
    expect((await call(route, 'POST', { ...request, modifier: 9 })).status).toBe(409)
    const result = await call(route, 'POST', request)
    expect(result.status).toBe(201)
    expect(result.body.campaignRoll).toMatchObject({ resolver: 'd20', modifier: 4, modifierSource: 'sheet', target: 30, requestedTarget: 30, degree: 'failure', tier: 'miss' })
    expect(result.body.campaignRoll.total).toBeLessThan(30)
    expect((await call(route, 'POST', request)).body).toEqual(result.body)

    const pendingId = 'd20-gm-check'
    const gm = await call('/api/messages', 'POST', { id: pendingId, chatId: chat.body.id, role: 'assistant', text: 'A check is required.', createdAt: Date.now(),
      gm: { adjudication: { source: 'roll_needed', moveId: campaign.moves[0].id, target: 20, action: request.action } } })
    expect(gm.status).toBe(201)
    const gmRequest = { ...request, messageId: 'd20-gm-roll', target: 20, pendingGmMessageId: pendingId }
    expect((await call(route, 'POST', { ...gmRequest, pendingGmMessageId: undefined })).status).toBe(409)
    expect((await call(route, 'POST', { ...gmRequest, target: 10 })).status).toBe(409)
    expect((await call(route, 'POST', { ...gmRequest, action: 'An easier action' })).status).toBe(409)
    const gmRoll = await call(route, 'POST', gmRequest)
    expect(gmRoll.status).toBe(201)
    expect(gmRoll.body.campaignRoll).toMatchObject({ target: 20, pendingGmMessageId: pendingId })

    const fixed = { ...campaign, moves: campaign.moves.map((move, index) => index === 0 ? { ...move, target: 15 } : move) }
    expect((await call(`/api/worlds/${world.body.id}`, 'PUT', { campaign: fixed })).status).toBe(200)
    const fixedPendingId = 'd20-fixed-gm-check'
    expect((await call('/api/messages', 'POST', { id: fixedPendingId, chatId: chat.body.id, role: 'assistant', text: 'A fixed check is required.', createdAt: Date.now(),
      gm: { adjudication: { source: 'roll_needed', moveId: campaign.moves[0].id, target: 15 } } })).status).toBe(201)
    const fixedRoll = await call(route, 'POST', { ...request, messageId: 'd20-fixed-roll', target: undefined, pendingGmMessageId: fixedPendingId })
    expect(fixedRoll.status).toBe(201)
    expect(fixedRoll.body.campaignRoll).toMatchObject({ target: 15, pendingGmMessageId: fixedPendingId })
  })
})
