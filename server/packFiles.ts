import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Unzip, UnzipInflate } from 'fflate'
import { PACK_CONTENT_FILES, type PackMediaEntry, type WorldPackContent, type WorldPackManifest } from '../src/lib/packs/contract.ts'
import { PACK_MEDIA_FILE_RE, PackError, parseContent, parseManifest } from './packPlan.ts'

/**
 * Reading a pack from disk, safely: a zip or an unzipped folder's files, from someone we can't
 * trust. Nothing here touches the database. Every limit is checked while bytes arrive, not after,
 * so a zip bomb stops at the limit instead of filling the disk.
 */

export interface PackLimits {
  /** Everything unpacked, together. */
  totalBytes: number
  /** Entries in a zip, or files in a folder, counting ones that are skipped. */
  fileCount: number
  /** One JSON file. */
  jsonBytes: number
  /** One media file. A VRM model can reach 100MB. */
  mediaBytes: number
  /** Unpacked size over packed size for one deflated entry. Real art and text stay far below it. */
  ratio: number
}

export const PACK_LIMITS: PackLimits = {
  totalBytes: 3 * 1024 ** 3,
  fileCount: 10_000,
  jsonBytes: 64 * 1024 ** 2,
  mediaBytes: 150 * 1024 ** 2,
  ratio: 1_000,
}

const CONTENT_NAMES = new Set(['manifest.json', ...Object.values(PACK_CONTENT_FILES)])

/**
 * Where an entry of a pack goes, relative to the pack folder: `manifest.json`, one of the content
 * files, or `media/<sha256>.<ext>`. Anything else (a stray `.DS_Store`, a readme) is skipped:
 * undefined. A path that tries to leave the folder is refused outright.
 */
export function packRelativePath(name: string): string | undefined {
  if (!name || name.length > 500 || name.includes('\\') || name.includes('\0') || name.startsWith('/') || /^[a-z]:/i.test(name)) {
    throw new PackError('The pack holds a file with an unsafe path.')
  }
  const parts = name.split('/').filter(Boolean)
  if (parts.some((part) => part === '..' || part === '.')) throw new PackError('The pack holds a file with an unsafe path.')
  // The pack's own folder (`Salt Coast.ltpack/`) is optional: a folder upload or a re-zipped pack may lack it.
  const inside = parts.length > 1 && parts[0] !== 'content' && parts[0] !== 'media' ? parts.slice(1) : parts
  const relative = inside.join('/')
  if (CONTENT_NAMES.has(relative)) return relative
  if (inside.length === 2 && inside[0] === 'media' && PACK_MEDIA_FILE_RE.test(inside[1])) return relative
  return undefined
}

function limitFor(relative: string, limits: PackLimits): number {
  return relative.endsWith('.json') ? limits.jsonBytes : limits.mediaBytes
}

