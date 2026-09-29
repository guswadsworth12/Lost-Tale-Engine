/**
 * Planning half of world packs (`packs.ts` has the routes and the files). Kept free of any database
 * or filesystem import so it can be tested without either. See `src/lib/packs/contract.ts` for the
 * format and `src/lib/packs/fields.ts` for which fields travel.
 */

import {
  PACK_MEDIA_PREFIX,
  PACK_WORLD_KEY,
  WORLD_PACK_FORMAT_VERSION,
  WORLD_PACK_KIND,
  DEFAULT_PACK_SELECTION,
  type ConflictResolution,
  type PackConflict,
  type PackCredit,
  type PackMediaEntry,
  type PackSelection,
  type PackSummaryLine,
  type WorldPackContent,
  type WorldPackManifest,
} from '../src/lib/packs/contract.ts'
import { CHARACTER_FIELDS, LOREBOOK_FIELDS, WORLD_FIELDS, type MediaKind } from '../src/lib/packs/fields.ts'

type Row = Record<string, unknown>

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : [])
const nameOf = (character: Row) => str((character.card as Row | undefined)?.name) || 'Unnamed character'

// ---- Media ---------------------------------------------------------------------------------------

/** The only media a pack carries, by extension. No SVG, no scripts, nothing a browser would run. */
export const PACK_MEDIA_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  wav: 'audio/wav',
  webm: 'audio/webm',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  vrm: 'model/gltf-binary',
}

export const PACK_MEDIA_FILE_RE = new RegExp(`^[0-9a-f]{64}\\.(${Object.keys(PACK_MEDIA_TYPES).join('|')})$`)

/** A server path worth packing: one of this install's own files, or an inline upload. */
export function isLocalMedia(value: string): boolean {
  return value.startsWith('/avatars/') || value.startsWith('data:')
}

/** `slot` names where the value sits: `avatar`, `music.storm`, `sprites.neutral`, `gallery.cg-1`, `vrm`. */
type MediaMapper = (value: string, kind: MediaKind, slot: string) => string | undefined

function mapStringMap(value: unknown, kind: MediaKind, field: string, fn: MediaMapper): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const out: Record<string, string> = {}
  for (const [key, v] of Object.entries(value as Row)) {
    if (typeof v !== 'string' || !v) continue
    const mapped = fn(v, kind, `${field}.${key}`)
    if (mapped) out[key] = mapped
  }
  return out
}

/**
 * A copy of a world or character with every media field passed through `fn`: a path to pack, a
 * pack reference to resolve, or `undefined` to leave it out. The one list of where media lives,
 * used both ways, so export and import can't disagree about it.
 */
export function mapMedia(kind: 'world' | 'character', row: Row, fn: MediaMapper): Row {
  const out: Row = { ...row }
  const single = (field: string, media: MediaKind) => {
    if (typeof row[field] !== 'string' || !row[field]) return
    const mapped = fn(row[field] as string, media, field === 'avatarDataUrl' ? 'avatar' : field)
    if (mapped) out[field] = mapped
    else delete out[field]
  }
  const map = (field: string, media: MediaKind) => {
    if (!(field in row)) return
    const mapped = mapStringMap(row[field], media, field, fn)
    if (mapped && Object.keys(mapped).length) out[field] = mapped
    else delete out[field]
  }
  single('avatarDataUrl', 'portraits')
  if (kind === 'world') {
    map('backgrounds', 'backgrounds')
    map('backgroundsNight', 'backgrounds')
    map('music', 'music')
    return out
  }
  map('sprites', 'sprites')
  if (row.spriteVariants && typeof row.spriteVariants === 'object') {
    const variants: Record<string, string[]> = {}
    for (const [key, list] of Object.entries(row.spriteVariants as Row)) {
      const mapped = strings(list).map((v, i) => fn(v, 'sprites', `spriteVariants.${key}.${i + 1}`)).filter((v): v is string => !!v)
      if (mapped.length) variants[key] = mapped
    }
    if (Object.keys(variants).length) out.spriteVariants = variants
    else delete out.spriteVariants
  }
  const vrm = row.vrm as Row | undefined
  if (vrm && typeof vrm.url === 'string') {
    const url = fn(vrm.url, 'models', 'vrm')
    if (url) out.vrm = { ...vrm, url }
    else delete out.vrm
  }
  if (Array.isArray(row.gallery)) {
    // An entry's unlock rules are content; only its art is media. Without art it stays a placeholder.
    out.gallery = (row.gallery as Row[]).filter((g) => !!g && typeof g === 'object').map((g) => {
      const { variants, ...entry } = g
      const imageUrl = typeof g.imageUrl === 'string' && g.imageUrl ? fn(g.imageUrl, 'gallery', `gallery.${str(g.id, 90)}`) ?? '' : ''
      const kept = strings(variants).map((v, i) => fn(v, 'gallery', `gallery.${str(g.id, 90)}.${i + 1}`)).filter((v): v is string => !!v)
      return { ...entry, imageUrl, ...(kept.length ? { variants: kept } : {}) }
    })
  }
  return out
}

