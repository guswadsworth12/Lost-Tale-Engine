import type { Character } from '@/lib/characters/cardSpec'
import type { WorldCard, WorldInfoBook } from '@/lib/types'

/**
 * Which fields travel in a pack, for every field a world or character has. The records below are
 * keyed by the types' own keys, so a field added to `Character` or `WorldCard` without being
 * classified here fails the typecheck: nothing new leaks into a pack, or silently stays behind,
 * by default. The character pack (`characters/pack.ts`) is held to the same lists.
 *
 * - `template`: describes the character or world; travels when its section is chosen.
 * - `media:*`: server-hosted files; travel when that media is chosen.
 * - an option name (`gmNotes`, `npcSheets`, ...): travels only when that option is chosen.
 * - `reference`: an id of another record, rewired to pack keys.
 * - `record`: id and timestamps, made fresh on import.
 * - `local`: this install's or this user's own business. Never in a pack.
 */

export type MediaKind = 'portraits' | 'sprites' | 'backgrounds' | 'music' | 'gallery' | 'models'

export type CharacterFieldClass = 'template' | `media:${MediaKind}` | 'npcSheets' | 'privateMemory' | 'reference' | 'record' | 'local'

export const CHARACTER_FIELDS: Record<keyof Character, CharacterFieldClass> = {
  id: 'record',
  createdAt: 'record',
  updatedAt: 'record',
  card: 'template',
  gmEligible: 'template',
  playerOnly: 'template',
  playerDescription: 'template',
  promptItems: 'template',
  privateMemory: 'privateMemory',
  // A model name on this install's provider.
  modelOverride: 'local',
  avatarDataUrl: 'media:portraits',
  worldId: 'reference',
  sheet: 'npcSheets',
  sheets: 'npcSheets',
  sprites: 'media:sprites',
  spriteUnlocks: 'template',
  spriteVariants: 'media:sprites',
  // Content hashes the local sprite importer uses to skip unchanged art.
  spriteSources: 'local',
  vrm: 'media:models',
  outfits: 'template',
  customExpressions: 'template',
  giftPreferences: 'template',
  giftLikes: 'template',
  giftDislikes: 'template',
  loveLanguage: 'template',
  explicitVoiceNote: 'template',
  // Entries travel with the cast; their images only when gallery media is chosen.
  gallery: 'media:gallery',
  relationshipStarters: 'template',
  voice: 'template',
  // Measured from this install's voice samples.
  voiceFingerprint: 'local',
  sfxWords: 'template',
  // Points at one of this install's instruct templates.
  instructTemplateId: 'local',
  replyLength: 'template',
  weatherPreferences: 'template',
  schedule: 'template',
  birthday: 'template',
  likes: 'template',
  goals: 'template',
  boundaries: 'template',
  touchProfile: 'template',
  kinkProfile: 'template',
  // Named, not linked by id: they travel as written.
  socialConnections: 'template',
  behavioralRules: 'template',
  occupation: 'template',
  workplace: 'template',
  homeLocation: 'template',
  frequentedLocations: 'template',
  dateModeOptOut: 'template',
  outreach: 'template',
  ownerUserId: 'local',
  visibility: 'local',
  // This install's history of changes made here.
  revisions: 'local',
}

export type WorldFieldClass = 'setting' | 'lore' | 'worldContent' | `media:${MediaKind}` | 'promptOverrides' | 'gmNotes' | 'canonFacts' | 'record' | 'local'

export const WORLD_FIELDS: Record<keyof WorldCard, WorldFieldClass> = {
  id: 'record',
  createdAt: 'record',
  updatedAt: 'record',
  name: 'setting',
  description: 'setting',
  rules: 'setting',
  artStyle: 'setting',
  template: 'setting',
  modules: 'setting',
  campaign: 'setting',
  scenerySet: 'setting',
  customBackgrounds: 'setting',
  defaultBackgroundId: 'setting',
  backgroundUnlocks: 'setting',
  relationshipThresholds: 'setting',
  intimacyLevel: 'setting',
  lorebook: 'lore',
  promptItems: 'worldContent',
  scenarios: 'worldContent',
  triggers: 'worldContent',
  gifts: 'worldContent',
  items: 'worldContent',
  customSceneFlags: 'worldContent',
  customIntimacyOptions: 'worldContent',
  replaceIntimacyCatalog: 'worldContent',
  // Cues are keyed by character id, rewired to pack keys.
  stageLayouts: 'worldContent',
  avatarDataUrl: 'media:portraits',
  backgrounds: 'media:backgrounds',
  backgroundsNight: 'media:backgrounds',
  music: 'media:music',
  promptOverrides: 'promptOverrides',
  gmNotes: 'gmNotes',
  canonFacts: 'canonFacts',
  // Where this install's world clock stands.
  currentDay: 'local',
  currentPhaseIndex: 'local',
  // This install's history of changes made here.
  revisions: 'local',
  ownerUserId: 'local',
  visibility: 'local',
}

export type LorebookFieldClass = 'template' | 'reference' | 'record' | 'local'

export const LOREBOOK_FIELDS: Record<keyof WorldInfoBook, LorebookFieldClass> = {
  id: 'record',
  createdAt: 'record',
  name: 'template',
  book: 'template',
  // Chats never travel; worlds and characters are rewired to pack keys.
  boundChatIds: 'local',
  boundCharacterIds: 'reference',
  boundWorldIds: 'reference',
  ownerUserId: 'local',
  visibility: 'local',
}

/** The character fields the single-character pack (`characters/pack.ts`) carries. Never a `local` one. */
export const CHARACTER_PACK_FIELDS = [
  'card', 'playerOnly', 'worldId', 'sheet', 'sheets', 'avatarDataUrl', 'sprites', 'spriteUnlocks', 'outfits',
  'customExpressions', 'giftPreferences', 'giftLikes', 'giftDislikes', 'loveLanguage', 'weatherPreferences', 'schedule',
  'gallery', 'relationshipStarters', 'voice', 'sfxWords', 'replyLength', 'occupation', 'workplace', 'homeLocation',
  'frequentedLocations', 'likes', 'goals', 'boundaries', 'touchProfile', 'kinkProfile', 'socialConnections', 'dateModeOptOut',
] as const satisfies readonly (keyof Character)[]

/** The world fields the single-character pack carries alongside its character. Never a `local` one. */
export const CHARACTER_PACK_WORLD_FIELDS = [
  'name', 'description', 'rules', 'template', 'lorebook', 'avatarDataUrl', 'backgrounds', 'backgroundUnlocks',
  'customBackgrounds', 'music', 'gifts', 'items', 'customSceneFlags', 'scenarios', 'relationshipThresholds', 'campaign', 'modules',
] as const satisfies readonly (keyof WorldCard)[]

/** A copy of `row` with only `fields`, leaving out the ones it doesn't have. */
export function pickFields<T extends object, K extends keyof T>(row: T, fields: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>
  for (const field of fields) if (row[field] !== undefined) out[field] = row[field]
  return out
}
