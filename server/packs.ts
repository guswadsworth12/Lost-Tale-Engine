import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import { avatarsDir, characterStore, worldInfoBookStore, worldStore } from './db.ts'
import { canSee, canSeeCharacter, userOf } from './access.ts'
import {
  PACK_MEDIA_TYPES,
  buildManifest,
  normalizeSelection,
  packBaseName,
  planExport,
  withPackMedia,
  type ExportPlan,
} from './packPlan.ts'
import { PACK_CONTENT_FILES, PACK_EXTENSION, type PackCredit, type PackMediaEntry, type PackSelection } from '../src/lib/packs/contract.ts'
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
