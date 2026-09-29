import { describe, expect, it } from 'vitest'
import { DEFAULT_PACK_SELECTION, PACK_MEDIA_PREFIX, WORLD_PACK_FORMAT_VERSION, WORLD_PACK_KIND, type PackSelection } from '../src/lib/packs/contract.ts'
import { CHARACTER_FIELDS, CHARACTER_PACK_FIELDS, CHARACTER_PACK_WORLD_FIELDS, WORLD_FIELDS } from '../src/lib/packs/fields.ts'
import {
  PackError,
  buildManifest,
  findConflicts,
  importedName,
  mapMedia,
  parseContent,
  parseManifest,
  planExport,
  planImport,
  withPackMedia,
} from './packPlan.ts'

const W = 'world-uuid'
const world = {
  id: W,
  name: 'Salt Coast',
  description: 'A fishing coast under a long fog.',
  rules: 'No firearms.',
  template: 'story',
  campaign: { ruleset: 'Starter', mode: 'guided', resolver: 'pbta', relationships: false, dating: false, moves: [] },
  lorebook: { entries: [{ keys: ['fog'], content: 'The fog hides the reef.' }] },
  promptItems: [{ id: 'p1', text: 'Keep it bleak.' }],
  triggers: [{ id: 't1', when: [], then: [] }],
  gmNotes: 'SPOILER: the lighthouse keeper is the smuggler.',
  canonFacts: [{ id: 'f1', text: 'SPOILER-FACT: Bea sank the ferry.', createdAt: 1 }],
  currentDay: 40,
  currentPhaseIndex: 2,
  avatarDataUrl: '/avatars/worlds/world-uuid/avatar.png?t=1',
  backgrounds: { harbor: '/avatars/worlds/world-uuid/backgrounds/harbor.png', dock: '/avatars/shared/dock.png' },
  backgroundsNight: { harbor: '/avatars/worlds/world-uuid/backgrounds-night/harbor.png' },
  music: { default: '/avatars/worlds/world-uuid/music/default.mp3', storm: 'https://example.invalid/storm.mp3' },
  ownerUserId: 'user-a',
  visibility: 'shared',
  createdAt: 1,
  updatedAt: 2,
}
const bea = {
  id: 'bea-uuid',
  worldId: W,
  card: { name: 'Bea Holt', description: 'A ferry pilot.' },
  occupation: 'pilot',
  avatarDataUrl: '/avatars/characters/bea-uuid/avatar.png',
  sprites: { neutral: '/avatars/characters/bea-uuid/sprites/neutral.png', 'coat--neutral': '/avatars/shared/dock.png' },
  spriteVariants: { neutral: ['/avatars/characters/bea-uuid/sprites-variants/neutral-alt0.png'] },
  gallery: [{ id: 'cg-1', title: 'Night crossing', imageUrl: '/avatars/characters/bea-uuid/gallery/cg-1.png', unlockAffection: 40, variants: ['/avatars/characters/bea-uuid/gallery-variants/cg-1-alt0.png'] }],
  vrm: { url: '/avatars/characters/bea-uuid/model.vrm', enabled: true },
  privateMemory: 'SECRET-MEMORY: Bea hid the ledger.',
  sheets: { [W]: { worldId: W, stats: { grit: 2 }, rank: 'Pilot' }, 'other-world': { worldId: 'other-world', stats: { grit: 9 } } },
  modelOverride: 'local-model-7b',
  instructTemplateId: 'my-template',
  voiceFingerprint: { pitch: 1 },
  spriteSources: { neutral: 'abc' },
  socialConnections: [{ id: 'conn-0', name: 'Cole Marsh', relation: 'rival' }],
  ownerUserId: 'user-a',
  createdAt: 1,
  updatedAt: 1,
}
const cole = { id: 'cole-uuid', worldId: W, card: { name: 'Cole Marsh' }, sheet: { worldId: W, stats: { grit: 1 } }, createdAt: 1, updatedAt: 1 }
const wren = { id: 'wren-uuid', worldId: W, playerOnly: true, card: { name: 'Wren' }, sheets: { [W]: { stats: { grit: 3 } } }, createdAt: 1, updatedAt: 1 }
const elsewhere = { id: 'ash-uuid', worldId: 'other-world', card: { name: 'Ash' }, createdAt: 1, updatedAt: 1 }
const books = [
  { id: 'book-world', name: 'Coast lore', book: { entries: [] }, boundWorldIds: [W], boundCharacterIds: [], boundChatIds: ['chat-1'], createdAt: 1 },
  { id: 'book-bea', name: 'Bea notes', book: { entries: [] }, boundWorldIds: [], boundCharacterIds: ['bea-uuid', 'ash-uuid'], boundChatIds: [], createdAt: 1 },
  { id: 'book-other', name: 'Elsewhere', book: { entries: [] }, boundWorldIds: ['other-world'], boundChatIds: [], createdAt: 1 },
  { id: 'book-global', name: 'Global', book: { entries: [] }, boundWorldIds: [], boundChatIds: [], createdAt: 1 },
]
const input = { world, characters: [bea, cole, wren, elsewhere], lorebooks: books }
const all: PackSelection = { ...DEFAULT_PACK_SELECTION, media: { portraits: true, sprites: true, backgrounds: true, music: true, gallery: true, models: true }, gmNotes: true, canonFacts: true, npcSheets: true, privateMemory: true, playerCards: true }