/** Every media value in a world or character, with its kind. */
export function mediaValues(kind: 'world' | 'character', row: Row): { value: string; kind: MediaKind; slot: string }[] {
  const found: { value: string; kind: MediaKind; slot: string }[] = []
  mapMedia(kind, row, (value, media, slot) => {
    found.push({ value, kind: media, slot })
    return value
  })
  return found
}

// ---- Export --------------------------------------------------------------------------------------

export interface ExportInput {
  world: Row
  /** Every character; the planner picks the world's cast. */
  characters: Row[]
  /** Every world-info book; the planner picks those bound to the world or its cast. */
  lorebooks: Row[]
}

export interface ExportPlan {
  /** Media fields still hold this install's paths; `withPackMedia` swaps them for pack references. */
  content: WorldPackContent
  /** Each local media path the content uses, once, with where it was first found (`owner` names the world or character). */
  media: { value: string; kind: MediaKind; slot: string; owner: string }[]
  included: PackSummaryLine[]
  excluded: string[]
  droppedReferences: string[]
  /** This install's ids of the cast the pack holds, in pack order. */
  characterIds: string[]
}

const MEDIA_LABEL: Record<MediaKind, string> = {
  portraits: 'Portraits',
  sprites: 'Sprites and outfits',
  backgrounds: 'Backgrounds, day and night',
  music: 'Music',
  gallery: 'Gallery art',
  models: 'VRM models',
}

/** Stories, chats, and everything personal: never in a pack, whatever is chosen. */
export const NEVER_EXPORTED = [
  'Stories, scenes, chats, and messages',
  'Character memories, journals, and recaps',
  'Objectives, relationship events, and chat facts',
  'Accounts, sessions, API keys, and preferences',
  'The world clock and story set events',
]

/** A selection from a request: known options only, anything missing at its default. */
export function normalizeSelection(raw: unknown): PackSelection {
  const v = raw && typeof raw === 'object' ? raw as Row : {}
  const media = v.media && typeof v.media === 'object' ? v.media as Row : {}
  const flag = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
  const d = DEFAULT_PACK_SELECTION
  return {
    lore: flag(v.lore, d.lore),
    worldContent: flag(v.worldContent, d.worldContent),
    cast: flag(v.cast, d.cast),
    media: Object.fromEntries((Object.keys(d.media) as MediaKind[]).map((k) => [k, flag(media[k], d.media[k])])) as PackSelection['media'],
    gmNotes: flag(v.gmNotes, d.gmNotes),
    canonFacts: flag(v.canonFacts, d.canonFacts),
    npcSheets: flag(v.npcSheets, d.npcSheets),
    privateMemory: flag(v.privateMemory, d.privateMemory),
    playerCards: flag(v.playerCards, d.playerCards),
    ...(Array.isArray(v.excludeCharacterIds) ? { excludeCharacterIds: strings(v.excludeCharacterIds).slice(0, 1000) } : {}),
  }
}

