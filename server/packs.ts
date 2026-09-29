import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { avatarsDir, characterStore, dataDir, db, newId, worldInfoBookStore, worldStore } from './db.ts'
import { canSee, canSeeCharacter, userOf } from './access.ts'
import {
  PACK_MEDIA_TYPES,
  PackError,
  buildManifest,
  findConflicts,
  planImport,
  normalizeSelection,
  packBaseName,
  planExport,
  withPackMedia,
  type ExportPlan,
} from './packPlan.ts'
import { PACK_CONTENT_FILES, PACK_EXTENSION, type ConflictResolution, type PackApplyResult, type PackCredit, type PackMediaEntry, type PackPreview, type PackSelection, type WorldPackContent, type WorldPackManifest } from '../src/lib/packs/contract.ts'
import { PACK_LIMITS, extractZip, mediaProblem, packRelativePath, readPackFolder } from './packFiles.ts'
import type { MediaKind } from '../src/lib/packs/fields.ts'

/**
 * World packs over HTTP. Export streams the pack as a zip straight from disk, so neither the server
 * nor the browser holds a world's media in memory. See `packPlan.ts` for what goes in.
 */

type Row = Record<string, unknown>

export const packsRouter = express.Router()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const APP_VERSION = (() => {
  try {
    return String(JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')).version ?? 'unknown')
  } catch {
    return 'unknown'
  }
})()

const EXT_BY_MIME: Record<string, string> = Object.fromEntries(Object.entries(PACK_MEDIA_TYPES).map(([ext, mime]) => [mime, ext]))
EXT_BY_MIME['audio/mp3'] = 'mp3'
EXT_BY_MIME['audio/x-wav'] = 'wav'
EXT_BY_MIME['audio/x-m4a'] = 'm4a'

/** Where a media value's bytes live: a file of this install's, or an inline upload. Anything else isn't packable. */
type MediaSource = { kind: 'file'; file: string; ext: string } | { kind: 'data'; data: Buffer; ext: string }

export function mediaSource(value: string): MediaSource | undefined {
  if (value.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(value)
    const ext = match ? EXT_BY_MIME[match[1].toLowerCase()] : undefined
    return match && ext ? { kind: 'data', data: Buffer.from(match[2], 'base64'), ext } : undefined
  }
  if (!value.startsWith('/avatars/')) return undefined
  let relative: string
  try {
    relative = decodeURIComponent(value.slice('/avatars/'.length).split('?')[0])
  } catch {
    return undefined
  }
  const file = path.resolve(avatarsDir, relative)
  // Never outside the media folder, whatever the stored path says.
  if (!file.startsWith(path.resolve(avatarsDir) + path.sep)) return undefined
  const raw = path.extname(file).slice(1).toLowerCase()
  const ext = raw === 'jpeg' ? 'jpg' : raw
  if (!PACK_MEDIA_TYPES[ext] || !fs.existsSync(file) || !fs.statSync(file).isFile()) return undefined
  return { kind: 'file', file, ext }
}

async function hashOf(source: MediaSource): Promise<{ hash: string; bytes: number }> {
  if (source.kind === 'data') return { hash: crypto.createHash('sha256').update(source.data).digest('hex'), bytes: source.data.length }
  const hash = crypto.createHash('sha256')
  let bytes = 0
  for await (const chunk of fs.createReadStream(source.file)) {
    hash.update(chunk as Buffer)
    bytes += (chunk as Buffer).length
  }
  return { hash: hash.digest('hex'), bytes }
}

/** What the exporter chose, from a request. */
interface ExportRequest {
  worldId: string
  selection: PackSelection
  metadata: Row
  /** Credits naming media by its path on this install; turned into pack file names on export. */
  credits: (PackCredit & { path?: string })[]
}

function readExportRequest(body: unknown): ExportRequest | undefined {
  const v = body && typeof body === 'object' ? body as Row : {}
  if (typeof v.worldId !== 'string' || !v.worldId) return undefined
  const metadata = v.metadata && typeof v.metadata === 'object' ? v.metadata as Row : {}
  const credits = Array.isArray(metadata.credits) ? (metadata.credits as Row[]).slice(0, 500).filter((c) => !!c && typeof c === 'object') as (PackCredit & { path?: string })[] : []
  return { worldId: v.worldId, selection: normalizeSelection(v.selection), metadata, credits }
}

/** The plan for a world this user can see: only their visible cast and books are candidates. */
function planFor(req: express.Request, request: ExportRequest): { plan: ExportPlan; world: Row } | undefined {
  const world = worldStore.get(request.worldId)
  if (!world || !canSee(req, world)) return undefined
  const plan = planExport({
    world,
    characters: characterStore.list({ where: 'worldId = ?', params: [request.worldId] }).filter((c) => canSeeCharacter(req, c)),
    lorebooks: worldInfoBookStore.list().filter((b) => canSee(req, b)),
  }, request.selection)
  return { plan, world }
}

/**
 * What an export would hold, sized from the files as they are, before anything is packed: the
 * export dialog's checklist, counts, and sizes. Sizes count each stored file once.
 */
packsRouter.post('/api/packs/export-preview', (req, res) => {
  const request = readExportRequest(req.body)
  if (!request) return res.status(400).json({ error: 'Choose a world to export.' })
  const found = planFor(req, request)
  if (!found) return res.status(404).json({ error: 'Not found' })
  const { plan } = found
  const media = plan.media.flatMap((m) => {
    const source = mediaSource(m.value)
    if (!source) return []
    const bytes = source.kind === 'data' ? source.data.length : fs.statSync(source.file).size
    return [{ path: m.value, kind: m.kind, label: `${m.owner}: ${m.slot}`, bytes }]
  })
  const cast = characterStore.list({ where: 'worldId = ?', params: [request.worldId] }).filter((c) => canSeeCharacter(req, c))
  res.json({
    included: plan.included.map((line) => (line.media ? { ...line, bytes: media.filter((m) => m.kind === line.media).reduce((sum, m) => sum + m.bytes, 0) } : line)),
    excluded: plan.excluded,
    droppedReferences: plan.droppedReferences,
    characters: cast.map((c) => ({ id: c.id, name: (c.card as Row | undefined)?.name ?? '', playerOnly: c.playerOnly === true, included: plan.characterIds.includes(String(c.id)) })),
    media,
    mediaBytes: media.reduce((sum, m) => sum + m.bytes, 0),
    missingMedia: plan.media.length - media.length,
  })
})

const EXPORT_LINK_MS = 10 * 60 * 1000
const exportLinks = new Map<string, { userId: string; request: ExportRequest; expiresAt: number }>()

/**
 * Starts an export: answers with a one-user, short-lived download link. The browser opens it as a
 * plain download, so the zip streams to disk instead of into the page's memory.
 */
packsRouter.post('/api/packs/export', (req, res) => {
  const request = readExportRequest(req.body)
  const user = userOf(req)
  if (!request || !user) return res.status(400).json({ error: 'Choose a world to export.' })
  if (!planFor(req, request)) return res.status(404).json({ error: 'Not found' })
  const now = Date.now()
  for (const [token, link] of exportLinks) if (link.expiresAt < now) exportLinks.delete(token)
  const token = crypto.randomBytes(24).toString('base64url')
  exportLinks.set(token, { userId: user.id, request, expiresAt: now + EXPORT_LINK_MS })
  res.status(201).json({ url: `/api/packs/export/${token}`, expiresAt: now + EXPORT_LINK_MS })
})

packsRouter.get('/api/packs/export/:token', async (req, res) => {
  const link = exportLinks.get(req.params.token)
  const user = userOf(req)
  if (!link || link.expiresAt < Date.now() || link.userId !== user?.id) return res.status(404).json({ error: 'This export link has expired. Export again.' })
  const found = planFor(req, link.request)
  if (!found) return res.status(404).json({ error: 'Not found' })
  const { plan } = found

  // Hash every file first (streamed, so nothing is held): the manifest names each by its hash.
  const fileOf = new Map<string, string>()
  const sources = new Map<string, MediaSource>()
  const media: PackMediaEntry[] = []
  const bytesByKind: Partial<Record<MediaKind, number>> = {}
  for (const m of plan.media) {
    const source = mediaSource(m.value)
    if (!source) continue
    const { hash, bytes } = await hashOf(source)
    const file = `${hash}.${source.ext}`
    fileOf.set(m.value, file)
    bytesByKind[m.kind] = (bytesByKind[m.kind] ?? 0) + bytes
    if (sources.has(file)) continue
    sources.set(file, source)
    media.push({ file, mime: PACK_MEDIA_TYPES[source.ext], bytes })
  }
  const packed = withPackMedia(plan.content, (value) => fileOf.get(value))
  const credits = link.request.credits.map(({ path: p, ...credit }) => ({ ...credit, ...(p && fileOf.get(p) ? { file: fileOf.get(p) } : {}) }))
  const manifest = buildManifest(plan, { ...link.request.metadata, title: link.request.metadata.title || found.world.name, credits }, link.request.selection, media, bytesByKind, APP_VERSION, Date.now())
  const base = packBaseName(manifest.title)
  const folder = `${base}${PACK_EXTENSION}/`

  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="${base}${PACK_EXTENSION}.zip"`)
  res.setHeader('Cache-Control', 'no-store')
  const zip = new Zip((error, chunk, final) => {
    if (error) return res.destroy(error)
    res.write(chunk)
    if (final) res.end()
  })
  const addJson = (name: string, value: unknown) => {
    const entry = new ZipDeflate(`${folder}${name}`, { level: 6 })
    zip.add(entry)
    entry.push(new TextEncoder().encode(JSON.stringify(value, null, 2)), true)
  }
  try {
    addJson('manifest.json', manifest)
    addJson(PACK_CONTENT_FILES.world, packed.world)
    addJson(PACK_CONTENT_FILES.characters, packed.characters)
    addJson(PACK_CONTENT_FILES.lorebooks, packed.lorebooks)
    for (const [file, source] of sources) {
      // Art and audio are compressed already: stored, not deflated again.
      const entry = new ZipPassThrough(`${folder}media/${file}`)
      zip.add(entry)
      if (source.kind === 'data') {
        entry.push(source.data, true)
        continue
      }
      for await (const chunk of fs.createReadStream(source.file)) {
        entry.push(chunk as Buffer)
        if (res.writableNeedDrain) await once(res, 'drain')
        if (res.destroyed) return
      }
      entry.push(new Uint8Array(0), true)
    }
    zip.end()
  } catch (error) {
    res.destroy(error as Error)
  }
})

// ---- Import ------------------------------------------------------------------------------------

/**
 * How a pack's records become rows: the same builders `POST /api/worlds` and `POST /api/characters`
 * use, so an import is validated exactly like a create. Set by `app.ts`, which owns them.
 */
type RowBuilder = (id: string, body: Record<string, any>) => Row
let builders: { world: RowBuilder; character: RowBuilder } | undefined
export function usePackRowBuilders(value: { world: RowBuilder; character: RowBuilder }) {
  builders = value
}

/** Where imported media lives: one file per hash, shared by every record and every import that uses it. */
export const PACK_MEDIA_DIR = 'pack-media'
const uploadsDir = () => path.join(dataDir, 'pack-uploads')
const UPLOAD_MS = 60 * 60 * 1000

interface Upload {
  userId: string
  dir: string
  expiresAt: number
  files: number
  bytes: number
  zip: boolean
  preview?: { manifest: WorldPackManifest; content: WorldPackContent; media: Set<string>; warnings: string[] }
}

const uploads = new Map<string, Upload>()

function sweepUploads() {
  const now = Date.now()
  for (const [id, upload] of uploads) {
    if (upload.expiresAt >= now) continue
    uploads.delete(id)
    fs.rmSync(upload.dir, { recursive: true, force: true })
  }
}

/** The caller's own upload, or a 404 answered. */
function ownUpload(req: express.Request, res: express.Response, id: unknown): Upload | undefined {
  sweepUploads()
  const upload = typeof id === 'string' ? uploads.get(id) : undefined
  if (!upload || upload.userId !== userOf(req)?.id) {
    res.status(404).json({ error: 'This import has expired or was already finished. Start again.' })
    return undefined
  }
  return upload
}

const packError = (res: express.Response, error: unknown) => {
  if (error instanceof PackError) return res.status(400).json({ error: error.message })
  throw error
}

/** Starts an import: a private folder the pack's zip, or its unzipped files, are uploaded into. */
packsRouter.post('/api/packs/uploads', (req, res) => {
  sweepUploads()
  const user = userOf(req)
  if (!user) return res.status(401).json({ error: 'Sign in first' })
  const id = crypto.randomUUID()
  const dir = path.join(uploadsDir(), id)
  fs.mkdirSync(path.join(dir, 'pack'), { recursive: true })
  const expiresAt = Date.now() + UPLOAD_MS
  uploads.set(id, { userId: user.id, dir, expiresAt, files: 0, bytes: 0, zip: false })
  res.status(201).json({ uploadId: id, expiresAt })
})

/**
 * One file of an upload, as the raw request body, streamed to disk with its limits checked as it
 * arrives. `?path=` is `pack.zip` for a zipped pack, or a folder file's relative path. Folder files
 * that aren't part of a pack are skipped (204).
 */
packsRouter.put('/api/packs/uploads/:id/file', async (req, res) => {
  const upload = ownUpload(req, res, req.params.id)
  if (!upload) return
  if (upload.preview) return res.status(409).json({ error: 'This import is already being previewed.' })
  const name = typeof req.query.path === 'string' ? req.query.path : ''
  const isZip = /\.zip$/i.test(name) && !name.includes('/')
  let relative: string | undefined
  try {
    relative = isZip ? undefined : packRelativePath(name)
  } catch (error) {
    return packError(res, error)
  }
  if (++upload.files > PACK_LIMITS.fileCount) return res.status(413).json({ error: `A pack holds at most ${PACK_LIMITS.fileCount} files.` })
  if (!isZip && !relative) {
    req.resume()
    return res.status(204).end()
  }
  if (isZip && upload.zip) return res.status(409).json({ error: 'Upload one zip per import.' })
  const target = isZip ? path.join(upload.dir, 'upload.zip') : path.join(upload.dir, 'pack', relative!)
  const max = isZip ? PACK_LIMITS.totalBytes : relative!.endsWith('.json') ? PACK_LIMITS.jsonBytes : PACK_LIMITS.mediaBytes
  fs.mkdirSync(path.dirname(target), { recursive: true })
  let out: fs.WriteStream
  try {
    out = fs.createWriteStream(target, { flags: 'wx' })
    await once(out, 'open')
  } catch {
    return res.status(409).json({ error: `${name} was already uploaded.` })
  }
  let written = 0
  try {
    for await (const chunk of req) {
      written += (chunk as Buffer).length
      upload.bytes += (chunk as Buffer).length
      if (written > max || upload.bytes > PACK_LIMITS.totalBytes) throw new PackError('The pack is larger than a pack allows.')
      if (!out.write(chunk)) await once(out, 'drain')
    }
    out.end()
    await once(out, 'finish')
  } catch (error) {
    out.destroy()
    fs.rmSync(target, { force: true })
    if (error instanceof PackError) return res.status(413).json({ error: error.message })
    return res.status(400).json({ error: 'The upload was interrupted. Try again.' })
  }
  if (isZip) upload.zip = true
  res.status(204).end()
})

packsRouter.delete('/api/packs/uploads/:id', (req, res) => {
  const upload = ownUpload(req, res, req.params.id)
  if (!upload) return
  uploads.delete(req.params.id)
  fs.rmSync(upload.dir, { recursive: true, force: true })
  res.status(204).end()
})

/** What the importer can already see: where same-named records would collide. */
function visibleLibrary(req: express.Request) {
  return {
    worlds: worldStore.list().filter((w) => canSee(req, w)),
    characters: characterStore.list().filter((c) => canSeeCharacter(req, c)),
  }
}

/**
 * Opens an upload and checks everything in it: unpacks a zip under the limits, reads the manifest
 * and content, and checks each media file's size, hash, and kind. Nothing is written to the
 * library. Answers with what the import would create, its conflicts, and what it would leave out.
 */
packsRouter.post('/api/packs/preview', async (req, res) => {
  const upload = ownUpload(req, res, (req.body as Row | undefined)?.uploadId)
  if (!upload) return
  const packDir = path.join(upload.dir, 'pack')
  try {
    if (!upload.preview) {
      if (upload.zip) {
        fs.rmSync(packDir, { recursive: true, force: true })
        fs.mkdirSync(packDir, { recursive: true })
        await extractZip(path.join(upload.dir, 'upload.zip'), packDir)
        fs.rmSync(path.join(upload.dir, 'upload.zip'), { force: true })
      }
      const { manifest, content } = readPackFolder(packDir)
      const media = new Set<string>()
      const warnings: string[] = []
      for (const entry of manifest.media) {
        const problem = await mediaProblem(path.join(packDir, 'media', entry.file), entry)
        if (problem) warnings.push(`${problem} It was left out.`)
        else media.add(entry.file)
      }
      upload.preview = { manifest, content, media, warnings }
    }
  } catch (error) {
    uploads.delete(req.body.uploadId)
    fs.rmSync(upload.dir, { recursive: true, force: true })
    return packError(res, error)
  }
  const { manifest, content, media, warnings } = upload.preview
  const library = visibleLibrary(req)
  const dry = planImport(content, library, { ownerUserId: 'preview', now: 0, newId: () => 'preview', mediaPath: (file) => (media.has(file) ? file : undefined) })
  const preview: PackPreview = {
    previewId: req.body.uploadId,
    manifest,
    creates: { world: dry.world.name, characters: dry.characters.map((c) => c.name), lorebooks: dry.lorebooks.map((b) => String(b.name)) },
    mediaBytes: manifest.media.filter((m) => media.has(m.file)).reduce((sum, m) => sum + m.bytes, 0),
    mediaCount: media.size,
    conflicts: findConflicts(content, library),
    droppedReferences: dry.droppedReferences,
    warnings,
    expiresAt: upload.expiresAt,
  }
  res.json(preview)
})

/** A replace writes only the fields the pack has; the rest of the existing record stays as it was. */
function presentFields(built: Row, packRow: Row): Row {
  return Object.fromEntries(Object.entries(built).filter(([field]) => field in packRow))
}

/**
 * Applies a previewed import: every record in one transaction, as the importer's private records
 * (a replaced record keeps its owner and who sees it). Media moves into place only after the
 * transaction commits, so a failed import leaves nothing behind. An import applies once.
 */
packsRouter.post('/api/packs/apply', (req, res) => {
  const body = (req.body ?? {}) as Row
  const upload = ownUpload(req, res, body.previewId)
  if (!upload) return
  if (!upload.preview) return res.status(409).json({ error: 'Preview the pack before importing it.' })
  if (!builders) throw new Error('Pack row builders were not set')
  const user = userOf(req)!
  const resolutions: Record<string, ConflictResolution> = {}
  for (const [key, value] of Object.entries((body.resolutions ?? {}) as Row)) {
    if (value === 'copy' || value === 'skip' || value === 'replace') resolutions[key] = value
  }
  const { content, media } = upload.preview
  const now = Date.now()
  let plan
  try {
    plan = planImport(content, visibleLibrary(req), {
      resolutions,
      confirmReplace: body.confirmReplace === true,
      ownerUserId: user.id,
      now,
      newId,
      mediaPath: (file) => (media.has(file) ? `/avatars/${PACK_MEDIA_DIR}/${file}` : undefined),
    })
  } catch (error) {
    return packError(res, error)
  }

  const owned = { ownerUserId: user.id, visibility: 'private' }
  db.exec('BEGIN IMMEDIATE')
  try {
    const w = plan.world
    if (w.action === 'insert') worldStore.insert({ id: w.id, ...builders.world(w.id, w.row!), ...owned, createdAt: now, updatedAt: now })
    else if (w.action === 'update') worldStore.update(w.id, { ...presentFields(builders.world(w.id, w.row!), w.row!), updatedAt: now })
    for (const c of plan.characters) {
      if (c.action === 'insert') characterStore.insert({ id: c.id, ...builders.character(c.id, c.row!), ...owned, createdAt: now, updatedAt: now })
      else if (c.action === 'update') characterStore.update(c.id, { ...presentFields(builders.character(c.id, c.row!), c.row!), updatedAt: now })
    }
    for (const book of plan.lorebooks) {
      worldInfoBookStore.insert({
        id: book.id,
        name: String(book.name).slice(0, 200),
        book: book.book && typeof book.book === 'object' ? book.book : { entries: [] },
        boundChatIds: [],
        boundWorldIds: book.boundWorldIds,
        boundCharacterIds: book.boundCharacterIds,
        ...owned,
        createdAt: now,
      })
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    console.error('[packs] Import failed and was rolled back:', error)
    return res.status(400).json({ error: 'The import failed, so nothing was imported. The pack may be damaged.' })
  }

  // Committed: the media the records point at goes into place, each file once across every import.
  const target = path.join(avatarsDir, PACK_MEDIA_DIR)
  fs.mkdirSync(target, { recursive: true })
  for (const file of media) {
    const destination = path.join(target, file)
    if (fs.existsSync(destination)) continue
    const source = path.join(upload.dir, 'pack', 'media', file)
    try {
      fs.renameSync(source, destination)
    } catch {
      fs.copyFileSync(source, destination)
    }
  }
  uploads.delete(String(body.previewId))
  fs.rmSync(upload.dir, { recursive: true, force: true })
  const result: PackApplyResult = {
    worldId: plan.world.id,
    characterIds: plan.characters.map((c) => c.id),
    lorebookIds: plan.lorebooks.map((b) => String(b.id)),
    skipped: plan.skipped,
    replaced: plan.replaced,
  }
  res.status(201).json(result)
})
