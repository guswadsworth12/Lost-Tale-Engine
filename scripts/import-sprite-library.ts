/**
 * Imports a Visual Novel sprite library (`<character>/<outfit>/<Expression>.png`) into a running RP
 * server, then verifies every file is reachable on the matched character.
 *
 *   npx tsx scripts/import-sprite-library.ts <libraryDir> [--api http://127.0.0.1:3001/api]
 *     [--map folder="Character Name"]... [--dry-run] [--report out.json]
 *
 * Idempotent: each written sprite key records the source file's sha256 (`Character.spriteSources`);
 * a re-run uploads only keys whose art changed or went missing. Existing sprites, outfits (with their
 * gates and labels) and custom expressions are kept — the import only adds or replaces imported keys.
 * The library is only ever read. Unmatched character folders are listed and fail the run, so nothing
 * is skipped silently; resolve them by importing the character or passing `--map`.
 */
import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { mergeById, planSpriteLibrary, type LibraryFolder } from '../src/lib/vn/spriteLibrary'
import type { Character } from '../src/lib/characters/cardSpec'

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

const argv = process.argv.slice(2)
const flag = (name: string) => argv.includes(name)
const option = (name: string) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
const optionValues = new Set(['--api', '--map', '--report'].flatMap((name) => argv.flatMap((a, i) => (a === name ? [argv[i + 1]] : []))))
const libraryArg = argv.find((a) => !a.startsWith('--') && !optionValues.has(a)) ?? process.env.LOST_TALES_SPRITE_LIBRARY
if (!libraryArg) {
  console.error('Pass the sprite library folder (or set LOST_TALES_SPRITE_LIBRARY).')
  process.exit(1)
}
const library = path.resolve(libraryArg)
const api = (option('--api') ?? 'http://127.0.0.1:3001/api').replace(/\/$/, '')
const origin = new URL(api).origin
const dryRun = flag('--dry-run')
const overrides = Object.fromEntries(argv.flatMap((a, i) => (a === '--map' ? [argv[i + 1]] : [])).map((m) => {
  const eq = m.indexOf('=')
  return [m.slice(0, eq), m.slice(eq + 1).replace(/^"|"$/g, '')]
}))

async function request<T>(endpoint: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${api}${endpoint}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  if (!res.ok) throw new Error(`${method} ${endpoint}: ${res.status} ${(await res.text()).slice(0, 300)}`)
  return res.json() as Promise<T>
}

