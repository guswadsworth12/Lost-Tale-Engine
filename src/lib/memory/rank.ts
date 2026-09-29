import type { CharacterMemory } from '@/lib/types'
import { estimateTokens } from '@/lib/tokenEstimate'

/**
 * Which of a character's memories reach their prompt. A character only ever sees memories whose
 * `knownBy` includes them; the rest is ranking (importance, recency, open threads, who is around,
 * and word overlap with the recent conversation) under a token budget.
 */

export const MEMORY_TOKEN_BUDGET = 350
export const MAX_PINNED = 8

/** Live, non-journal memories `characterId` knows and has not already folded into their own
 *  journal (`consolidatedFor`); another knower whose journal lacks it still retrieves it. */
export function memoriesKnownBy(memories: CharacterMemory[], characterId: string): CharacterMemory[] {
  return memories.filter((m) => m.active && m.kind !== 'journal' && m.knownBy.includes(characterId)
    && !m.consolidatedFor?.includes(characterId))
}

/** The newest active journal `characterId` keeps, if any. */
export function latestJournal(memories: CharacterMemory[], characterId: string): CharacterMemory | undefined {
  let best: CharacterMemory | undefined
  for (const m of memories) {
    if (!m.active || m.kind !== 'journal' || !m.knownBy.includes(characterId)) continue
    if (!best || m.createdAt > best.createdAt || (m.createdAt === best.createdAt && m.id > best.id)) best = m
  }
  return best
}

// Mirrors the keyword idea in server/assistantSearch.ts (not imported: server code stays out of src).
const STOP = new Set(('a about after again all also an and any are as at be been before but by can could did do does for from '
  + 'had has have he her here hers him his how i if in into is it its just me more most my no not now of off on once only or '
  + 'other our out over own she so some than that the their them then there these they this those through to too under up '
  + 'very was we were what when where which while who whom why will with would you your yours said says still').split(' '))

function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3)
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

/** Lowercased, stopword-free, lightly stemmed content words. */
export function keywords(text: string): Set<string> {
  const out = new Set<string>()
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (w.length > 2 && !STOP.has(w)) out.add(stem(w))
  }
  return out
}

/** Share (0..1) of a memory's content words that also appear in `recent`. */
export function keywordOverlap(text: string, recent: Set<string>): number {
  const own = keywords(text)
  if (own.size === 0 || recent.size === 0) return 0
  let hit = 0
  for (const w of own) if (recent.has(w)) hit++
  return hit / own.size
}

/** Newer first, then id, so equal scores always come out in the same order. */
function tieBreak(a: CharacterMemory, b: CharacterMemory): number {
  return b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export interface SelectMemoriesOptions {
  characterId: string
  /** Who is in the scene now: memories `about` any of them rank higher. */
  presentIds: string[]
  /** The last few messages, for keyword relevance. */
  recentText: string
  /** Default `MEMORY_TOKEN_BUDGET`. Pinned memories are kept even past it (up to `MAX_PINNED`). */
  budgetTokens?: number
}

/** The memories `characterId` knows that fit the budget, pinned first, then by score. */
export function selectMemories(memories: CharacterMemory[], opts: SelectMemoriesOptions): CharacterMemory[] {
  const { characterId, presentIds } = opts
  const budget = opts.budgetTokens ?? MEMORY_TOKEN_BUDGET
  const known = memoriesKnownBy(memories, characterId).filter((m) => typeof m.text === 'string' && m.text.trim())
  if (known.length === 0) return []

  const recent = keywords(opts.recentText ?? '')
  const present = new Set(presentIds)
  const byAge = [...known].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lastRank = Math.max(1, byAge.length - 1)
  const recency = new Map(byAge.map((m, i) => [m.id, byAge.length === 1 ? 1 : i / lastRank]))
  const score = (m: CharacterMemory) =>
    0.45 * (m.importance ?? 0.5)
    + 0.25 * (recency.get(m.id) ?? 0)
    + (m.unresolved ? 0.3 : 0)
    + (m.about?.some((id) => present.has(id)) ? 0.2 : 0)
    + 0.3 * keywordOverlap(m.text, recent)
  const scores = new Map(known.map((m) => [m.id, score(m)]))
  const ranked = (list: CharacterMemory[]) =>
    [...list].sort((a, b) => (scores.get(b.id)! - scores.get(a.id)!) || tieBreak(a, b))

  const cost = (m: CharacterMemory) => estimateTokens(`- ${formatMemoryLine(m, characterId)}\n`)
  const pinned = ranked(known.filter((m) => m.pinned)).slice(0, MAX_PINNED)
  let used = pinned.reduce((sum, m) => sum + cost(m), 0)
  const picked = [...pinned]
  for (const m of ranked(known.filter((m) => !m.pinned))) {
    const c = cost(m)
    if (used + c > budget) continue
    picked.push(m)
    used += c
  }
  return picked
}

/** One memory as `characterId` recalls it: open threads flagged (like `worldinfo/facts.ts`), secrets
 *  marked, and a short cue for how it felt to them. */
export function formatMemoryLine(memory: CharacterMemory, characterId: string): string {
  const feeling = memory.feelings?.[characterId] ?? 0
  let prefix = ''
  if (memory.unresolved) prefix = feeling <= -0.15 ? 'Still unsettled, not resolved: ' : 'Still an open thread: '
  if (memory.kind === 'secret') prefix = prefix ? `Kept secret, and ${prefix.charAt(0).toLowerCase()}${prefix.slice(1)}` : 'Kept secret: '
  const cue = feeling <= -0.5 ? ' (it still stings)' : feeling >= 0.5 ? ' (a warm memory)' : ''
  return `${prefix}${memory.text.trim()}${cue}`
}

/** The prompt block for one character's memories, or '' when there is nothing to recall. */
export function memoryBlock(
  name: string,
  selected: CharacterMemory[],
  journal: CharacterMemory | null | undefined,
  characterId: string,
): string {
  const journalText = journal?.text?.trim() ?? ''
  if (selected.length === 0 && !journalText) return ''
  const lines = selected.map((m) => `- ${formatMemoryLine(m, characterId)}`)
  return [`What ${name} remembers (only ${name} knows exactly this; others may not):`, ...(journalText ? [journalText] : []), ...lines].join('\n')
}