/** Fake hashing: each distinct path gets a stable 64-hex file name. */
function fileNames() {
  const files = new Map<string, string>()
  return (value: string) => {
    if (!files.has(value)) files.set(value, `${String(files.size + 1).padStart(64, '0')}.${value.split('?')[0].split('.').pop()}`)
    return files.get(value)
  }
}

describe('planExport', () => {
  it('leaves private play data out by default', () => {
    const plan = planExport(input)
    const json = JSON.stringify(plan.content)
    for (const secret of ['SPOILER', 'SECRET-MEMORY', 'local-model-7b', 'my-template', 'spriteSources', 'voiceFingerprint', 'currentDay', 'user-a', 'chat-1', 'grit']) {
      expect(json).not.toContain(secret)
    }
    expect(plan.content.characters.map((c) => (c.card as { name: string }).name)).toEqual(['Bea Holt', 'Cole Marsh'])
    expect(plan.content.characters.every((c) => !('id' in c) && !('worldId' in c) && !('createdAt' in c))).toBe(true)
    expect(plan.content.world).not.toHaveProperty('id')
    expect(plan.excluded).toEqual(expect.arrayContaining(['Stories, scenes, chats, and messages', 'GM notes', 'Canon facts from play (1)', 'Player cards (1)', 'Stat sheets', 'Private memory', 'VRM models']))
  })

  it('gives records pack-local keys and binds lore by key', () => {
    const { content, droppedReferences } = planExport(input)
    expect(content.world.key).toBe('world')
    expect(content.characters.map((c) => [c.key, c.worldKey])).toEqual([['character-1', 'world'], ['character-2', 'world']])
    expect(content.lorebooks.map((b) => [b.name, b.boundWorldKeys, b.boundCharacterKeys])).toEqual([
      ['Coast lore', ['world'], []],
      ['Bea notes', [], ['character-1']],
    ])
    expect(droppedReferences).toEqual([
      '"Coast lore" is also bound to chats; chats never travel.',
      '"Bea notes" is also bound to characters outside the pack; those bindings stay behind.',
    ])
  })

  it('carries the chosen options, and only a non-player\'s sheet for this world', () => {
    const { content, included } = planExport(input, all)
    expect(content.world.gmNotes).toContain('SPOILER')
    expect(content.characters.map((c) => (c.card as { name: string }).name)).toEqual(['Bea Holt', 'Cole Marsh', 'Wren'])
    expect(content.characters[0].sheets).toEqual({ world: { stats: { grit: 2 }, rank: 'Pilot' } })
    expect(content.characters[1].sheets).toEqual({ world: { stats: { grit: 1 } } })
    expect(content.characters[2]).not.toHaveProperty('sheets')
    expect(content.characters[0].privateMemory).toContain('SECRET-MEMORY')
    expect(included).toContainEqual({ label: 'Cast', count: 3 })
  })

  it('packs each local file once and leaves unchosen media out', () => {
    const plan = planExport(input)
    expect(plan.media.map((m) => m.value)).not.toContain('https://example.invalid/storm.mp3')
    expect(plan.media.filter((m) => m.value === '/avatars/shared/dock.png')).toHaveLength(1)
    expect(plan.media.some((m) => m.kind === 'models')).toBe(false)
    const noArt = planExport(input, { ...DEFAULT_PACK_SELECTION, media: { ...DEFAULT_PACK_SELECTION.media, sprites: false, gallery: false } })
    expect(noArt.content.characters[0]).not.toHaveProperty('sprites')
    expect(noArt.content.characters[0].gallery).toEqual([{ id: 'cg-1', title: 'Night crossing', imageUrl: '', unlockAffection: 40 }])
  })

  it('leaves a character out by name, and says so', () => {
    const plan = planExport(input, { ...DEFAULT_PACK_SELECTION, excludeCharacterIds: ['cole-uuid'] })
    expect(plan.content.characters).toHaveLength(1)
    expect(plan.excluded).toContain('Left out: Cole Marsh')
  })
})