/** Plans what a pack of `input.world` holds under `selection`. Pure: reads nothing, writes nothing. */
export function planExport(input: ExportInput, selection: PackSelection = DEFAULT_PACK_SELECTION): ExportPlan {
  const { world } = input
  const worldId = str(world.id, 100)
  const excluded = [...NEVER_EXPORTED]
  const dropped: string[] = []

  const worldOut: Row = { key: PACK_WORLD_KEY }
  for (const [field, cls] of Object.entries(WORLD_FIELDS)) {
    const value = world[field]
    if (value === undefined || value === null) continue
    const take = cls === 'setting'
      || (cls === 'lore' && selection.lore)
      || (cls === 'worldContent' && selection.worldContent)
      || (cls === 'gmNotes' && selection.gmNotes)
      || (cls === 'canonFacts' && selection.canonFacts)
      || (cls.startsWith('media:') && selection.media[cls.slice(6) as MediaKind])
    if (take) worldOut[field] = value
  }
  if (!selection.gmNotes && str(world.gmNotes)) excluded.push('GM notes')
  const canon = Array.isArray(world.canonFacts) ? world.canonFacts.length : 0
  if (!selection.canonFacts && canon) excluded.push(`Canon facts from play (${canon})`)
  if (!selection.lore) excluded.push('Lore')
  if (!selection.worldContent) excluded.push('Prompt items, scenarios, triggers, gifts, items, and scene flags')
  for (const kind of Object.keys(MEDIA_LABEL) as MediaKind[]) if (!selection.media[kind]) excluded.push(MEDIA_LABEL[kind])

  // The world's cast. A card made to be played by a person, and anyone left out by name, stays behind.
  const living = input.characters.filter((c) => c.worldId === worldId)
  const players = living.filter((c) => c.playerOnly === true)
  const leftOut = new Set(selection.excludeCharacterIds ?? [])
  const cast = !selection.cast ? [] : living.filter((c) => (selection.playerCards || c.playerOnly !== true) && !leftOut.has(str(c.id, 100)))
  if (!selection.cast && living.length) excluded.push(`Cast (${living.length})`)
  if (selection.cast && !selection.playerCards && players.length) excluded.push(`Player cards (${players.length})`)
  const namedOut = living.filter((c) => leftOut.has(str(c.id, 100)) && (selection.playerCards || c.playerOnly !== true))
  if (selection.cast && namedOut.length) excluded.push(`Left out: ${namedOut.map(nameOf).join(', ')}`)
  if (!selection.npcSheets && cast.some((c) => c.sheet || c.sheets)) excluded.push('Stat sheets')
  if (!selection.privateMemory && cast.some((c) => str(c.privateMemory))) excluded.push('Private memory')

  const keyOf = new Map<string, string>()
  const characters = cast.map((c, i) => {
    const key = `character-${i + 1}`
    keyOf.set(str(c.id, 100), key)
    const out: Row = { key, worldKey: PACK_WORLD_KEY }
    for (const [field, cls] of Object.entries(CHARACTER_FIELDS)) {
      const value = c[field]
      if (value === undefined || value === null) continue
      if (cls === 'template' || (cls === 'privateMemory' && selection.privateMemory)) out[field] = value
      else if (cls.startsWith('media:')) {
        const media = cls.slice(6) as MediaKind
        // Gallery entries are content even when their art stays behind.
        if (selection.media[media] || field === 'gallery') out[field] = value
      }
    }
    if (!selection.media.gallery && Array.isArray(out.gallery)) {
      out.gallery = (out.gallery as Row[]).map(({ variants: _v, ...entry }) => ({ ...entry, imageUrl: '' }))
    }
    // A person's own sheet is theirs; a non-player's sheet for this world travels only when chosen.
    if (selection.npcSheets && c.playerOnly !== true) {
      const sheets = (c.sheets ?? {}) as Record<string, Row>
      const legacy = c.sheet as Row | undefined
      const sheet = sheets[worldId] ?? (legacy && (legacy.worldId === worldId || !legacy.worldId) ? legacy : undefined)
      if (sheet) {
        const { worldId: _w, ...rest } = sheet
        out.sheets = { [PACK_WORLD_KEY]: rest }
      }
    }
    return out
  })

  const lorebooks: Row[] = []
  if (selection.lore) {
    for (const book of input.lorebooks) {
      const worlds = strings(book.boundWorldIds)
      const chars = strings(book.boundCharacterIds)
      if (!worlds.includes(worldId) && !chars.some((id) => keyOf.has(id))) continue
      const name = str(book.name) || 'World-info book'
      const out: Row = { key: `lorebook-${lorebooks.length + 1}` }
      for (const [field, cls] of Object.entries(LOREBOOK_FIELDS)) if (cls === 'template' && book[field] !== undefined) out[field] = book[field]
      out.boundWorldKeys = worlds.includes(worldId) ? [PACK_WORLD_KEY] : []
      out.boundCharacterKeys = chars.filter((id) => keyOf.has(id)).map((id) => keyOf.get(id)!)
      if (worlds.some((id) => id !== worldId)) dropped.push(`"${name}" is also bound to another world; that binding stays behind.`)
      if (chars.some((id) => !keyOf.has(id))) dropped.push(`"${name}" is also bound to characters outside the pack; those bindings stay behind.`)
      if (strings(book.boundChatIds).length) dropped.push(`"${name}" is also bound to chats; chats never travel.`)
      lorebooks.push(out)
    }
  }

  const content: WorldPackContent = { world: worldOut, characters, lorebooks }
  const seen = new Set<string>()
  const media: ExportPlan['media'] = []
  for (const [kind, row] of [['world', worldOut] as const, ...characters.map((c) => ['character', c] as const)]) {
    for (const found of mediaValues(kind, row)) {
      if (!isLocalMedia(found.value) || seen.has(found.value)) continue
      seen.add(found.value)
      media.push({ ...found, owner: kind === 'world' ? str(worldOut.name) : nameOf(row) })
    }
  }

  const loreEntries = Array.isArray((world.lorebook as Row | undefined)?.entries) ? ((world.lorebook as Row).entries as unknown[]).length : 0
  const included: PackSummaryLine[] = [
    { label: 'World settings and rules' },
    ...(selection.lore ? [{ label: 'Lore entries', count: loreEntries }, { label: 'World-info books', count: lorebooks.length }] : []),
    ...(selection.worldContent ? [{ label: 'Prompt items, scenarios, triggers, gifts, items, and scene flags' }] : []),
    ...(selection.cast ? [{ label: 'Cast', count: characters.length }] : []),
    ...(selection.gmNotes && str(world.gmNotes) ? [{ label: 'GM notes' }] : []),
    ...(selection.canonFacts && canon ? [{ label: 'Canon facts from play', count: canon }] : []),
    ...(selection.npcSheets ? [{ label: 'Stat sheets', count: characters.filter((c) => c.sheets).length }] : []),
    ...(selection.privateMemory ? [{ label: 'Private memory', count: characters.filter((c) => c.privateMemory).length }] : []),
    ...(Object.keys(MEDIA_LABEL) as MediaKind[]).filter((k) => selection.media[k]).map((k) => ({ label: MEDIA_LABEL[k], media: k, count: media.filter((m) => m.kind === k).length })),
  ]
  return { content, media, included, excluded, droppedReferences: dropped, characterIds: cast.map((c) => str(c.id, 100)) }
}

