import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { avatarsDir, characterStore, personaStore, worldInfoBookStore, worldStore } from './db.ts'
import {
  SEED_WORLD_INFO_ID,
  SEED_BACKGROUND_KEYS,
  SEED_BACKGROUND_NIGHT_KEYS,
  SEED_CHARACTER_ID,
  SEED_CHARACTER_2_ID,
  SEED_PERSONA_ID,
  SEED_SPRITE_KEYS,
  SEED_WORLD_ID,
  SEED_WORLD_2_ID,
  seedCharacter,
  seedCharacter2,
  seedPersona,
  seedWorld,
  seedWorld2,
  seedWorldInfoBook,
} from './seedContent.ts'

/** The starter content bundled with the app: shared with every account on purpose (ownership.ts). */
export const SHARED_SEED_IDS: ReadonlySet<string> = new Set([
  SEED_WORLD_ID, SEED_CHARACTER_ID, SEED_WORLD_INFO_ID, SEED_PERSONA_ID, SEED_WORLD_2_ID, SEED_CHARACTER_2_ID,
])
const shared = (row: object) => ({ ...row, visibility: 'shared' }) as unknown as Record<string, unknown>

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Committed at the repo root (not under data/, which is gitignored) — these ship with the app.
const seedAssetsDir = path.resolve(__dirname, '..', 'seed', 'backgrounds')
const seedNightAssetsDir = path.resolve(__dirname, '..', 'seed', 'backgrounds-night')
const seedSpritesDir = path.resolve(__dirname, '..', 'seed', 'sprites', 'sumire')

/**
 * Populates the one bundled world/character/World Info book on first run only. Idempotent by
 * construction: it checks for the seed world's own fixed id rather than "is the database empty",
 * so deleting other data never re-triggers it, and re-running it (e.g. after `npm install`) is a
 * harmless no-op once it's already been applied once.
 */
export function runSeedIfNeeded(): void {
  // The starter persona, and later the second (Freeform) seed world/character, were both added
  // after the original seed shipped — back-fill each for installs that already ran the seed before
  // they existed, guarded by their own ids so this stays a one-time no-op per piece.
  if (worldStore.get(SEED_WORLD_ID)) {
    if (!personaStore.get(SEED_PERSONA_ID)) {
      personaStore.insert(shared(seedPersona))
      console.log('[rp-server] back-filled the starter persona')
    }
    if (!worldStore.get(SEED_WORLD_2_ID)) {
      worldStore.insert(shared(seedWorld2))
      characterStore.insert(shared(seedCharacter2))
      console.log('[rp-server] back-filled the second seed world/character (Freeform)')
    }
    return
  }

  const backgroundsDest = path.join(avatarsDir, 'worlds', SEED_WORLD_ID, 'backgrounds')
  fs.mkdirSync(backgroundsDest, { recursive: true })
  let copied = 0
  for (const key of SEED_BACKGROUND_KEYS) {
    const src = path.join(seedAssetsDir, `${key}.png`)
    if (!fs.existsSync(src)) continue // Missing art shouldn't block seeding the rest — the world just falls back to a placeholder gradient for that key, same as any world with unfinished art.
    fs.copyFileSync(src, path.join(backgroundsDest, `${key}.png`))
    copied++
  }

  // Night-lighting variants, same "missing is fine" tolerance — a key with no night art just shows
  // its day art at night, same as VNStage's runtime fallback.
  const backgroundsNightDest = path.join(avatarsDir, 'worlds', SEED_WORLD_ID, 'backgrounds-night')
  fs.mkdirSync(backgroundsNightDest, { recursive: true })
  for (const key of SEED_BACKGROUND_NIGHT_KEYS) {
    const src = path.join(seedNightAssetsDir, `${key}.png`)
    if (!fs.existsSync(src)) continue
    fs.copyFileSync(src, path.join(backgroundsNightDest, `${key}.png`))
    copied++
  }

  // Sumire's portrait + expression sprites, same idea as the backgrounds above — committed under
  // seed/sprites/sumire/ and copied into her own avatars folder so she ships fully illustrated.
  // Missing files just fall back to the main avatar for that expression, so a partial set is fine.
  const characterDest = path.join(avatarsDir, 'characters', SEED_CHARACTER_ID)
  const spritesDest = path.join(characterDest, 'sprites')
  fs.mkdirSync(spritesDest, { recursive: true })
  let spritesCopied = 0
  for (const key of SEED_SPRITE_KEYS) {
    const src = path.join(seedSpritesDir, `${key}.png`)
    if (!fs.existsSync(src)) continue
    fs.copyFileSync(src, path.join(spritesDest, `${key}.png`))
    spritesCopied++
  }
  const avatarSrc = path.join(seedSpritesDir, 'avatar.png')
  if (fs.existsSync(avatarSrc)) fs.copyFileSync(avatarSrc, path.join(characterDest, 'avatar.png'))

  // The stores are intentionally typed loosely (Record<string, unknown> in, out) since they're a
  // thin JSON-blob layer over SQLite shared by every entity kind — seedContent.ts's exports carry
  // the real, precise types for everything written by hand above.
  worldStore.insert(shared(seedWorld))
  worldInfoBookStore.insert(shared(seedWorldInfoBook))
  characterStore.insert(shared(seedCharacter))
  personaStore.insert(shared(seedPersona))
  // The second seed: a Freeform-template world + text-only NPC, no art assets to copy for either.
  worldStore.insert(shared(seedWorld2))
  characterStore.insert(shared(seedCharacter2))

  console.log(
    `[rp-server] seeded starter content: 2 worlds, 1 World Info book, 2 characters, 1 persona ` +
      `(${copied}/${SEED_BACKGROUND_KEYS.length} backgrounds, ${spritesCopied}/${SEED_SPRITE_KEYS.length} sprites copied)`,
  )
}