describe('pack round trip', () => {
  it('imports into an empty library with every reference rewired and every media path resolved', () => {
    const plan = planExport(input, { ...all, playerCards: false })
    const packed = withPackMedia(plan.content, fileNames())
    expect(JSON.stringify(packed)).not.toContain('/avatars/')
    expect(packed.world.avatarDataUrl).toMatch(new RegExp(`^${PACK_MEDIA_PREFIX}0+1\\.png$`))
    const content = parseContent(JSON.parse(JSON.stringify(packed)))
    let n = 0
    const result = planImport(content, { worlds: [], characters: [] }, {
      ownerUserId: 'user-b', now: 100, newId: () => `new-${++n}`, mediaPath: (file) => `/avatars/pack-media/${file}`,
    })
    const worldId = result.world.id
    expect(result.world).toMatchObject({ action: 'insert', name: 'Salt Coast', row: { id: worldId, name: 'Salt Coast', ownerUserId: 'user-b', visibility: 'private', createdAt: 100 } })
    expect(result.world.row).not.toHaveProperty('key')
    const [b, c] = result.characters
    expect(b.row).toMatchObject({ id: b.id, worldId, card: { name: 'Bea Holt' }, sheets: { [worldId]: { worldId, stats: { grit: 2 }, rank: 'Pilot' } }, visibility: 'private' })
    expect(c.row).toMatchObject({ worldId, sheets: { [worldId]: { worldId, stats: { grit: 1 } } } })
    expect(b.row).not.toHaveProperty('worldKey')
    expect(result.lorebooks.map((book) => [book.name, book.boundWorldIds, book.boundCharacterIds, book.boundChatIds])).toEqual([
      ['Coast lore', [worldId], [], []],
      ['Bea notes', [], [b.id], []],
    ])
    // Every media value is now a path on this install; the shared dock art is one file used twice.
    const paths = JSON.stringify([result.world.row, b.row])
    expect(paths).not.toContain(PACK_MEDIA_PREFIX)
    expect((b.row!.sprites as Record<string, string>)['coat--neutral']).toBe((result.world.row!.backgrounds as Record<string, string>).dock)
    expect(b.row!.vrm).toMatchObject({ url: expect.stringMatching(/^\/avatars\/pack-media\/0+\d+\.vrm$/), enabled: true })
    expect(result.droppedReferences).toEqual([])
  })

  it('drops media a record names but the pack does not hold, and never keeps a raw path', () => {
    const plan = planExport(input)
    const packed = withPackMedia(plan.content, fileNames())
    // A hand-edited pack pointing at somebody's files on another install.
    packed.characters[0].avatarDataUrl = '/avatars/characters/someone-else/avatar.png'
    const result = planImport(parseContent(packed), { worlds: [], characters: [] }, {
      ownerUserId: 'u', now: 1, newId: () => crypto.randomUUID(), mediaPath: (file) => (file.startsWith('0000') && !file.endsWith('.mp3') ? `/avatars/pack-media/${file}` : undefined),
    })
    expect(result.characters[0].row).not.toHaveProperty('avatarDataUrl')
    expect(result.world.row).not.toHaveProperty('music')
    expect(result.droppedReferences.some((line) => line.startsWith('A media file the pack names but does not hold'))).toBe(true)
  })

  it('keeps a book that lost its bindings on the world rather than letting it turn global', () => {
    const content = parseContent({ world: { key: 'world', name: 'X' }, characters: [], lorebooks: [{ key: 'lorebook-1', name: 'Orphan', book: {}, boundCharacterKeys: ['character-9'] }] })
    const result = planImport(content, { worlds: [], characters: [] }, { ownerUserId: 'u', now: 1, newId: () => `id-${Math.random()}`, mediaPath: () => undefined })
    expect(result.lorebooks[0].boundWorldIds).toEqual([result.world.id])
    expect(result.droppedReferences).toHaveLength(1)
  })
})