async function scan(): Promise<LibraryFolder[]> {
  const folders: LibraryFolder[] = []
  for (const entry of (await readdir(library, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const outfits = []
    for (const sub of (await readdir(path.join(library, entry.name), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!sub.isDirectory()) continue
      const files = (await readdir(path.join(library, entry.name, sub.name), { withFileTypes: true })).filter((f) => f.isFile()).map((f) => f.name).sort()
      outfits.push({ name: sub.name, files })
    }
    folders.push({ name: entry.name, outfits })
  }
  return folders
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex')

/** Size + mtime of every file, to prove the run left the library untouched. */
async function fingerprint(): Promise<string> {
  const lines: string[] = []
  const walk = async (dir: string) => {
    for (const e of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else { const s = await stat(p); lines.push(`${path.relative(library, p)}:${s.size}:${s.mtimeMs}`) }
    }
  }
  await walk(library)
  return sha256(Buffer.from(lines.join('\n')))
}

const before = await fingerprint()
const characters = await request<Character[]>('/characters')
const plan = planSpriteLibrary(await scan(), characters.map((c) => ({ id: c.id, name: c.card.name })), overrides)

console.log(`Library: ${library}`)
console.log(`Images found: ${plan.totalImages} in ${plan.sets.length + plan.unmatched.length} character sets`)
for (const set of plan.sets) {
  const outfits = ['base', ...set.outfits.map((o) => o.label)].join(', ')
  console.log(`  ${set.folder.padEnd(10)} -> ${set.characterName} (${set.matchedBy}); ${set.sprites.length} sprites; outfits: ${outfits}${set.customExpressions.length ? `; custom expressions: ${set.customExpressions.map((c) => c.label).join(', ')}` : ''}`)
}
for (const folder of plan.empty) console.log(`  ${folder.padEnd(10)} -> empty folder, nothing to import`)
for (const file of plan.skippedFiles) console.log(`  skipped non-image file: ${file}`)
if (plan.unmatched.length) {
  console.error('\nUnmatched sets (nothing imported for these):')
  for (const u of plan.unmatched) console.error(`  ${u.folder}: ${u.files} images — ${u.reason}. Import that character, or pass --map ${u.folder}="Character Name".`)
  process.exitCode = 1
  if (!dryRun) process.exit(1)
}
if (dryRun) process.exit(process.exitCode ?? 0)

let uploaded = 0
let unchanged = 0
for (const set of plan.sets) {
  let current = await request<Character>(`/characters/${set.characterId}`)
  const outfitIds = ['base', ...set.outfits.map((o) => o.id)]
  for (const outfitId of outfitIds) {
    const sprites = set.sprites.filter((s) => s.outfitId === outfitId)
    const changed: Record<string, string> = {}
    const hashes: Record<string, string> = {}
    for (const sprite of sprites) {
      const buf = await readFile(path.join(library, sprite.file))
      const hash = sha256(buf)
      hashes[sprite.key] = hash
      if (current.spriteSources?.[sprite.key] === hash && current.sprites?.[sprite.key]) { unchanged++; continue }
      changed[sprite.key] = `data:${MIME[path.extname(sprite.file).toLowerCase()]};base64,${buf.toString('base64')}`
    }
    const needsMeta = outfitId !== 'base' && !current.outfits?.some((o) => o.id === outfitId)
    if (!Object.keys(changed).length && !needsMeta) continue
    current = await request<Character>(`/characters/${set.characterId}`, 'PUT', {
      // Existing values are server paths and pass through untouched; only changed keys carry new art.
      sprites: { ...(current.sprites ?? {}), ...changed },
      spriteSources: { ...(current.spriteSources ?? {}), ...hashes },
      outfits: mergeById(current.outfits, set.outfits),
      customExpressions: mergeById(current.customExpressions, set.customExpressions),
    })
    uploaded += Object.keys(changed).length
    console.log(`  ${set.characterName} / ${outfitId}: ${Object.keys(changed).length} uploaded`)
  }
}

// Verification: every planned file must be a reachable sprite on its character.
let verified = 0
const missing: string[] = []
for (const set of plan.sets) {
  const c = await request<Character>(`/characters/${set.characterId}`)
  for (const sprite of set.sprites) {
    const url = c.sprites?.[sprite.key]
    const ok = url && (await fetch(`${origin}${url}`, { method: 'HEAD' })).ok
    if (ok) verified++
    else missing.push(sprite.file)
  }
  const outfitIds = new Set((c.outfits ?? []).map((o) => o.id))
  for (const o of set.outfits) if (!outfitIds.has(o.id)) missing.push(`${set.folder}: outfit ${o.label} not on character`)
}
const after = await fingerprint()
const report = {
  library,
  totalImages: plan.totalImages,
  uploaded,
  unchanged,
  verified,
  missing,
  unmatched: plan.unmatched,
  empty: plan.empty,
  sourceUnchanged: before === after,
  sets: plan.sets.map((s) => ({ folder: s.folder, character: s.characterName, sprites: s.sprites.length, outfits: s.outfits.map((o) => o.label), customExpressions: s.customExpressions.map((c) => c.label) })),
}
console.log(`\nUploaded ${uploaded}, unchanged ${unchanged}. Verified ${verified}/${plan.totalImages} images on their characters. Source library unchanged: ${before === after}.`)
if (missing.length) { console.error(`Missing: ${missing.join('; ')}`); process.exitCode = 1 }
const reportPath = option('--report')
if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2))
