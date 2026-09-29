import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Zip, ZipPassThrough, zipSync, strToU8 } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { PACK_LIMITS, extractZip, mediaProblem, packRelativePath, readPackFolder, sniffMatches } from './packFiles.ts'
import { PackError } from './packPlan.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const sha = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex')
const dirs: string[] = []
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-tales-packfiles-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function writeZip(files: Record<string, Uint8Array>): string {
  const file = path.join(tempDir(), 'pack.zip')
  fs.writeFileSync(file, zipSync(files))
  return file
}

const manifest = (media: { file: string; bytes: number }[] = []) => strToU8(JSON.stringify({ kind: 'lost-tales-world-pack', formatVersion: 1, title: 'Salt Coast', media }))
const world = strToU8(JSON.stringify({ key: 'world', name: 'Salt Coast' }))

describe('pack paths', () => {
  it('keeps pack files, with or without the pack folder, and skips anything else', () => {
    expect(packRelativePath('Salt Coast.ltpack/manifest.json')).toBe('manifest.json')
    expect(packRelativePath('manifest.json')).toBe('manifest.json')
    expect(packRelativePath('Salt Coast.ltpack/content/world.json')).toBe('content/world.json')
    expect(packRelativePath(`Salt Coast.ltpack/media/${sha(PNG)}.png`)).toBe(`media/${sha(PNG)}.png`)
    expect(packRelativePath('Salt Coast.ltpack/.DS_Store')).toBeUndefined()
    expect(packRelativePath(`media/${sha(PNG)}.svg`)).toBeUndefined()
    expect(packRelativePath('Salt Coast.ltpack/content/other.json')).toBeUndefined()
  })

  it('refuses a path that tries to leave the pack', () => {
    for (const name of ['../manifest.json', 'Salt Coast.ltpack/../../etc/passwd', '/etc/passwd', 'C:/Windows/x', 'a\\b', 'media/./x']) {
      expect(() => packRelativePath(name), name).toThrow(PackError)
    }
  })
})

describe('extractZip', () => {
  it('unpacks the pack files of a good zip and reads them back', async () => {
    const file = `${sha(PNG)}.png`
    const zip = writeZip({ 'Salt Coast.ltpack/manifest.json': manifest([{ file, bytes: PNG.length }]), 'Salt Coast.ltpack/content/world.json': world, [`Salt Coast.ltpack/media/${file}`]: PNG, 'Salt Coast.ltpack/notes.txt': strToU8('hi') })
    const dest = tempDir()
    await extractZip(zip, dest)
    expect(fs.readdirSync(dest).sort()).toEqual(['content', 'manifest.json', 'media'])
    const { manifest: read, content } = readPackFolder(dest)
    expect(read.title).toBe('Salt Coast')
    expect(content.world.name).toBe('Salt Coast')
    expect(await mediaProblem(path.join(dest, 'media', file), read.media[0])).toBeUndefined()
  })

  it('refuses a zip with a path out of the pack', async () => {
    await expect(extractZip(writeZip({ '../escape.json': strToU8('{}') }), tempDir())).rejects.toThrow(/unsafe path/)
  })

  it('refuses too many files, and a file past its size', async () => {
    await expect(extractZip(writeZip({ 'a.txt': strToU8('a'), 'b.txt': strToU8('b'), 'c.txt': strToU8('c') }), tempDir(), { ...PACK_LIMITS, fileCount: 2 })).rejects.toThrow(/more than 2 files/)
    await expect(extractZip(writeZip({ 'manifest.json': strToU8('x'.repeat(2000)) }), tempDir(), { ...PACK_LIMITS, jsonBytes: 1000 })).rejects.toThrow(/larger than a pack allows/)
    await expect(extractZip(writeZip({ 'manifest.json': strToU8('x'.repeat(600)), 'content/world.json': strToU8('y'.repeat(600)) }), tempDir(), { ...PACK_LIMITS, totalBytes: 1000 })).rejects.toThrow(/larger than a pack allows/)
  })

  it('stops a zip bomb at the ratio limit instead of unpacking it', async () => {
    const zeros = new Uint8Array(4 * 1024 * 1024)
    const dest = tempDir()
    await expect(extractZip(writeZip({ 'manifest.json': zeros }), dest, { ...PACK_LIMITS, jsonBytes: 10 * 1024 * 1024, ratio: 100 })).rejects.toThrow(/far larger than its size/)
    expect(fs.statSync(path.join(dest, 'manifest.json')).size).toBeLessThan(zeros.length)
  })

  it('refuses a zip naming the same file twice', async () => {
    const chunks: Uint8Array[] = []
    const zip = new Zip((_e, chunk) => { chunks.push(chunk) })
    for (const text of ['{"a":1}', '{"b":2}']) {
      const entry = new ZipPassThrough('manifest.json')
      zip.add(entry)
      entry.push(strToU8(text), true)
    }
    zip.end()
    const file = path.join(tempDir(), 'twice.zip')
    fs.writeFileSync(file, Buffer.concat(chunks))
    await expect(extractZip(file, tempDir())).rejects.toThrow(/twice/)
  })

  it('refuses a file that is not a zip', async () => {
    const file = path.join(tempDir(), 'not.zip')
    fs.writeFileSync(file, 'this is not a zip at all, just text pretending')
    await expect(extractZip(file, tempDir()).then(() => readPackFolder(path.dirname(file)))).rejects.toThrow(PackError)
  })
})

describe('media checks', () => {
  it('knows art and audio by their first bytes, and nothing else', () => {
    expect(sniffMatches('png', PNG)).toBe(true)
    expect(sniffMatches('png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'))).toBe(false)
    expect(sniffMatches('mp3', Buffer.from('ID3\u0004\u0000'))).toBe(true)
    expect(sniffMatches('mp3', Buffer.from('<script>alert(1)</script>'))).toBe(false)
    expect(sniffMatches('vrm', Buffer.from('glTF\u0002\u0000\u0000\u0000'))).toBe(true)
    expect(sniffMatches('svg', Buffer.from('<svg>'))).toBe(false)
  })

  it('refuses a file whose size, hash, or kind is not what the manifest says', async () => {
    const dir = tempDir()
    const html = Buffer.from('<html><script>alert(1)</script></html>')
    const good = path.join(dir, 'good.png')
    fs.writeFileSync(good, PNG)
    const fake = path.join(dir, 'fake.png')
    fs.writeFileSync(fake, html)
    expect(await mediaProblem(good, { file: `${sha(PNG)}.png`, mime: 'image/png', bytes: PNG.length })).toBeUndefined()
    expect(await mediaProblem(good, { file: `${sha(PNG)}.png`, mime: 'image/png', bytes: 1 })).toMatch(/not the size/)
    expect(await mediaProblem(good, { file: `${'0'.repeat(64)}.png`, mime: 'image/png', bytes: PNG.length })).toMatch(/don't match its name/)
    expect(await mediaProblem(fake, { file: `${sha(html)}.png`, mime: 'image/png', bytes: html.length })).toMatch(/not the kind of file/)
    expect(await mediaProblem(path.join(dir, 'gone.png'), { file: `${sha(PNG)}.png`, mime: 'image/png', bytes: 1 })).toMatch(/missing/)
  })
})
