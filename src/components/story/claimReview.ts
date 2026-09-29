import type { CharacterMemory, WorldCard } from '@/lib/types'

/**
 * The player's review of what characters heard or think (`ClaimReview`): claims and beliefs wait
 * here until ruled true or false, corrected, or made world canon. A ruling reaches the GM only;
 * the characters who heard a claim keep believing it either way.
 */

type CanonFact = NonNullable<WorldCard['canonFacts']>[number]

const isClaimOrBelief = (m: CharacterMemory) =>
  m.active && m.kind !== 'journal' && (m.certainty === 'claim' || m.certainty === 'belief') && !!m.text?.trim()

/** Claims and beliefs nobody has ruled on yet, newest first. */
export function claimsToReview(memories: readonly CharacterMemory[]): CharacterMemory[] {
  return memories.filter((m) => isClaimOrBelief(m) && !m.verdict)
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Claims and beliefs the player has ruled on, most recently ruled first. */
export function ruledClaims(memories: readonly CharacterMemory[]): CharacterMemory[] {
  const at = (m: CharacterMemory) => m.updatedAt ?? m.createdAt
  return memories.filter((m) => isClaimOrBelief(m) && !!m.verdict)
    .sort((a, b) => at(b) - at(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** A claim's wording as a plain fact: "Cole said that the mayor fled." becomes "The mayor fled."
 *  Anything not in that shape is returned trimmed, for the player to reword. */
export function canonTextFrom(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^[\p{L}'’ .-]{1,60}?\s(?:said|says|claimed|claims|swore|swears|insisted|insists|told [\p{L}'’-]+)(?:,[^,]{1,60},)?\s+that(?:,[^,]{1,60},)?\s+(.+)$/u)
  if (!match) return trimmed
  const rest = match[1].trim()
  return rest ? `${rest.charAt(0).toUpperCase()}${rest.slice(1)}` : trimmed
}

/**
 * Promoting a claim to world canon: the world's facts with the new one appended (the same shape
 * `finishScene` writes), and the patch that marks the memory ruled true and linked to it. Blank
 * text changes nothing (null).
 */
export function promoteToCanon(
  canonFacts: readonly CanonFact[] | undefined,
  text: string,
  sourceChatId: string,
  id: string,
  now: number,
): { canonFacts: CanonFact[]; memoryPatch: { verdict: 'true'; canonFactId: string } } | null {
  const fact = text.trim()
  if (!fact) return null
  return {
    canonFacts: [...(canonFacts ?? []), { id, text: fact, createdAt: now, sourceChatId }],
    memoryPatch: { verdict: 'true', canonFactId: id },
  }
}
