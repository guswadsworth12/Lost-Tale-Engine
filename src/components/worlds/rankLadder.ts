import type { CampaignRank } from '@/lib/world/campaign'

/** Limits that match `normalizeCampaignRanks`, so the editor never offers what the save would drop. */
export const MAX_RANKS = 20
export const RANK_NAME_MAX = 60
export const RANK_NOTE_MAX = 200

/** A copy of `list` with the item at `index` swapped one place up (-1) or down (+1). Out of range is a no-op copy. */
export function moveItem<T>(list: readonly T[], index: number, delta: -1 | 1): T[] {
  const next = [...list]
  const target = index + delta
  if (index < 0 || index >= next.length || target < 0 || target >= next.length) return next
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** A default name for a new rung that doesn't collide with an existing one. */
export function nextRankName(ranks: readonly CampaignRank[]): string {
  const taken = new Set(ranks.map((rank) => rank.name.trim().toLowerCase()))
  let number = ranks.length + 1
  while (taken.has(`rank ${number}`)) number++
  return `Rank ${number}`
}

/** Why the ladder can't be saved as written, or undefined when it can. Names are unique ignoring case, as on the server. */
export function rankLadderProblem(ranks: readonly CampaignRank[]): string | undefined {
  if (ranks.length > MAX_RANKS) return `A ladder can have at most ${MAX_RANKS} ranks.`
  const names = ranks.map((rank) => rank.name.trim().toLowerCase())
  if (!names.every(Boolean) || new Set(names).size !== names.length) return 'Give each rank a unique, nonempty name before saving.'
  return undefined
}

export interface RankOption {
  value: string
  label: string
  disabled?: boolean
}

const shorten = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value)

/**
 * Options for a character's Rank select: "(none)", each rung lowest first (its note shortened
 * alongside), and, when the saved rank is no longer on the ladder, that rank as a disabled entry so
 * it stays visible and selected instead of being silently dropped.
 */
export function rankSelectOptions(ranks: readonly CampaignRank[] | undefined, current: string | undefined): RankOption[] {
  const ladder = ranks ?? []
  const options: RankOption[] = [{ value: '', label: '(none)' }]
  if (current && !ladder.some((rank) => rank.name === current)) options.push({ value: current, label: `${current} (not on ladder)`, disabled: true })
  for (const rank of ladder) options.push({ value: rank.name, label: rank.note ? `${rank.name} · ${shorten(rank.note, 60)}` : rank.name })
  return options
}