/** The content with each local media path swapped for its pack reference (`fileFor` returns `<sha256>.<ext>`). */
export function withPackMedia(content: WorldPackContent, fileFor: (value: string) => string | undefined): WorldPackContent {
  const swap: MediaMapper = (value) => {
    if (!isLocalMedia(value)) return undefined
    const file = fileFor(value)
    return file ? `${PACK_MEDIA_PREFIX}${file}` : undefined
  }
  return {
    world: mapMedia('world', content.world, swap),
    characters: content.characters.map((c) => mapMedia('character', c, swap)),
    lorebooks: content.lorebooks,
  }
}

/** The manifest for a planned pack. `bytesByKind` sizes each media line once the files are read. */
export function buildManifest(plan: ExportPlan, meta: unknown, selection: PackSelection, media: PackMediaEntry[], bytesByKind: Partial<Record<MediaKind, number>>, appVersion: string, now: number): WorldPackManifest {
  return {
    kind: WORLD_PACK_KIND,
    formatVersion: WORLD_PACK_FORMAT_VERSION,
    appVersion,
    exportedAt: now,
    ...normalizeMetadata(meta),
    selection,
    included: plan.included.map((line) => (line.media ? { ...line, bytes: bytesByKind[line.media] ?? 0 } : line)),
    excluded: [...plan.excluded, ...plan.droppedReferences],
    media,
  }
}

/** A safe folder and file name for the pack: "The Salt Coast" → "The Salt Coast". */
export function packBaseName(title: string): string {
  return title.replace(/[^a-z0-9 _()-]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'world'
}

// ---- Reading a pack ------------------------------------------------------------------------------

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) || undefined : undefined)

