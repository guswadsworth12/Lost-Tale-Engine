import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { avatarsDir, characterStore, personaStore, worldInfoBookStore, worldStore } from './db.ts'
import {
  HOLLOWMERE_BACKGROUND_KEYS,
  HOLLOWMERE_EXPRESSIONS,
  HOLLOWMERE_FOX_EXPRESSIONS,
  HOLLOWMERE_WORLD_ID,
  hollowmereCharacters,
  hollowmereWorld,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Committed at the repo root (not under data/, which is gitignored) — these ship with the app.
const seedAssetsDir = path.resolve(__dirname, '..', 'seed', 'backgrounds')
const seedNightAssetsDir = path.resolve(__dirname, '..', 'seed', 'backgrounds-night')
const seedSpritesDir = path.resolve(__dirname, '..', 'seed', 'sprites', 'sumire')
const hollowmereAssetsDir = path.resolve(__dirname, '..', 'seed', 'hollowmere')

function copySeedArt(source: string, destination: string): boolean {
  if (!fs.existsSync(source)) return false
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.copyFileSync(source, destination)
  return true
}

function seedHollowmereIfNeeded(): void {
  if (worldStore.get(HOLLOWMERE_WORLD_ID)) return
  let copied = 0
  for (const folder of ['backgrounds', 'backgrounds-night']) {
    for (const key of HOLLOWMERE_BACKGROUND_KEYS) {
      copied += Number(copySeedArt(
        path.join(hollowmereAssetsDir, folder, `${key}.png`),
        path.join(avatarsDir, 'worlds', HOLLOWMERE_WORLD_ID, folder, `${key}.png`),
      ))
    }
  }
  const slugs = ['mara', 'tavi', 'passenger', 'rowan'] as const
  hollowmereCharacters.forEach((character, index) => {
    const source = path.join(hollowmereAssetsDir, 'sprites', slugs[index])
    const destination = path.join(avatarsDir, 'characters', character.id)
    copied += Number(copySeedArt(path.join(source, 'avatar.png'), path.join(destination, 'avatar.png')))
    const expressions = character.id === hollowmereCharacters[1].id
      ? [...HOLLOWMERE_EXPRESSIONS, ...HOLLOWMERE_FOX_EXPRESSIONS]
      : HOLLOWMERE_EXPRESSIONS
    for (const key of expressions) {
      copied += Number(copySeedArt(path.join(source, `${key}.png`), path.join(destination, 'sprites', `${key}.png`)))
    }
  })
  worldStore.insert(hollowmereWorld as unknown as Record<string, unknown>)
  for (const character of hollowmereCharacters) characterStore.insert(character as unknown as Record<string, unknown>)
  console.log(`[rp-server] seeded Hollowmere Station: 1 world, 4 characters, ${copied} art files copied`)
}

/**
 * Populates bundled worlds on first run and back-fills new ones on existing installs. Each world
 * uses its fixed id as a guard, so re-running this does not overwrite a user's edits.
 */
export function runSeedIfNeeded(): void {
  seedHollowmereIfNeeded()
  // The starter persona, and later the second (Freeform) seed world/character, were both added
  // after the original seed shipped — back-fill each for installs that already ran the seed before
  // they existed, guarded by their own ids so this stays a one-time no-op per piece.
  if (worldStore.get(SEED_WORLD_ID)) {
    if (!personaStore.get(SEED_PERSONA_ID)) {
      personaStore.insert(seedPersona as unknown as Record<string, unknown>)
      console.log('[rp-server] back-filled the starter persona')
    }
    if (!worldStore.get(SEED_WORLD_2_ID)) {
      worldStore.insert(seedWorld2 as unknown as Record<string, unknown>)
      characterStore.insert(seedCharacter2 as unknown as Record<string, unknown>)
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
  worldStore.insert(seedWorld as unknown as Record<string, unknown>)
  worldInfoBookStore.insert(seedWorldInfoBook as unknown as Record<string, unknown>)
  characterStore.insert(seedCharacter as unknown as Record<string, unknown>)
  personaStore.insert(seedPersona as unknown as Record<string, unknown>)
  // The second seed: a Freeform-template world + text-only NPC, no art assets to copy for either.
  worldStore.insert(seedWorld2 as unknown as Record<string, unknown>)
  characterStore.insert(seedCharacter2 as unknown as Record<string, unknown>)

  console.log(
    `[rp-server] seeded original starter content: 2 worlds, 1 World Info book, 2 characters, 1 persona ` +
      `(${copied}/${SEED_BACKGROUND_KEYS.length} backgrounds, ${spritesCopied}/${SEED_SPRITE_KEYS.length} sprites copied)`,
  )
}
