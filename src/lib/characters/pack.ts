import { charactersApi, worldsApi } from '@/lib/api/client'
import { validateScenarioSource } from '@/lib/dating/scenarios'
import { fileToDataUrl } from './importExport'
import type { Character, CharacterCardData, GalleryEntry, Lorebook, RelationshipStarter, SocialConnection } from './cardSpec'
import type { CustomSceneFlag, GiftItem, ItemDef, WorldCard } from '@/lib/types'
import type { CustomExpression } from '@/lib/vn/expressions'
import type { Outfit } from '@/lib/vn/outfits'
import type { CustomBackground } from '@/lib/vn/backgrounds'
import type { ScheduleEntry, WeatherPreferences } from '@/lib/world/calendar'
import { CHARACTER_PACK_FIELDS, CHARACTER_PACK_WORLD_FIELDS, pickFields } from '@/lib/packs/fields'

const PACK_KIND = 'rp-character-pack'
const PACK_VERSION = 1

export interface CharacterPackV1 {
  kind: typeof PACK_KIND
  version: typeof PACK_VERSION
  character: {
    card: CharacterCardData
    playerOnly?: boolean
    worldId?: string
    sheet?: Character['sheet']
    sheets?: Character['sheets']
    avatarDataUrl?: string
    sprites?: Record<string, string>
    vrm?: Character['vrm']
    spriteUnlocks?: Record<string, number>
    /** Wardrobe states (`src/lib/vn/outfits.ts`). Without these the composite sprite keys above would survive an export but have no outfit left to belong to. */
    outfits?: Outfit[]
    customExpressions?: CustomExpression[]
    giftPreferences?: Record<string, number>
    giftLikes?: string[]
    giftDislikes?: string[]
    loveLanguage?: string
    weatherPreferences?: WeatherPreferences
    schedule?: ScheduleEntry[]
    gallery?: GalleryEntry[]
    relationshipStarters?: RelationshipStarter[]
    voice?: Character['voice']
    sfxWords?: string[]
    replyLength?: Character['replyLength']
    occupation?: string
    workplace?: string
    homeLocation?: string
    frequentedLocations?: string[]
    likes?: string[]
    goals?: string[]
    boundaries?: string[]
    /** Structured limits and responses (`dating/touch.ts`, `dating/kinks.ts`) — enforced by filtering, so they have to travel with the character. */
    touchProfile?: Character['touchProfile']
    kinkProfile?: Character['kinkProfile']
    socialConnections?: SocialConnection[]
    dateModeOptOut?: boolean
  }
  world?: {
    name: string
    description: string
    rules?: string
    template?: WorldCard['template']
    lorebook: Lorebook
    avatarDataUrl?: string
    backgrounds?: Record<string, string>
    backgroundUnlocks?: Record<string, number>
    customBackgrounds?: CustomBackground[]
    music?: Record<string, string>
    gifts?: GiftItem[]
    items?: ItemDef[]
    customSceneFlags?: CustomSceneFlag[]
    /** Scene shapes the world ships (`dating/scenarios.ts`). Validated on import; a malformed one is dropped, not loaded. */
    scenarios?: WorldCard['scenarios']
    relationshipThresholds?: WorldCard['relationshipThresholds']
    campaign?: WorldCard['campaign']
    modules?: WorldCard['modules']
  }
}

/** Fetches a same-origin `/avatars/...` URL and inlines it as a data URL; passes data URLs through unchanged. */
export async function urlToDataUrl(url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined
  if (url.startsWith('data:')) return url
  const res = await fetch(url)
  if (!res.ok) return undefined
  return fileToDataUrl(await res.blob())
}

async function mapToDataUrls(map: Record<string, string | undefined> | undefined): Promise<Record<string, string> | undefined> {
  if (!map || Object.keys(map).length === 0) return undefined
  const entries = await Promise.all(Object.entries(map).map(async ([k, v]) => [k, await urlToDataUrl(v)] as const))
  const result: Record<string, string> = {}
  for (const [k, v] of entries) if (v) result[k] = v
  return result
}

/**
 * Bundles a character — and, if given, its bound world — into one self-contained, portable
 * pack, inlining every server-hosted image (avatar, sprites, gallery CGs, backgrounds) as a
 * data URL. Unlike the bare card export, nothing that makes this a VN character gets dropped.
 */
