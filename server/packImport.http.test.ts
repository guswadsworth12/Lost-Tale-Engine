import crypto from 'node:crypto'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { BLUE_PNG, RED_PNG, TRACK, startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer | undefined
afterAll(async () => {
  await t?.close()
})

const decode = (dataUrl: string) => Buffer.from(dataUrl.split(',')[1], 'base64')

/** A world with media, a cast member, a player card, a bound book, and some play. Returns its exported pack. */
async function exportWorld(server: TestServer, cookie: string): Promise<{ zip: Buffer; worldId: string }> {
  const world = await server.call('/api/worlds', 'POST', { cookie, body: {
    name: 'Salt Coast', description: 'A fishing coast under fog.', rules: 'No firearms.', template: 'story',
    campaign: { ruleset: 'Starter', mode: 'mechanical', resolver: 'pbta', relationships: false, dating: false, stats: [{ id: 'grit', name: 'Grit' }], moves: [] },
    lorebook: { entries: [{ keys: ['fog'], content: 'The fog hides the reef.' }] }, gmNotes: 'SPOILER',
    avatarDataUrl: RED_PNG, backgrounds: { harbor: RED_PNG, dock: BLUE_PNG }, music: { default: TRACK },
  } })
  const cole = await server.call('/api/characters', 'POST', { cookie, body: {
    card: { name: 'Cole Marsh', description: 'A lighthouse keeper.' }, worldId: world.body.id, avatarDataUrl: BLUE_PNG, sprites: { neutral: RED_PNG },
    sheets: { [world.body.id]: { stats: { grit: 2 } } }, privateMemory: 'SECRET-MEMORY',
  } })
  await server.call('/api/characters', 'POST', { cookie, body: { card: { name: 'Wren' }, worldId: world.body.id, playerOnly: true } })
  await server.call('/api/world-info-books', 'POST', { cookie, body: { name: 'Coast lore', book: { entries: [{ keys: ['reef'], content: 'Sharp.' }] }, boundWorldIds: [world.body.id], boundCharacterIds: [cole.body.id] } })
  const chat = await server.call('/api/chats', 'POST', { cookie, body: { characterId: cole.body.id } })
  await server.call('/api/messages', 'POST', { cookie, body: { chatId: chat.body.id, role: 'user', text: 'PLAY-HISTORY' } })
  const started = await server.call('/api/packs/export', 'POST', { cookie, body: { worldId: world.body.id, selection: { npcSheets: true }, metadata: { title: 'Salt Coast', licence: 'CC-BY-4.0' } } })
  const download = await server.call(started.body.url, 'GET', { cookie })
  expect(download.status).toBe(200)
  return { zip: download.raw, worldId: world.body.id }
}

async function upload(server: TestServer, cookie: string, files: Record<string, Buffer>) {
  const started = await server.call('/api/packs/uploads', 'POST', { cookie })
  expect(started.status).toBe(201)
  const uploadId = started.body.uploadId as string
  for (const [name, data] of Object.entries(files)) {
    const put = await server.call(`/api/packs/uploads/${uploadId}/file?path=${encodeURIComponent(name)}`, 'PUT', { cookie, body: data })
    expect([204], name).toContain(put.status)
  }
  return uploadId
}

async function preview(server: TestServer, cookie: string, files: Record<string, Buffer>) {
  const uploadId = await upload(server, cookie, files)
  return server.call('/api/packs/preview', 'POST', { cookie, body: { uploadId } })
}

describe('importing a world pack', () => {
  it('imports a pack from another install into a clean one, with every reference working', async () => {
    const source = await startTestServer('pack-source')
    const sourceOwner = await source.setupOwner('ash_owner', 'ash-owner-password')
    const { zip } = await exportWorld(source, sourceOwner)
    await source.close()

    // A second install: fresh modules, fresh database, fresh media folder.
    vi.resetModules()
    t = await startTestServer('pack-clean')
    const owner = await t.setupOwner('cole_owner', 'cole-owner-password')
    const seen = await preview(t, owner, { 'Salt Coast.ltpack.zip': zip })
    expect(seen.status).toBe(200)
    expect(seen.body).toMatchObject({
      manifest: { title: 'Salt Coast', licence: 'CC-BY-4.0' },
      creates: { world: 'Salt Coast', characters: ['Cole Marsh'], lorebooks: ['Coast lore'] },
      mediaCount: 3, conflicts: [], warnings: [], droppedReferences: [],
    })
    expect(seen.body.mediaBytes).toBe(decode(RED_PNG).length + decode(BLUE_PNG).length + decode(TRACK).length)
    expect(seen.body.manifest.excluded).toContain('Player cards (1)')

    const applied = await t.call('/api/packs/apply', 'POST', { cookie: owner, body: { previewId: seen.body.previewId } })
    expect(applied.status).toBe(201)
    const { worldId, characterIds, lorebookIds } = applied.body
    const world = (await t.call(`/api/worlds/${worldId}`, 'GET', { cookie: owner })).body
    expect(world).toMatchObject({ name: 'Salt Coast', rules: 'No firearms.', template: 'story', visibility: 'private', campaign: { ruleset: 'Starter' }, lorebook: { entries: [{ content: 'The fog hides the reef.' }] } })
    expect(world).not.toHaveProperty('gmNotes')
    const cole = (await t.call(`/api/characters/${characterIds[0]}`, 'GET', { cookie: owner })).body
    expect(cole).toMatchObject({ card: { name: 'Cole Marsh' }, worldId, sheets: { [worldId]: { worldId, stats: { grit: 2 } } }, visibility: 'private' })
    expect(cole).not.toHaveProperty('privateMemory')
    const book = (await t.call('/api/world-info-books', 'GET', { cookie: owner })).body.find((b: { id: string }) => b.id === lorebookIds[0])
    expect(book).toMatchObject({ name: 'Coast lore', boundWorldIds: [worldId], boundCharacterIds: [cole.id], boundChatIds: [] })
    // No play history came along.
    expect((await t.call('/api/chats', 'GET', { cookie: owner })).body).toEqual([])

    // Every media reference resolves to the same bytes, and art used twice is one file.
    expect(world.avatarDataUrl).toMatch(/^\/avatars\/pack-media\/[0-9a-f]{64}\.png$/)
    expect(world.avatarDataUrl).toBe(world.backgrounds.harbor)
    expect(cole.sprites.neutral).toBe(world.avatarDataUrl)
    for (const [url, expected] of [[world.avatarDataUrl, RED_PNG], [world.backgrounds.dock, BLUE_PNG], [world.music.default, TRACK], [cole.avatarDataUrl, BLUE_PNG]]) {
      const file = await t.call(url, 'GET', { cookie: owner })
      expect(file.status, url).toBe(200)
      expect(file.raw.equals(decode(expected)), url).toBe(true)
    }

    // An import applies once.
    expect((await t.call('/api/packs/apply', 'POST', { cookie: owner, body: { previewId: seen.body.previewId } })).status).toBe(404)
  })

  it('keeps an import private to the importer until they share it', async () => {
    const owner = (await t!.call('/api/auth/login', 'POST', { body: { username: 'cole_owner', password: 'cole-owner-password' } })).headers['set-cookie']![0].split(';')[0]
    const member = await t!.addMember(owner, 'bea_member', 'bea-member-password')
    const { zip } = await exportWorld(t!, owner)
    const seen = await preview(t!, member, { 'pack.zip': zip })
    // Bea sees the owner's shared original and her own library, and the pack's world meets both names.
    expect(seen.body.conflicts.map((c: { kind: string; name: string }) => `${c.kind}:${c.name}`)).toEqual(['world:Salt Coast', 'character:Cole Marsh'])
    const applied = await t!.call('/api/packs/apply', 'POST', { cookie: member, body: { previewId: seen.body.previewId } })
    expect(applied.status).toBe(201)
    const mine = (await t!.call(`/api/worlds/${applied.body.worldId}`, 'GET', { cookie: member })).body
    expect(mine).toMatchObject({ name: 'Salt Coast (imported)', visibility: 'private' })
    expect((await t!.call(`/api/worlds/${applied.body.worldId}`, 'GET', { cookie: owner })).status).toBe(404)
    expect((await t!.call(`/api/characters/${applied.body.characterIds[0]}`, 'GET', { cookie: owner })).status).toBe(404)
    // Someone else can't see or finish her upload.
    expect((await t!.call('/api/packs/preview', 'POST', { cookie: owner, body: { uploadId: seen.body.previewId } })).status).toBe(404)

    await t!.call(`/api/worlds/${applied.body.worldId}`, 'PUT', { cookie: member, body: { visibility: 'shared' } })
    expect((await t!.call(`/api/worlds/${applied.body.worldId}`, 'GET', { cookie: owner })).status).toBe(200)
  })

  it('never overwrites anything silently: copy by default, skip onto the existing, replace only when confirmed', async () => {
    const owner = (await t!.call('/api/auth/login', 'POST', { body: { username: 'cole_owner', password: 'cole-owner-password' } })).headers['set-cookie']![0].split(';')[0]
    const worlds = async () => (await t!.call('/api/worlds', 'GET', { cookie: owner })).body as { id: string; name: string; description: string }[]
    const { zip } = await exportWorld(t!, owner)
    const before = await worlds()

    const skipped = await preview(t!, owner, { 'pack.zip': zip })
    const existingWorld = skipped.body.conflicts.find((c: { kind: string }) => c.kind === 'world').existingId
    const existingCole = skipped.body.conflicts.find((c: { kind: string }) => c.kind === 'character').existingId
    const skip = await t!.call('/api/packs/apply', 'POST', { cookie: owner, body: { previewId: skipped.body.previewId, resolutions: { world: 'skip', 'character-1': 'skip' } } })
    expect(skip.body).toMatchObject({ worldId: existingWorld, characterIds: [existingCole], skipped: ['Salt Coast', 'Cole Marsh'] })
    expect((await worlds()).length).toBe(before.length)

    await t!.call(`/api/worlds/${existingWorld}`, 'PUT', { cookie: owner, body: { description: 'Edited since.' } })
    const replaced = await preview(t!, owner, { 'pack.zip': zip })
    expect((await t!.call('/api/packs/apply', 'POST', { cookie: owner, body: { previewId: replaced.body.previewId, resolutions: { world: 'replace' } } })).status).toBe(400)
    expect((await worlds()).find((w) => w.id === existingWorld)?.description).toBe('Edited since.')
    const replace = await t!.call('/api/packs/apply', 'POST', { cookie: owner, body: { previewId: replaced.body.previewId, resolutions: { world: 'replace' }, confirmReplace: true } })
    expect(replace.body).toMatchObject({ worldId: existingWorld, replaced: ['Salt Coast'] })
    expect((await worlds()).find((w) => w.id === existingWorld)?.description).toBe('A fishing coast under fog.')
  })

  it('imports an unzipped folder the same way, and leaves out media that is not what it claims', async () => {
    const owner = (await t!.call('/api/auth/login', 'POST', { body: { username: 'cole_owner', password: 'cole-owner-password' } })).headers['set-cookie']![0].split(';')[0]
    const { zip } = await exportWorld(t!, owner)
    const files = Object.fromEntries(Object.entries(unzipSync(new Uint8Array(zip))).map(([name, data]) => [name, Buffer.from(data)]))
    const png = Object.keys(files).find((name) => name.endsWith('.png'))!
    files[png] = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    files['Salt Coast.ltpack/readme.txt'] = Buffer.from('not part of a pack')
    const seen = await preview(t!, owner, files)
    expect(seen.status).toBe(200)
    expect(seen.body.mediaCount).toBe(2)
    expect(seen.body.warnings).toHaveLength(1)
    const applied = await t!.call('/api/packs/apply', 'POST', { cookie: owner, body: { previewId: seen.body.previewId } })
    expect(applied.status).toBe(201)
    const world = (await t!.call(`/api/worlds/${applied.body.worldId}`, 'GET', { cookie: owner })).body
    expect(JSON.stringify(world)).not.toContain(png.split('/').pop())
  })

  it('rolls a failed import back completely: no records, no media', async () => {
    const owner = (await t!.call('/api/auth/login', 'POST', { body: { username: 'cole_owner', password: 'cole-owner-password' } })).headers['set-cookie']![0].split(';')[0]
    // Art nobody has imported yet, so its file would be new.
    const fresh = `data:image/png;base64,${Buffer.concat([decode(RED_PNG), crypto.randomBytes(16)]).toString('base64')}`
    const world = await t!.call('/api/worlds', 'POST', { cookie: owner, body: { name: 'Doomed Harbor', description: '', lorebook: { entries: [] }, avatarDataUrl: fresh } })
    await t!.call('/api/characters', 'POST', { cookie: owner, body: { card: { name: 'Ash' }, worldId: world.body.id } })
    const started = await t!.call('/api/packs/export', 'POST', { cookie: owner, body: { worldId: world.body.id } })
    const zip = (await t!.call(started.body.url, 'GET', { cookie: owner })).raw
    await t!.call(`/api/worlds/${world.body.id}`, 'DELETE', { cookie: owner })
    const seen = await preview(t!, owner, { 'pack.zip': zip })
    const file = seen.body.manifest.media[0].file as string

    // The world is written first; the character then fails, inside the same transaction.
    const packs = await import('./packs.ts')
    const { worldRow } = await import('./app.ts')
    packs.usePackRowBuilders({ world: worldRow, character: () => { throw new Error('boom') } })
    try {
      const failed = await t!.call('/api/packs/apply', 'POST', { cookie: owner, body: { previewId: seen.body.previewId } })
      expect(failed.status).toBe(400)
      expect(failed.body.error).toMatch(/nothing was imported/)
    } finally {
      const { characterRow } = await import('./app.ts')
      packs.usePackRowBuilders({ world: worldRow, character: characterRow })
    }
    const names = ((await t!.call('/api/worlds', 'GET', { cookie: owner })).body as { name: string }[]).map((w) => w.name)
    expect(names).not.toContain('Doomed Harbor')
    expect((await t!.call(`/avatars/pack-media/${file}`, 'GET', { cookie: owner })).status).toBe(404)
  })

  it('refuses a pack from a newer version, and paths that leave the pack', async () => {
    const owner = (await t!.call('/api/auth/login', 'POST', { body: { username: 'cole_owner', password: 'cole-owner-password' } })).headers['set-cookie']![0].split(';')[0]
    const newer = Buffer.from(zipSync({
      'X.ltpack/manifest.json': strToU8(JSON.stringify({ kind: 'lost-tales-world-pack', formatVersion: 99, title: 'X', media: [] })),
      'X.ltpack/content/world.json': strToU8(JSON.stringify({ key: 'world', name: 'X' })),
    }))
    const refused = await preview(t!, owner, { 'x.zip': newer })
    expect(refused.status).toBe(400)
    expect(refused.body.error).toMatch(/newer version/)
    const started = await t!.call('/api/packs/uploads', 'POST', { cookie: owner })
    expect((await t!.call(`/api/packs/uploads/${started.body.uploadId}/file?path=${encodeURIComponent('../../escape.json')}`, 'PUT', { cookie: owner, body: Buffer.from('{}') })).status).toBe(400)
    expect((await t!.call(`/api/packs/uploads/${crypto.randomUUID()}/file?path=manifest.json`, 'PUT', { cookie: owner, body: Buffer.from('{}') })).status).toBe(404)
  })
})