describe('import conflicts', () => {
  const content = parseContent(withPackMedia(planExport(input).content, fileNames()))
  const existing = { worlds: [{ id: 'mine', name: 'salt coast' }], characters: [{ id: 'my-bea', card: { name: 'Bea Holt' } }, { id: 'x', card: { name: 'Bea Holt (imported)' } }] }
  const base = { ownerUserId: 'u', now: 5, newId: (() => { let n = 0; return () => `n${++n}` })(), mediaPath: (f: string) => `/avatars/pack-media/${f}` }

  it('finds same-named worlds and characters, ignoring case', () => {
    expect(findConflicts(content, existing)).toEqual([
      { key: 'world', kind: 'world', name: 'Salt Coast', existingId: 'mine' },
      { key: 'character-1', kind: 'character', name: 'Bea Holt', existingId: 'my-bea' },
    ])
  })

  it('imports a copy by default, under a free name, and never touches the existing one', () => {
    const result = planImport(content, existing, base)
    expect(result.world).toMatchObject({ action: 'insert', name: 'Salt Coast (imported)' })
    expect(result.characters[0]).toMatchObject({ action: 'insert', name: 'Bea Holt (imported 2)', row: { card: { name: 'Bea Holt (imported 2)' } } })
    expect(result.world.id).not.toBe('mine')
    expect(importedName('A', ['a (imported)', 'A (imported 2)'])).toBe('A (imported 3)')
  })

  it('skips onto the existing record, keeping references to it', () => {
    const result = planImport(content, existing, { ...base, resolutions: { world: 'skip', 'character-1': 'skip' } })
    expect(result.world).toEqual({ key: 'world', name: 'Salt Coast', action: 'skip', id: 'mine' })
    expect(result.characters[1].row?.worldId).toBe('mine')
    expect(result.lorebooks.find((b) => b.name === 'Bea notes')?.boundCharacterIds).toEqual(['my-bea'])
    expect(result.skipped).toEqual(['Salt Coast', 'Bea Holt'])
  })

  it('replaces only with confirmation, and keeps the existing id', () => {
    expect(() => planImport(content, existing, { ...base, resolutions: { world: 'replace' } })).toThrow(PackError)
    const result = planImport(content, existing, { ...base, resolutions: { world: 'replace' }, confirmReplace: true })
    expect(result.world).toMatchObject({ action: 'update', id: 'mine', row: { name: 'Salt Coast', updatedAt: 5 } })
    expect(result.world.row).not.toHaveProperty('ownerUserId')
    expect(result.replaced).toEqual(['Salt Coast'])
  })
})

describe('reading a pack', () => {
  const manifest = buildManifest(planExport(input), { title: 'Salt Coast', licence: 'CC-BY-4.0', credits: [{ title: 'Storm theme', author: 'Cole', licence: 'CC0', file: `${'a'.repeat(64)}.mp3` }, { junk: true }] },
    DEFAULT_PACK_SELECTION, [{ file: `${'a'.repeat(64)}.mp3`, mime: 'audio/mpeg', bytes: 10 }], { music: 10 }, '0.1.0', 7)

  it('writes and reads back a manifest', () => {
    const read = parseManifest(JSON.parse(JSON.stringify(manifest)))
    expect(read).toMatchObject({ kind: WORLD_PACK_KIND, formatVersion: WORLD_PACK_FORMAT_VERSION, title: 'Salt Coast', licence: 'CC-BY-4.0', exportedAt: 7 })
    expect(read.credits).toEqual([{ file: `${'a'.repeat(64)}.mp3`, title: 'Storm theme', author: 'Cole', licence: 'CC0' }])
    expect(read.included).toContainEqual({ label: 'Music', media: 'music', count: 1, bytes: 10 })
  })

  it('refuses a newer format, another kind of file, and media it cannot hold', () => {
    expect(() => parseManifest({ ...manifest, formatVersion: WORLD_PACK_FORMAT_VERSION + 1 })).toThrow(/newer version/)
    expect(() => parseManifest({ kind: 'rp-character-pack' })).toThrow(/not a Lost Tales world pack/)
    for (const file of ['../evil.png', `${'a'.repeat(64)}.svg`, `${'a'.repeat(64)}.html`, 'x.png']) {
      expect(() => parseManifest({ ...manifest, media: [{ file, bytes: 1 }] })).toThrow(PackError)
    }
  })

  it('refuses content without proper keys or names', () => {
    expect(() => parseContent({ world: { key: 'world' }, characters: [], lorebooks: [] })).toThrow(/no name/)
    expect(() => parseContent({ world: { key: 'world', name: 'X' }, characters: [{ key: 'world', card: { name: 'A' } }], lorebooks: [] })).toThrow(/proper key/)
    expect(() => parseContent({ world: { key: 'world', name: 'X' }, characters: [{ key: 'a', card: {} }], lorebooks: [] })).toThrow(/without a name/)
  })
})

describe('field lists', () => {
  it('keep local and private fields out of the character pack too', () => {
    for (const field of CHARACTER_PACK_FIELDS) expect(['local', 'privateMemory', 'record']).not.toContain(CHARACTER_FIELDS[field])
    for (const field of CHARACTER_PACK_WORLD_FIELDS) expect(['local', 'gmNotes', 'canonFacts', 'record']).not.toContain(WORLD_FIELDS[field])
  })

  it('know where every kind of media lives', () => {
    const seen: string[] = []
    mapMedia('character', bea, (value, kind) => { seen.push(`${kind}:${value.split('/').pop()}`); return value })
    expect(seen).toEqual(['portraits:avatar.png', 'sprites:neutral.png', 'sprites:dock.png', 'sprites:neutral-alt0.png', 'models:model.vrm', 'gallery:cg-1.png', 'gallery:cg-1-alt0.png'])
  })
})