export async function buildCharacterPack(character: Character, world?: WorldCard): Promise<CharacterPackV1> {
  const [avatarDataUrl, sprites, gallery, vrmUrl, vrmMotions] = await Promise.all([
    urlToDataUrl(character.avatarDataUrl),
    mapToDataUrls(character.sprites),
    Promise.all(
      (character.gallery ?? []).map(async (g) => ({ ...g, imageUrl: (await urlToDataUrl(g.imageUrl)) ?? g.imageUrl })),
    ),
    urlToDataUrl(character.vrm?.url),
    mapToDataUrls(character.vrm?.motions),
  ])

  const pack: CharacterPackV1 = {
    kind: PACK_KIND,
    version: PACK_VERSION,
    // The shared list (`packs/fields.ts`) keeps this pack and the world pack from drifting apart.
    character: {
      ...pickFields(character, CHARACTER_PACK_FIELDS),
      avatarDataUrl,
      sprites,
      gallery: gallery.length ? gallery : undefined,
      vrm: character.vrm && vrmUrl ? { ...character.vrm, url: vrmUrl, motions: vrmMotions } : undefined,
    },
  }

  if (world) {
    const [worldAvatarDataUrl, backgrounds, music] = await Promise.all([
      urlToDataUrl(world.avatarDataUrl),
      mapToDataUrls(world.backgrounds),
      mapToDataUrls(world.music),
    ])
    pack.world = {
      ...pickFields(world, CHARACTER_PACK_WORLD_FIELDS),
      avatarDataUrl: worldAvatarDataUrl,
      backgrounds,
      music,
    }
  }

  return pack
}

export function characterPackFilename(name: string): string {
  const safe = (name || 'character').replace(/[^a-z0-9-_ ]/gi, '').trim() || 'character'
  return `${safe}.rppack.json`
}

export function downloadCharacterPack(pack: CharacterPackV1) {
  const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = characterPackFilename(pack.character.card.name)
  a.click()
  URL.revokeObjectURL(url)
}

export async function parseCharacterPackFile(file: File): Promise<CharacterPackV1> {
  const text = await file.text()
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('Not a valid JSON file.')
  }
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).kind !== PACK_KIND) {
    throw new Error('Not a recognized character pack file (expected a .rppack.json exported from this app).')
  }
  return raw as CharacterPackV1
}

/**
 * Recreates a character — and its bundled world, if present — from a pack, as brand-new records.
 *
 * `rejectedScenarios` names any scene shape that failed validation and was left out, so the caller
 * can say so. A malformed scenario is still never loaded (it would strand a live scene), but dropping
 * one in silence is its own failure: the author sees an import that reported success and a world that
 * quietly cannot run the scene they wrote.
 */
export async function importCharacterPack(
  pack: CharacterPackV1,
): Promise<{ character: Character; world?: WorldCard; rejectedScenarios: string[] }> {
  let world: WorldCard | undefined
  const rejectedScenarios: string[] = []
  if (pack.world) {
    const scenarios: NonNullable<WorldCard['scenarios']> = []
    for (const [i, graph] of (pack.world.scenarios ?? []).entries()) {
      const problems = validateScenarioSource(graph)
      if (problems.length === 0) {
        scenarios.push(graph)
        continue
      }
      const name = (graph as { title?: string; id?: string } | null)?.title || (graph as { id?: string } | null)?.id || `#${i + 1}`
      rejectedScenarios.push(`${name}: ${problems.join('; ')}`)
    }
    world = await worldsApi.create({
      ...pickFields(pack.world, CHARACTER_PACK_WORLD_FIELDS),
      // Rejected wholesale rather than loaded broken — see `dating/scenarios.ts`'s validator. What
      // was rejected, and why, is returned above rather than swallowed here.
      scenarios,
    })
  }
  const { worldId: _worldId, sheet: _sheet, sheets: _sheets, ...fields } = pickFields(pack.character, CHARACTER_PACK_FIELDS)
  const character = await charactersApi.create({
    ...fields,
    sheet: pack.character.sheet ? { ...pack.character.sheet, worldId: world?.id ?? pack.character.sheet.worldId } : undefined,
    sheets: Object.fromEntries(Object.entries(pack.character.sheets ?? {}).map(([id, sheet]) => {
      const nextId = world && id === pack.character.worldId ? world.id : id
      return [nextId, { ...sheet, worldId: nextId }]
    })),
    worldId: world?.id,
  })
  return { character, world, rejectedScenarios }
}
