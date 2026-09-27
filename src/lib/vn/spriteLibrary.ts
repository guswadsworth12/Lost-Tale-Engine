import { DEFAULT_EXPRESSIONS, type CustomExpression } from '@/lib/vn/expressions'
import { BASE_OUTFIT_ID, spriteKey, type Outfit } from '@/lib/vn/outfits'

/**
 * Plans an import of an on-disk Visual Novel sprite library laid out as
 * `<character folder>/<outfit folder>/<Expression>.png` (the layout TavernAI VN stage scripts use).
 * Pure: the script in `scripts/import-sprite-library.ts` does the file reads and API writes.
 *
 * - A character folder matches a card by exact name, first name, or an explicit override. Anything
 *   that doesn't match is returned in `unmatched` — never silently skipped.
 * - The `default` outfit folder is RP's implicit base outfit; every other folder becomes an outfit
 *   whose id is the folder name (slug-safe) and whose label is the folder name exactly.
 * - Each file's expression maps to a default expression by id or label (`Loving.png` → `love`);
 *   anything else becomes a custom expression so no art is dropped.
 */

export interface LibraryFolder {
  name: string
  outfits: { name: string; files: string[] }[]
}

export interface PlannedSprite {
  /** Path relative to the library root, e.g. `ivo/festival/Happy.png`. */
  file: string
  key: string
  outfitId: string
  expressionId: string
}

export interface PlannedSet {
  folder: string
  characterId: string
  characterName: string
  matchedBy: 'name' | 'first-name' | 'override'
  sprites: PlannedSprite[]
  /** Non-base outfits, in folder order. */
  outfits: Outfit[]
  customExpressions: CustomExpression[]
}

export interface SpriteLibraryPlan {
  sets: PlannedSet[]
  unmatched: { folder: string; files: number; reason: string }[]
  /** Folders with no image files at all — reported, nothing to import. */
  empty: string[]
  /** Files that are not PNG/JPEG/WebP, reported rather than dropped silently. */
  skippedFiles: string[]
  totalImages: number
}

const IMAGE_RE = /\.(png|jpe?g|webp)$/i
const BASE_FOLDER = 'default'

const normalize = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
const slug = (s: string) => normalize(s).replace(/ /g, '-').slice(0, 40)

/** Maps one file's base name to an expression id; `custom` when it isn't one of RP's defaults. */
export function expressionForFile(fileName: string): { id: string; label: string; custom: boolean } {
  const label = fileName.replace(IMAGE_RE, '').trim()
  const n = normalize(label)
  const known = DEFAULT_EXPRESSIONS.find((e) => e.id === n.replace(/ /g, '-') || normalize(e.label) === n)
  if (known) return { id: known.id, label: known.label, custom: false }
  return { id: slug(label) || 'expression', label, custom: true }
}

export function outfitIdForFolder(folder: string): string {
  return folder.toLowerCase() === BASE_FOLDER ? BASE_OUTFIT_ID : slug(folder)
}

export function matchFolder(
  folder: string,
  characters: { id: string; name: string }[],
  overrides: Record<string, string> = {},
): { character: { id: string; name: string }; by: PlannedSet['matchedBy'] } | { error: string } {
  const override = overrides[folder]
  if (override) {
    const hit = characters.find((c) => c.name === override || c.id === override)
    return hit ? { character: hit, by: 'override' } : { error: `override "${override}" names no existing character` }
  }
  const f = normalize(folder)
  const exact = characters.filter((c) => normalize(c.name) === f)
  if (exact.length === 1) return { character: exact[0], by: 'name' }
  const byFirst = characters.filter((c) => normalize(c.name).split(' ')[0] === f)
  if (byFirst.length === 1) return { character: byFirst[0], by: 'first-name' }
  if (byFirst.length > 1) return { error: `ambiguous: ${byFirst.map((c) => c.name).join(', ')}` }
  return { error: 'no character with this name or first name' }
}

export function planSpriteLibrary(
  folders: LibraryFolder[],
  characters: { id: string; name: string }[],
  overrides: Record<string, string> = {},
): SpriteLibraryPlan {
  const plan: SpriteLibraryPlan = { sets: [], unmatched: [], empty: [], skippedFiles: [], totalImages: 0 }
  for (const folder of folders) {
    const images = folder.outfits.flatMap((o) => o.files.filter((f) => IMAGE_RE.test(f)))
    for (const o of folder.outfits) {
      for (const f of o.files) if (!IMAGE_RE.test(f)) plan.skippedFiles.push(`${folder.name}/${o.name}/${f}`)
    }
    plan.totalImages += images.length
    if (!images.length) {
      plan.empty.push(folder.name)
      continue
    }
    const match = matchFolder(folder.name, characters, overrides)
    if ('error' in match) {
      plan.unmatched.push({ folder: folder.name, files: images.length, reason: match.error })
      continue
    }
    const set: PlannedSet = {
      folder: folder.name,
      characterId: match.character.id,
      characterName: match.character.name,
      matchedBy: match.by,
      sprites: [],
      outfits: [],
      customExpressions: [],
    }
    for (const outfit of folder.outfits) {
      const outfitId = outfitIdForFolder(outfit.name)
      const files = outfit.files.filter((f) => IMAGE_RE.test(f))
      if (!files.length) continue
      if (outfitId !== BASE_OUTFIT_ID) set.outfits.push({ id: outfitId, label: outfit.name })
      for (const file of files) {
        const expr = expressionForFile(file)
        if (expr.custom && !set.customExpressions.some((c) => c.id === expr.id)) set.customExpressions.push({ id: expr.id, label: expr.label })
        set.sprites.push({ file: `${folder.name}/${outfit.name}/${file}`, key: spriteKey(outfitId, expr.id), outfitId, expressionId: expr.id })
      }
    }
    plan.sets.push(set)
  }
  return plan
}

/** Adds imported outfits/expressions to what a character already has, keeping every existing entry (and its gates) as authored. */
export function mergeById<T extends { id: string }>(existing: T[] | undefined, incoming: T[]): T[] {
  const out = [...(existing ?? [])]
  for (const item of incoming) if (!out.some((e) => e.id === item.id)) out.push(item)
  return out
}