/** Unpacks the pack files of a zip into `dest`, streaming, refusing at the first broken limit. */
export async function extractZip(zipPath: string, dest: string, limits: PackLimits = PACK_LIMITS): Promise<void> {
  const unzip = new Unzip()
  unzip.register(UnzipInflate)
  let failure: Error | undefined
  let entries = 0
  let total = 0
  const fail = (error: Error) => { failure ??= error }
  unzip.onfile = (file) => {
    if (failure) return
    if (++entries > limits.fileCount) return fail(new PackError(`The pack holds more than ${limits.fileCount} files.`))
    if (file.name.endsWith('/')) return
    let relative: string | undefined
    try {
      relative = packRelativePath(file.name)
    } catch (error) {
      return fail(error as Error)
    }
    if (!relative) return
    const max = limitFor(relative, limits)
    if (file.originalSize !== undefined && file.originalSize > max) return fail(new PackError(`${relative} is larger than a pack allows.`))
    const target = path.join(dest, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    let fd: number
    try {
      // `wx`: a zip naming the same file twice is refused, not silently overwritten.
      fd = fs.openSync(target, 'wx')
    } catch {
      return fail(new PackError(`The pack holds ${relative} twice.`))
    }
    let written = 0
    let closed = false
    const close = () => { if (!closed) { closed = true; fs.closeSync(fd) } }
    file.ondata = (error, chunk, final) => {
      if (failure) return close()
      if (error) {
        close()
        return fail(new PackError('The pack is damaged and could not be unpacked.'))
      }
      written += chunk.length
      total += chunk.length
      const bomb = file.compression !== 0 && !!file.size && written / file.size > limits.ratio
      if (written > max || total > limits.totalBytes || bomb) {
        close()
        file.terminate()
        return fail(new PackError(bomb ? 'The pack unpacks far larger than its size, so it was refused.' : 'The pack is larger than a pack allows.'))
      }
      fs.writeSync(fd, chunk)
      if (final) close()
    }
    file.start()
  }
  for await (const chunk of fs.createReadStream(zipPath)) {
    try {
      unzip.push(chunk as Buffer)
    } catch {
      fail(new PackError('The pack is damaged and could not be unpacked.'))
    }
    if (failure) break
  }
  if (!failure) {
    try {
      unzip.push(new Uint8Array(0), true)
    } catch {
      fail(new PackError('The pack is damaged and could not be unpacked.'))
    }
  }
  if (failure) throw failure
}

/** Whether a file's first bytes are what its extension claims. No SVG, HTML, or script gets in as "art". */
export function sniffMatches(ext: string, head: Buffer): boolean {
  const at = (offset: number, text: string) => head.subarray(offset, offset + text.length).toString('latin1') === text
  switch (ext) {
    case 'png': return head[0] === 0x89 && at(1, 'PNG')
    case 'jpg': return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    case 'gif': return at(0, 'GIF8')
    case 'webp': return at(0, 'RIFF') && at(8, 'WEBP')
    case 'mp3': return at(0, 'ID3') || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
    case 'aac': return head[0] === 0xff && (head[1] & 0xf6) === 0xf0
    case 'ogg': case 'opus': return at(0, 'OggS')
    case 'wav': return at(0, 'RIFF') && at(8, 'WAVE')
    case 'webm': return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3
    case 'm4a': return at(4, 'ftyp')
    case 'vrm': return at(0, 'glTF')
    default: return false
  }
}

/** Why a media file can't be imported, or undefined when it's what the manifest says: its size, its hash, its kind. */
export async function mediaProblem(file: string, entry: PackMediaEntry): Promise<string | undefined> {
  if (!fs.existsSync(file)) return `${entry.file} is missing from the pack.`
  const size = fs.statSync(file).size
  if (size !== entry.bytes) return `${entry.file} is not the size the pack says.`
  const hash = crypto.createHash('sha256')
  let head = Buffer.alloc(0)
  for await (const chunk of fs.createReadStream(file)) {
    if (head.length < 16) head = Buffer.concat([head, (chunk as Buffer).subarray(0, 16 - head.length)])
    hash.update(chunk as Buffer)
  }
  if (`${hash.digest('hex')}.${entry.file.split('.').pop()}` !== entry.file) return `${entry.file} is damaged: its contents don't match its name.`
  if (!sniffMatches(entry.file.split('.').pop()!, head)) return `${entry.file} is not the kind of file its name says.`
  return undefined
}

function readJson(dir: string, relative: string, limits: PackLimits, required: boolean): unknown {
  const file = path.join(dir, relative)
  if (!fs.existsSync(file)) {
    if (required) throw new PackError(`The pack has no ${relative}.`)
    return undefined
  }
  if (fs.statSync(file).size > limits.jsonBytes) throw new PackError(`${relative} is larger than a pack allows.`)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new PackError(`${relative} is not valid JSON.`)
  }
}

/** Reads an unpacked pack folder: its manifest and its content, both checked. */
export function readPackFolder(dir: string, limits: PackLimits = PACK_LIMITS): { manifest: WorldPackManifest; content: WorldPackContent } {
  const manifest = parseManifest(readJson(dir, 'manifest.json', limits, true))
  const content = parseContent({
    world: readJson(dir, PACK_CONTENT_FILES.world, limits, true),
    characters: readJson(dir, PACK_CONTENT_FILES.characters, limits, false),
    lorebooks: readJson(dir, PACK_CONTENT_FILES.lorebooks, limits, false),
  })
  return { manifest, content }
}
