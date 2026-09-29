import { unzipSync, strFromU8 } from 'fflate'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BLUE_PNG, RED_PNG, TRACK, startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let ash = ''
let bea = ''

beforeAll(async () => {
  t = await startTestServer('pack-export-http')
  ash = await t.setupOwner('ash_owner', 'ash-owner-password')
  bea = await t.addMember(ash, 'bea_member', 'bea-member-password')
})

afterAll(async () => {
  await t?.close()
})

async function makeWorld() {
  const world = await t.call('/api/worlds', 'POST', { cookie: ash, body: {
    name: 'Salt Coast', description: 'A fishing coast under fog.', rules: 'No firearms.',
    lorebook: { entries: [{ keys: ['fog'], content: 'The fog hides the reef.' }] },
    gmNotes: 'SPOILER: the keeper is the smuggler.', canonFacts: [{ text: 'SPOILER-FACT: the ferry sank.' }],
    // The same image as portrait and as one background: packed once.
    avatarDataUrl: RED_PNG, backgrounds: { harbor: RED_PNG, dock: BLUE_PNG }, music: { default: TRACK },
  } })
  expect(world.status).toBe(201)
  const cole = await t.call('/api/characters', 'POST', { cookie: ash, body: {
    card: { name: 'Cole Marsh', description: 'A lighthouse keeper.' }, worldId: world.body.id, avatarDataUrl: BLUE_PNG, sprites: { neutral: RED_PNG },
    privateMemory: 'SECRET-MEMORY: Cole keeps the ledger.', modelOverride: 'local-model-7b', sheets: { [world.body.id]: { stats: { grit: 2 } } },
  } })
  const wren = await t.call('/api/characters', 'POST', { cookie: ash, body: { card: { name: 'Wren' }, worldId: world.body.id, playerOnly: true } })
  const book = await t.call('/api/world-info-books', 'POST', { cookie: ash, body: { name: 'Coast lore', book: { entries: [] }, boundWorldIds: [world.body.id], boundCharacterIds: [cole.body.id] } })
  const chat = await t.call('/api/chats', 'POST', { cookie: ash, body: { characterId: cole.body.id, title: 'Night watch' } })
  await t.call('/api/messages', 'POST', { cookie: ash, body: { chatId: chat.body.id, role: 'user', text: 'PLAY-HISTORY: I climb the stairs.' } })
  return { world: world.body, cole: cole.body, wren: wren.body, book: book.body }
}

async function exportZip(cookie: string, body: unknown) {
  const started = await t.call('/api/packs/export', 'POST', { cookie, body })
  expect(started.status).toBe(201)
  const download = await t.call(started.body.url, 'GET', { cookie })
  expect(download.status).toBe(200)
  expect(download.headers['content-type']).toBe('application/zip')
  return { files: unzipSync(new Uint8Array(download.raw)), disposition: String(download.headers['content-disposition']), url: started.body.url as string }
}