export function normalizeMetadata(raw: unknown): { title: string; author?: string; description?: string; licence?: string; credits?: PackCredit[] } {
  const v = raw && typeof raw === 'object' ? raw as Row : {}
  const credits = Array.isArray(v.credits) ? v.credits.slice(0, 500).flatMap((c: unknown) => {
    if (!c || typeof c !== 'object') return []
    const r = c as Row
    const credit: PackCredit = {
      ...(typeof r.file === 'string' && PACK_MEDIA_FILE_RE.test(r.file) ? { file: r.file } : {}),
      ...(text(r.title, 200) ? { title: text(r.title, 200) } : {}),
      ...(text(r.source, 500) ? { source: text(r.source, 500) } : {}),
      ...(text(r.author, 200) ? { author: text(r.author, 200) } : {}),
      ...(text(r.licence, 100) ? { licence: text(r.licence, 100) } : {}),
    }
    return credit.title || credit.source || credit.author || credit.licence ? [credit] : []
  }) : []
  return {
    title: text(v.title, 200) ?? 'Untitled world',
    ...(text(v.author, 200) ? { author: text(v.author, 200) } : {}),
    ...(text(v.description, 4000) ? { description: text(v.description, 4000) } : {}),
    ...(text(v.licence, 100) ? { licence: text(v.licence, 100) } : {}),
    ...(credits.length ? { credits } : {}),
  }
}

export class PackError extends Error {}

/** Reads a manifest, refusing one from a newer format and anything that isn't a world pack. */
export function parseManifest(raw: unknown): WorldPackManifest {
  if (!raw || typeof raw !== 'object' || (raw as Row).kind !== WORLD_PACK_KIND) throw new PackError('This is not a Lost Tales world pack.')
  const v = raw as Row
  const version = v.formatVersion
  if (!Number.isInteger(version) || (version as number) < 1) throw new PackError('This pack has no valid format version.')
  if ((version as number) > WORLD_PACK_FORMAT_VERSION) {
    throw new PackError(`This pack was made by a newer version of Lost Tales (format ${version}). Update this install to import it.`)
  }
  const media = Array.isArray(v.media) ? v.media : []
  const files = new Set<string>()
  const entries: PackMediaEntry[] = []
  for (const m of media.slice(0, 20_000)) {
    const r = m as Row
    if (!r || typeof r.file !== 'string' || !PACK_MEDIA_FILE_RE.test(r.file) || files.has(r.file)) throw new PackError('The pack lists a media file it cannot hold.')
    if (!Number.isInteger(r.bytes) || (r.bytes as number) < 0) throw new PackError(`The pack gives no size for ${r.file}.`)
    files.add(r.file)
    entries.push({ file: r.file, mime: PACK_MEDIA_TYPES[r.file.split('.').pop()!], bytes: r.bytes as number })
  }
  const selection = v.selection && typeof v.selection === 'object' ? v.selection as PackSelection : DEFAULT_PACK_SELECTION
  const lines = (l: unknown) => (Array.isArray(l) ? l.slice(0, 100) : [])
  return {
    kind: WORLD_PACK_KIND,
    formatVersion: version as number,
    appVersion: text(v.appVersion, 40) ?? 'unknown',
    exportedAt: typeof v.exportedAt === 'number' ? v.exportedAt : 0,
    ...normalizeMetadata(v),
    selection,
    included: lines(v.included).flatMap((l: unknown) => {
      const r = l as Row
      const label = text(r?.label, 200)
      const media = typeof r?.media === 'string' && r.media in MEDIA_LABEL ? r.media as MediaKind : undefined
      return label ? [{ label, ...(Number.isInteger(r.count) ? { count: r.count as number } : {}), ...(Number.isInteger(r.bytes) ? { bytes: r.bytes as number } : {}), ...(media ? { media } : {}) }] : []
    }),
    excluded: lines(v.excluded).flatMap((l: unknown) => (text(l, 300) ? [text(l, 300)!] : [])),
    media: entries,
  }
}

const MAX_CHARACTERS = 500
const MAX_LOREBOOKS = 200

