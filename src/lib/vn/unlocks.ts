import type { Character } from '@/lib/characters/cardSpec'
import type { WorldCard } from '@/lib/types'
import { DEFAULT_EXPRESSION_IDS } from '@/lib/vn/expressions'
import { backgroundCatalog } from '@/lib/vn/backgrounds'

/**
 * Which expression sprite ids the model is allowed to pick for this character right now, gated by
 * `Character.spriteUnlocks` at the given affection — a card with no custom sprites at all just
 * offers the built-in default set (nothing to gate). Shared by the live per-turn scene tag
 * instruction (`useChatSession.ts`) and `detectGreetingScene`'s one-shot pass over the static
 * opening greeting, so both ever offer the same ids.
 */
export function getUnlockedExpressionIds(character: Character, affection: number): string[] {
  const spriteIds = Object.keys(character.sprites ?? {})
  if (spriteIds.length === 0) return DEFAULT_EXPRESSION_IDS
  const unlocks = character.spriteUnlocks ?? {}
  const unlocked = spriteIds.filter((id) => affection >= Number(unlocks[id] ?? 0))
  return unlocked.length ? unlocked : ['neutral']
}

/** Same idea as `getUnlockedExpressionIds`, for `WorldCard.backgrounds`/`backgroundUnlocks`. */
export function getUnlockedBackgroundIds(world: WorldCard | undefined, affection: number): string[] {
  // With no art uploaded, the world's chosen scenery set (plus its own named places) is the menu.
  const fallback = [...backgroundCatalog(world).map((b) => b.id), ...(world?.customBackgrounds ?? []).map((b) => b.id)]
  const ids = Object.keys(world?.backgrounds ?? {})
  if (ids.length === 0) return fallback
  const unlocks = world?.backgroundUnlocks ?? {}
  const unlocked = ids.filter((id) => affection >= Number(unlocks[id] ?? 0))
  return unlocked.length ? unlocked : fallback
}
