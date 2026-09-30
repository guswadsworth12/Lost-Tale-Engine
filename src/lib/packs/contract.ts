/**
 * World packs: a world and its reusable setup, portable to another install without anyone's play
 * history. What the server and the browser agree on. See `fields.ts` for which fields travel.
 *
 * A pack is one folder, `<Title>.ltpack/`, zipped for transport:
 * - `manifest.json` (`WorldPackManifest`),
 * - `content/world.json`, `content/characters.json`, `content/lorebooks.json` (`WorldPackContent`),
 * - `media/<sha256>.<ext>`, each file once however often it is used.
 *
 * Inside a pack nothing carries an install's ids. Records have pack-local keys (`world`,
 * `character-1`, `lorebook-1`), references use those keys, and media fields hold
 * `ltpack-media:<file>` instead of a server path. Import gives every record a new id and rewires.
 */

export const WORLD_PACK_KIND = 'lost-tales-world-pack'
export const WORLD_PACK_FORMAT_VERSION = 1
export const PACK_MEDIA_PREFIX = 'ltpack-media:'
export const PACK_WORLD_KEY = 'world'
export const PACK_EXTENSION = '.ltpack'

/** What goes into a pack. Stories, chats, memories, accounts, and credentials are never an option. */
export interface PackSelection {
  /** The world's lorebook and the world-info books bound to the world or its cast. */
  lore: boolean
  /** Prompt items, scenarios, triggers, gifts and items, scene flags, custom intimacy options, stage layouts. */
  worldContent: boolean
  /** Non-player cast cards, as templates. */
  cast: boolean
  media: {
    /** World and character portraits. */
    portraits: boolean
    /** Expression sprites, including outfit sprites and their variants. */
    sprites: boolean
    /** Background art, day and night. */
    backgrounds: boolean
    music: boolean
    gallery: boolean
    /** VRM models. Large, so off by default. */
    models: boolean
  }
  /** The world's own tuning of the engine's prompts (`WorldCard.promptOverrides`). */
  promptOverrides: boolean
  /** Storyteller-only notes; may hold spoilers. */
  gmNotes: boolean
  /** Facts confirmed during someone's play. */
  canonFacts: boolean
  /** Stat sheets of the non-player cast for this world. */
  npcSheets: boolean
  /** Cards' private memory. */
  privateMemory: boolean
  /** Cards made to be played by a person ("you only"). */
  playerCards: boolean
  /** Cast left out one by one. Unset: everyone the options above include. */
  excludeCharacterIds?: string[]
}

export const DEFAULT_PACK_SELECTION: PackSelection = {
  lore: true,
  worldContent: true,
  cast: true,
  media: { portraits: true, sprites: true, backgrounds: true, music: true, gallery: true, models: false },
  promptOverrides: true,
  gmNotes: false,
  canonFacts: false,
  npcSheets: false,
  privateMemory: false,
  playerCards: false,
}

/** Attribution for one media file, or for the pack as a whole when `file` is unset. */
export interface PackCredit {
  file?: string
  title?: string
  source?: string
  author?: string
  licence?: string
}

/** What the exporter writes about the pack. */
export interface PackMetadata {
  title: string
  author?: string
  description?: string
  /** E.g. "CC-BY-4.0". */
  licence?: string
  credits?: PackCredit[]
}

export interface PackMediaEntry {
  /** `<sha256>.<ext>` under `media/`. */
  file: string
  mime: string
  bytes: number
}

/** One line of the included or excluded summary. */
export interface PackSummaryLine {
  label: string
  count?: number
  bytes?: number
  /** Set on a media line: which kind of media it counts. */
  media?: import('./fields').MediaKind
}

export interface WorldPackManifest extends PackMetadata {
  kind: typeof WORLD_PACK_KIND
  formatVersion: number
  appVersion: string
  exportedAt: number
  selection: PackSelection
  included: PackSummaryLine[]
  excluded: string[]
  media: PackMediaEntry[]
}

type Row = Record<string, unknown>

/** A pack's records. Each has a `key`; references between them use keys, never ids. */
export interface WorldPackContent {
  /** `key` is always `PACK_WORLD_KEY`. */
  world: Row
  /** `key`, and `worldKey` when they live in the pack's world. `sheets` are keyed by world key. */
  characters: Row[]
  /** `key`, `boundWorldKeys`, `boundCharacterKeys`. */
  lorebooks: Row[]
}

export const PACK_CONTENT_FILES = {
  world: 'content/world.json',
  characters: 'content/characters.json',
  lorebooks: 'content/lorebooks.json',
} as const

/** How to treat an import that meets a same-named world or character already in the library. */
export type ConflictResolution = 'copy' | 'skip' | 'replace'

export interface PackConflict {
  /** The pack record's key. */
  key: string
  kind: 'world' | 'character'
  name: string
  /** The existing record it meets. */
  existingId: string
}

/** POST /api/packs/preview's answer: everything the importer sees before anything is written. */
export interface PackPreview {
  previewId: string
  manifest: WorldPackManifest
  creates: { world: string; characters: string[]; lorebooks: string[] }
  mediaBytes: number
  mediaCount: number
  conflicts: PackConflict[]
  /** References to things outside the pack, dropped on import. */
  droppedReferences: string[]
  /** Content the importer fixed or left out while checking it (a malformed scenario, say). */
  warnings: string[]
  expiresAt: number
}

/** POST /api/packs/apply's body. `confirmReplace` must be true for any `replace` to go ahead. */
export interface PackApplyRequest {
  previewId: string
  resolutions?: Record<string, ConflictResolution>
  confirmReplace?: boolean
}

export interface PackApplyResult {
  worldId: string
  characterIds: string[]
  lorebookIds: string[]
  skipped: string[]
  replaced: string[]
}

/** Who can see a world, character, or world-info book. Unset reads as `shared`: everything made before ownership. */
export type Visibility = 'shared' | 'private'