/** Reads a pack's records and checks their keys, so every later lookup by key is safe. */
export function parseContent(raw: { world: unknown; characters: unknown; lorebooks: unknown }): WorldPackContent {
  const world = raw.world
  if (!world || typeof world !== 'object' || Array.isArray(world) || (world as Row).key !== PACK_WORLD_KEY) throw new PackError('The pack has no world in it.')
  if (!str((world as Row).name)) throw new PackError('The pack\'s world has no name.')
  const list = (v: unknown, what: string, max: number) => {
    if (v === undefined) return []
    if (!Array.isArray(v)) throw new PackError(`The pack's ${what} are not a list.`)
    if (v.length > max) throw new PackError(`The pack has more than ${max} ${what}.`)
    return v.filter((r): r is Row => !!r && typeof r === 'object' && !Array.isArray(r))
  }
  const characters = list(raw.characters, 'characters', MAX_CHARACTERS)
  const lorebooks = list(raw.lorebooks, 'world-info books', MAX_LOREBOOKS)
  const keys = new Set<string>([PACK_WORLD_KEY])
  for (const row of [...characters, ...lorebooks]) {
    const key = row.key
    if (typeof key !== 'string' || !/^[a-z0-9-]{1,40}$/.test(key) || keys.has(key)) throw new PackError('The pack has a record without a proper key.')
    keys.add(key)
  }
  for (const c of characters) {
    if (!c.card || typeof c.card !== 'object' || !str((c.card as Row).name)) throw new PackError('The pack has a character without a name.')
  }
  return { world: world as Row, characters, lorebooks }
}

// ---- Import --------------------------------------------------------------------------------------

/** Same-named worlds and characters already in the importer's library. */
export function findConflicts(content: WorldPackContent, existing: { worlds: Row[]; characters: Row[] }): PackConflict[] {
  const key = (s: string) => s.trim().toLowerCase()
  const conflicts: PackConflict[] = []
  const worldName = str(content.world.name)
  const world = existing.worlds.find((w) => key(str(w.name)) === key(worldName))
  if (world) conflicts.push({ key: PACK_WORLD_KEY, kind: 'world', name: worldName, existingId: str(world.id, 100) })
  for (const c of content.characters) {
    const name = nameOf(c)
    const hit = existing.characters.find((e) => key(nameOf(e)) === key(name))
    if (hit) conflicts.push({ key: str(c.key, 40), kind: 'character', name, existingId: str(hit.id, 100) })
  }
  return conflicts
}

