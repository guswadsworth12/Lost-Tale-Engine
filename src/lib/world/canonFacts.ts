import type { WorldCard } from '@/lib/types'

/**
 * World canon facts and who may be told them.
 *
 * - A fact typed into the world by hand has no `sourceChatId`: it is world background, and everyone
 *   in the world is told it.
 * - A fact recorded from play (the end of a scene, a confirmed claim, a Game Master proposal) has a
 *   `sourceChatId`. It stays in the story and branch it came from, so another story in the same
 *   world never hears it, and with `knownBy` only the characters who were there are told it.
 * - `shared` is the player's choice to tell a recorded fact to the whole world after all.
 *
 * Facts recorded before `knownBy` existed have a `sourceChatId` and no `knownBy`: they stay in
 * their own story, told to everyone in it.
 */

export type CanonFact = NonNullable<WorldCard['canonFacts']>[number]

/** Who is asking: a character by id, or the narrator (Game Master), who is told every fact of this branch. */
export type CanonViewer = string | 'narrator'

/**
 * The facts `viewer` may be told. `branchIds` is every scene id in the current story branch
 * (`sceneChain` plus the scene itself); without it, only the person check applies.
 */
export function canonFactsFor(facts: readonly CanonFact[] | undefined, viewer: CanonViewer, branchIds?: ReadonlySet<string>): CanonFact[] {
  return (facts ?? []).filter((fact) => {
    if (fact.shared) return true
    if (fact.sourceChatId && branchIds && !branchIds.has(fact.sourceChatId)) return false
    return viewer === 'narrator' || !fact.knownBy || fact.knownBy.includes(viewer)
  })
}

/** Ids worth storing as `knownBy`: unique, non-empty. An empty result is `undefined` (everyone in the story), never "known to nobody". */
export function canonAudience(ids: readonly (string | undefined | null)[] | undefined): string[] | undefined {
  const unique = [...new Set((ids ?? []).filter((id): id is string => !!id))]
  return unique.length ? unique : undefined
}

/** Whether a fact is kept to its story (and maybe to the people who were there), for the world editor's label. */
export function canonIsPrivate(fact: CanonFact): boolean {
  return !fact.shared && (!!fact.sourceChatId || !!fact.knownBy)
}
