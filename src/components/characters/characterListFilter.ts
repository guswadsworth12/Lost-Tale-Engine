import type { Character } from '@/lib/characters/cardSpec'

export const UNTAGGED = 'Untagged'

/** What the Cast list is narrowed to: everything, "you only" cards, or one tag folder. */
export type CastScope = { kind: 'all' } | { kind: 'player' } | { kind: 'tag'; tag: string }

type ListCard = Pick<Character, 'playerOnly' | 'card'>

/** Tag folders, with untagged cards collected under `UNTAGGED`. A card with two tags sits in both. */
export function groupByTag<T extends ListCard>(characters: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const c of characters) {
    const tags = c.card.tags && c.card.tags.length > 0 ? c.card.tags : [UNTAGGED]
    for (const tag of tags) {
      if (!map.has(tag)) map.set(tag, [])
      map.get(tag)!.push(c)
    }
  }
  return map
}

/** The cards to show for a scope and search. The search narrows every scope, not just "all". */
export function filterCast<T extends ListCard>(characters: T[], scope: CastScope, search: string): T[] {
  const needle = search.trim().toLowerCase()
  return characters.filter((c) => {
    if (scope.kind === 'player' && c.playerOnly !== true) return false
    if (scope.kind === 'tag') {
      const tags = c.card.tags && c.card.tags.length > 0 ? c.card.tags : [UNTAGGED]
      if (!tags.includes(scope.tag)) return false
    }
    return !needle || c.card.name.toLowerCase().includes(needle)
  })
}