/** "Name (imported)", or "(imported 2)" and on, whichever is free. */
export function importedName(name: string, taken: readonly string[]): string {
  const used = new Set(taken.map((t) => t.trim().toLowerCase()))
  let candidate = `${name} (imported)`
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${name} (imported ${n})`
  return candidate
}

export interface ImportStep {
  key: string
  name: string
  action: 'insert' | 'update' | 'skip'
  id: string
  /** The record to write: all of it for `insert`, the pack's fields for `update`. Absent for `skip`. */
  row?: Row
}

export interface ImportPlan {
  world: ImportStep
  characters: ImportStep[]
  lorebooks: Row[]
  /** References the importer left out, and media a record named but the pack did not hold. */
  droppedReferences: string[]
  skipped: string[]
  replaced: string[]
}

export interface ImportOptions {
  resolutions?: Record<string, ConflictResolution>
  confirmReplace?: boolean
  ownerUserId: string
  now: number
  newId: () => string
  /** Where a packed media file ends up on this install, or undefined when the pack doesn't hold it. */
  mediaPath: (file: string) => string | undefined
}

/**
 * Plans importing `content` into a library holding `existing` (what the importer can see). Every
 * record gets a new id unless a conflict says to skip (use the existing one) or replace (overwrite
 * it, only with `confirmReplace`). Everything created is private to the importer.
 */
export function planImport(content: WorldPackContent, existing: { worlds: Row[]; characters: Row[] }, opts: ImportOptions): ImportPlan {
  const conflicts = findConflicts(content, existing)
  const resolutionOf = (key: string) => opts.resolutions?.[key] ?? 'copy'
  if (conflicts.some((c) => resolutionOf(c.key) === 'replace') && !opts.confirmReplace) {
    throw new PackError('Replacing something already in your library needs confirming.')
  }
  const dropped: string[] = []
  const skipped: string[] = []
  const replaced: string[] = []
  const takenWorldNames = existing.worlds.map((w) => str(w.name))
  const takenCharacterNames = existing.characters.map(nameOf)

  const media: MediaMapper = (value) => {
    if (!value.startsWith(PACK_MEDIA_PREFIX)) return undefined
    const path = opts.mediaPath(value.slice(PACK_MEDIA_PREFIX.length))
    if (!path) dropped.push(`A media file the pack names but does not hold (${value.slice(PACK_MEDIA_PREFIX.length, PACK_MEDIA_PREFIX.length + 12)}…) was left out.`)
    return path
  }
  const owned = { ownerUserId: opts.ownerUserId, visibility: 'private' }

  const step = (key: string, kind: 'world' | 'character', name: string, fields: Row, taken: string[], rename: (row: Row, name: string) => Row): ImportStep => {
    const conflict = conflicts.find((c) => c.key === key)
    const resolution = conflict ? resolutionOf(key) : 'copy'
    if (conflict && resolution === 'skip') {
      skipped.push(name)
      return { key, name, action: 'skip', id: conflict.existingId }
    }
    if (conflict && resolution === 'replace') {
      replaced.push(name)
      return { key, name, action: 'update', id: conflict.existingId, row: { ...fields, updatedAt: opts.now } }
    }
    const finalName = conflict ? importedName(name, taken) : name
    taken.push(finalName)
    const row = conflict ? rename(fields, finalName) : fields
    return { key, name: finalName, action: 'insert', id: opts.newId(), row: { ...row, ...owned, createdAt: opts.now, updatedAt: opts.now } }
  }

  const worldFields = recordFields('world', content.world, media)
  const world = step(PACK_WORLD_KEY, 'world', str(content.world.name), worldFields, takenWorldNames, (row, name) => ({ ...row, name }))
  if (world.row) world.row = { ...world.row, id: world.id }

  const idOf = new Map<string, string>([[PACK_WORLD_KEY, world.id]])
  const characters = content.characters.map((c) => {
    const key = str(c.key, 40)
    const fields = recordFields('character', c, media)
    if (c.worldKey !== undefined && c.worldKey !== PACK_WORLD_KEY) dropped.push(`${nameOf(c)} lived in a world outside the pack; they were imported without one.`)
    fields.worldId = c.worldKey === PACK_WORLD_KEY ? world.id : undefined
    const sheets = c.sheets && typeof c.sheets === 'object' ? c.sheets as Record<string, Row> : {}
    const sheet = sheets[PACK_WORLD_KEY]
    if (sheet && typeof sheet === 'object') fields.sheets = { [world.id]: { ...sheet, worldId: world.id } }
    if (Object.keys(sheets).some((k) => k !== PACK_WORLD_KEY)) dropped.push(`${nameOf(c)}'s sheets for other worlds were left out.`)
    const s = step(key, 'character', nameOf(c), fields, takenCharacterNames, (row, name) => ({ ...row, card: { ...(row.card as Row), name } }))
    if (s.row) s.row = { ...s.row, id: s.id }
    idOf.set(key, s.id)
    return s
  })

  const lorebooks = content.lorebooks.map((b) => {
    const out: Row = {}
    for (const [field, cls] of Object.entries(LOREBOOK_FIELDS)) if (cls === 'template' && b[field] !== undefined) out[field] = b[field]
    const worldKeys = strings(b.boundWorldKeys)
    const charKeys = strings(b.boundCharacterKeys)
    const missing = [...worldKeys, ...charKeys].filter((k) => !idOf.has(k))
    if (missing.length) dropped.push(`"${str(b.name) || 'A world-info book'}" was bound to something outside the pack; that binding was left out.`)
    const boundWorldIds = worldKeys.filter((k) => idOf.has(k)).map((k) => idOf.get(k)!)
    const boundCharacterIds = charKeys.filter((k) => idOf.has(k)).map((k) => idOf.get(k)!)
    // A book that lost every binding would turn global and reach every chat. Keep it on the world instead.
    return { ...out, id: opts.newId(), name: str(out.name) || 'World-info book', boundChatIds: [], boundWorldIds: boundWorldIds.length || boundCharacterIds.length ? boundWorldIds : [world.id], boundCharacterIds, ...owned, createdAt: opts.now }
  })

  return { world, characters, lorebooks, droppedReferences: [...new Set(dropped)], skipped, replaced }
}

/** A record's travelling fields with its media resolved. Keys, references, and anything local are left out. */
function recordFields(kind: 'world' | 'character', row: Row, media: MediaMapper): Row {
  const classes: Record<string, string> = kind === 'world' ? WORLD_FIELDS : CHARACTER_FIELDS
  const out: Row = {}
  for (const [field, value] of Object.entries(row)) {
    const cls = classes[field]
    if (!cls || cls === 'record' || cls === 'local' || cls === 'reference' || value === undefined || value === null) continue
    if (kind === 'character' && (field === 'sheet' || field === 'sheets')) continue
    out[field] = value
  }
  return mapMedia(kind, out, media)
}
