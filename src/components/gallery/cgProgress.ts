import type { GalleryEntry } from '@/lib/characters/cardSpec'
import type { Chat } from '@/lib/types'

/** The player-character filter's "every story" value. Any other value is a card id (`Chat.playerCharacterId`). */
export const ALL_PLAYER_CHARACTERS = 'all'

/** Just the character fields CG progress reads — keeps this testable without a full card. */
export interface CgCharacter {
  id: string
  card: { name: string }
  gallery?: GalleryEntry[]
  playerOnly?: boolean
}

export type CgChat = Pick<Chat, 'characterId' | 'playerCharacterId' | 'affection' | 'unlockedGalleryIds'>

/**
 * The cards the "Progress for" filter offers: every "you only" card, plus any other card some
 * story is played as. Sorted by name.
 */
export function playerCharacterOptions<C extends CgCharacter>(characters: readonly C[], chats: readonly Pick<Chat, 'playerCharacterId'>[]): C[] {
  const played = new Set(chats.map((chat) => chat.playerCharacterId).filter((id): id is string => !!id))
  return characters
    .filter((character) => character.playerOnly || played.has(character.id))
    .sort((a, b) => a.card.name.localeCompare(b.card.name))
}

export interface CgStatus {
  entry: GalleryEntry
  unlocked: boolean
}

export interface CharacterCgProgress {
  characterId: string
  name: string
  /** Highest affection across this character's stories for the selected player character. */
  affection: number
  entries: CgStatus[]
  unlocked: number
  total: number
}

export interface CgProgressSummary {
  characters: CharacterCgProgress[]
  unlocked: number
  total: number
}

/**
 * The one unlock rule: a CG a story has explicitly unlocked (story beats, endings), or a regular CG
 * whose warmth threshold has been reached. Endings never unlock by affection — only by reaching
 * Sweethearts, which lands their id in `unlockedGalleryIds` (see `unlockedEndingIds`).
 */
export function isCgUnlocked(entry: GalleryEntry, unlockedIds: ReadonlySet<string>, affection: number): boolean {
  return unlockedIds.has(entry.id) || (!entry.isEnding && affection >= entry.unlockAffection)
}

/**
 * Per-character CG unlock progress, counting only the stories played as `playerCharacterId`
 * (or every story for `ALL_PLAYER_CHARACTERS`). Characters without any CGs are left out.
 */
export function cgProgress(
  characters: readonly CgCharacter[],
  chats: readonly CgChat[],
  playerCharacterId: string = ALL_PLAYER_CHARACTERS,
): CgProgressSummary {
  const relevant = playerCharacterId === ALL_PLAYER_CHARACTERS ? chats : chats.filter((chat) => chat.playerCharacterId === playerCharacterId)
  const unlockedIds = new Map<string, Set<string>>()
  const affection = new Map<string, number>()
  for (const chat of relevant) {
    const ids = unlockedIds.get(chat.characterId) ?? new Set<string>()
    for (const id of chat.unlockedGalleryIds ?? []) ids.add(id)
    unlockedIds.set(chat.characterId, ids)
    affection.set(chat.characterId, Math.max(affection.get(chat.characterId) ?? 0, chat.affection ?? 0))
  }

  const rows: CharacterCgProgress[] = []
  for (const character of characters) {
    const gallery = character.gallery ?? []
    if (!gallery.length) continue
    const ids = unlockedIds.get(character.id) ?? new Set<string>()
    const best = affection.get(character.id) ?? 0
    const entries = gallery.map((entry) => ({ entry, unlocked: isCgUnlocked(entry, ids, best) }))
    rows.push({
      characterId: character.id,
      name: character.card.name,
      affection: best,
      entries,
      unlocked: entries.filter((status) => status.unlocked).length,
      total: entries.length,
    })
  }
  return {
    characters: rows,
    unlocked: rows.reduce((sum, row) => sum + row.unlocked, 0),
    total: rows.reduce((sum, row) => sum + row.total, 0),
  }
}

/** The short label a locked CG shows over its obscured thumbnail. */
export function lockedCgLabel(entry: GalleryEntry): string {
  return entry.isEnding ? 'Reach Sweethearts' : `Unlocks at ${entry.unlockAffection} warmth`
}

/** Unlocked CGs that actually have art — what the larger viewer can step through, in gallery order. */
export function viewableCgs(row: CharacterCgProgress): GalleryEntry[] {
  return row.entries.filter((status) => status.unlocked && status.entry.imageUrl).map((status) => status.entry)
}
