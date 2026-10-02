import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let cookie = ''

beforeAll(async () => {
  t = await startTestServer('vrma-http')
  cookie = await t.setupOwner('motion_owner', 'motion-owner-password')
})
afterAll(async () => { await t?.close() })

const model = Buffer.alloc(12)
model.write('glTF')
model.writeUInt32LE(2, 4)
model.writeUInt32LE(12, 8)
const modelUrl = `data:model/gltf-binary;base64,${model.toString('base64')}`

function motionUrl(): string {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, extensionsUsed: ['VRMC_vrm_animation'], extensions: { VRMC_vrm_animation: { specVersion: '1.0' } } }))
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32)
  json.copy(padded)
  const glb = Buffer.alloc(20 + padded.length)
  glb.write('glTF')
  glb.writeUInt32LE(2, 4)
  glb.writeUInt32LE(glb.length, 8)
  glb.writeUInt32LE(padded.length, 12)
  glb.write('JSON', 16)
  padded.copy(glb, 20)
  return `data:model/gltf-binary;base64,${glb.toString('base64')}`
}

describe('character VRMA motions over HTTP', () => {
  it('persists clips, serves them, rejects invalid clips, and removes deleted slots', async () => {
    const created = await t.call('/api/characters', 'POST', { cookie, body: { card: { name: 'Mira' }, vrm: { url: modelUrl, enabled: true, motions: { idle: motionUrl() } } } })
    expect(created.status).toBe(201)
    const id = created.body.id as string
    const motion = created.body.vrm.motions.idle as string
    expect(motion).toMatch(new RegExp(`/avatars/characters/${id}/motions/idle\\.vrma`))
    expect((await t.call(motion, 'GET', { cookie })).status).toBe(200)
    expect((await t.call(`/api/characters/${id}`, 'GET', { cookie })).body.vrm.motions.idle).toBe(motion)

    const refused = await t.call(`/api/characters/${id}`, 'PUT', { cookie, body: { vrm: { ...created.body.vrm, motions: { idle: motion, speaking: modelUrl } } } })
    expect(refused.status).toBe(400)
    expect((await t.call(`/api/characters/${id}`, 'GET', { cookie })).body.vrm.motions.idle).toBe(motion)

    const cleared = await t.call(`/api/characters/${id}`, 'PUT', { cookie, body: { vrm: { ...created.body.vrm, motions: {} } } })
    expect(cleared.status).toBe(200)
    expect(cleared.body.vrm.motions).toBeUndefined()
    expect(fs.existsSync(path.join(t.dataDir, 'avatars', 'characters', id, 'motions', 'idle.vrma'))).toBe(false)
  })
})