describe('world pack export', () => {
  it('previews what goes in, with counts and sizes, before packing anything', async () => {
    const { world, wren } = await makeWorld()
    const preview = await t.call('/api/packs/export-preview', 'POST', { cookie: ash, body: { worldId: world.id } })
    expect(preview.status).toBe(200)
    expect(preview.body.included).toContainEqual({ label: 'Cast', count: 1 })
    expect(preview.body.included.find((l: { media?: string }) => l.media === 'music')).toMatchObject({ count: 1, bytes: expect.any(Number) })
    expect(preview.body.excluded).toEqual(expect.arrayContaining(['Stories, scenes, chats, and messages', 'GM notes', 'Canon facts from play (1)', 'Player cards (1)']))
    expect(preview.body.characters).toContainEqual({ id: wren.id, name: 'Wren', playerOnly: true, included: false })
    expect(preview.body.media.map((m: { label: string }) => m.label)).toEqual(expect.arrayContaining(['Salt Coast: music.default', 'Cole Marsh: sprites.neutral']))
    expect(preview.body.mediaBytes).toBeGreaterThan(0)
    expect(preview.body.missingMedia).toBe(0)
  })

  it('streams a folder with the manifest, content, and each media file once', async () => {
    const { world } = await makeWorld()
    const { files, disposition } = await exportZip(ash, { worldId: world.id, metadata: { title: 'Salt Coast', author: 'Ash', licence: 'CC-BY-4.0', credits: [{ path: world.music.default, title: 'Fog theme', author: 'Bea', licence: 'CC0' }] } })
    expect(disposition).toContain('filename="Salt Coast.ltpack.zip"')
    const names = Object.keys(files)
    expect(names.every((n) => n.startsWith('Salt Coast.ltpack/'))).toBe(true)
    const read = (name: string) => JSON.parse(strFromU8(files[`Salt Coast.ltpack/${name}`]))
    const manifest = read('manifest.json')
    const content = { world: read('content/world.json'), characters: read('content/characters.json'), lorebooks: read('content/lorebooks.json') }
    expect(manifest).toMatchObject({ kind: 'lost-tales-world-pack', formatVersion: 1, title: 'Salt Coast', author: 'Ash', licence: 'CC-BY-4.0' })
    // Red, blue, and the track: three files, although red is used three times.
    const media = names.filter((n) => n.includes('/media/'))
    expect(media).toHaveLength(3)
    expect(manifest.media.map((m: { file: string }) => `Salt Coast.ltpack/media/${m.file}`).sort()).toEqual(media.sort())
    for (const m of manifest.media) expect(files[`Salt Coast.ltpack/media/${m.file}`].length).toBe(m.bytes)
    const track = manifest.media.find((m: { file: string }) => m.file.endsWith('.mp3'))
    expect(manifest.credits).toEqual([{ file: track.file, title: 'Fog theme', author: 'Bea', licence: 'CC0' }])
    expect(content.world.avatarDataUrl).toBe(content.world.backgrounds.harbor)
    expect(content.world.music.default).toBe(`ltpack-media:${track.file}`)
    expect(content.characters.map((c: { card: { name: string } }) => c.card.name)).toEqual(['Cole Marsh'])
    expect(content.lorebooks).toMatchObject([{ key: 'lorebook-1', name: 'Coast lore', boundWorldKeys: ['world'], boundCharacterKeys: ['character-1'] }])

    const everything = JSON.stringify(content) + JSON.stringify(manifest)
    for (const secret of ['/avatars/', 'SPOILER', 'SECRET-MEMORY', 'local-model-7b', 'PLAY-HISTORY', 'grit', world.id]) expect(everything).not.toContain(secret)
  })

  it('packs only what was chosen', async () => {
    const { world } = await makeWorld()
    const { files } = await exportZip(ash, { worldId: world.id, selection: { lore: false, cast: false, gmNotes: true, media: { portraits: false, sprites: false, backgrounds: false, music: false, gallery: false } } })
    const names = Object.keys(files)
    expect(names.filter((n) => n.includes('/media/'))).toEqual([])
    const worldJson = JSON.parse(strFromU8(files['Salt Coast.ltpack/content/world.json']))
    expect(worldJson).not.toHaveProperty('lorebook')
    expect(worldJson.gmNotes).toContain('SPOILER')
    expect(JSON.parse(strFromU8(files['Salt Coast.ltpack/content/characters.json']))).toEqual([])
  })

  it('exports only for someone who can see the world, from their own link', async () => {
    const { world } = await makeWorld()
    await t.call(`/api/worlds/${world.id}`, 'PUT', { cookie: ash, body: { visibility: 'private' } })
    expect((await t.call('/api/packs/export', 'POST', { cookie: bea, body: { worldId: world.id } })).status).toBe(404)
    expect((await t.call('/api/packs/export-preview', 'POST', { cookie: bea, body: { worldId: world.id } })).status).toBe(404)
    const started = await t.call('/api/packs/export', 'POST', { cookie: ash, body: { worldId: world.id } })
    expect((await t.call(started.body.url, 'GET', { cookie: bea })).status).toBe(404)
    expect((await t.call('/api/packs/export/not-a-token', 'GET', { cookie: ash })).status).toBe(404)
  })
})
