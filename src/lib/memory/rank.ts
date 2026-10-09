import type { CharacterMemory, MemoryRecall } from '../types.ts'
import { estimateTokens } from '../tokenEstimate.ts'

/**
 * Which of a character's memories reach their prompt. A character only ever sees memories whose
 * `knownBy` includes them; the rest is ranking (importance, recency, open threads, who is around,
 * and word overlap with the recent conversation) under a token budget.
 */

export const MEMORY_TOKEN_BUDGET = 350
export const MAX_PINNED = 8

export const DEEP_MEMORY_WEIGHTS = {
  importance: 0.45,
  recency: 0.25,
  openThread: 0.3,
  aboutPresent: 0.2,
  keywords: 0.3,
  feeling: 0.5,
  place: 0.5,
  recall: 0.25,
  similarity: 0.75,
} as const
// Below this gap between the best and the median score, a "best match" is mostly noise.
const MIN_SIMILARITY_SPREAD = 0.15
// Calibrate only finite scores of this speaker's eligible candidates. With five or
// more, median maps to zero and maximum to one, scaled down when the maximum barely
// stands out, so noise never crowns a winner; flat distributions add no boost.
// Small sets use a fixed 0.4 floor, rescaled to 0..1 to avoid amplifying noise.
function calibratedSimilarities(known: CharacterMemory[], scores?: ReadonlyMap<string, number>) {
  const values = known.map((m) => scores?.get(m.id)).filter((v): v is number => v !== undefined && Number.isFinite(v))
    .map((v) => Math.max(0, Math.min(1, v))).sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  const floor = values.length >= 5 ? (values[middle] + values[Math.ceil(values.length / 2) - 1]) / 2 : 0.4
  const ceiling = values.length >= 5 ? values[values.length - 1] : 1
  const confidence = values.length >= 5 ? Math.min(1, (ceiling - floor) / MIN_SIMILARITY_SPREAD) : 1
  return new Map(known.map((m) => {
    const raw = scores?.get(m.id)
    return [m.id, raw !== undefined && Number.isFinite(raw) && ceiling > floor
      ? confidence * Math.max(0, Math.min(1, (raw - floor) / (ceiling - floor))) : 0]
  }))
}
const RECALL_HALF_LIFE_MS = 30 * 86400_000
const placeKey = (value: string | null | undefined) => (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

function recallStrength(recall: MemoryRecall | undefined, now: number): number {
  if (!recall || !Number.isFinite(recall.count) || recall.count <= 0 || !Number.isFinite(recall.lastAt)) return 0
  const count = Math.min(1, Math.log1p(recall.count) / Math.log(11))
  const age = Math.max(0, now - recall.lastAt)
  return count * Math.pow(0.5, age / RECALL_HALF_LIFE_MS)
}

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
  /** Omitted means the original ranking, including the original reasons. */
  deep?: { location?: string | null; recalls?: ReadonlyMap<string, MemoryRecall>; similarities?: ReadonlyMap<string, number>; now: number }
}

/** The memories `characterId` knows that fit the budget, pinned first, then by score. */
/** Why a memory made it into a speaker's prompt, for the prompt inspector. */
export interface MemoryReasons {
  pinned: boolean
  openThread: boolean
  /** Ids of people present that it concerns. */
  aboutPresent: string[]
  /** Words it shares with the recent conversation. */
  matchedWords: string[]
  /** Among this speaker's newest memories. */
  recent: boolean
  /** Importance 0.7 or higher. */
  important: boolean
  score: number
  strongFeeling?: boolean
  samePlace?: boolean
  oftenRecalled?: boolean
  similarMeaning?: boolean
}

export interface ExplainedMemory {
  memory: CharacterMemory
  reasons: MemoryReasons
}

/** `selectMemories`, with the reasons each pick was made. Same picks, same order. */
export function selectMemoriesExplained(memories: CharacterMemory[], opts: SelectMemoriesOptions): ExplainedMemory[] {
  const { characterId, presentIds } = opts
  const budget = opts.budgetTokens ?? MEMORY_TOKEN_BUDGET
  const known = memoriesKnownBy(memories, characterId).filter((m) => typeof m.text === 'string' && m.text.trim())
  if (known.length === 0) return []

  const similarities = calibratedSimilarities(known, opts.deep?.similarities)
  const recent = keywords(opts.recentText ?? '')
  const present = new Set(presentIds)
  const byAge = [...known].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lastRank = Math.max(1, byAge.length - 1)
  const recency = new Map(byAge.map((m, i) => [m.id, byAge.length === 1 ? 1 : i / lastRank]))
  const reasonsFor = (m: CharacterMemory): MemoryReasons => {
    const aboutPresent = (m.about ?? []).filter((id) => present.has(id))
    const overlap = keywordOverlap(m.text, recent)
    const deep = opts.deep
    const feeling = deep ? Math.min(1, Math.abs(m.feelings?.[characterId] ?? 0)) : 0
    const place = !!deep && !!placeKey(m.location) && placeKey(m.location) === placeKey(deep.location)
    const strength = deep ? recallStrength(deep.recalls?.get(m.id), deep.now) : 0
    const similarity = similarities.get(m.id) ?? 0
    return {
      pinned: !!m.pinned,
      openThread: !!m.unresolved,
      aboutPresent,
      matchedWords: [...keywords(m.text)].filter((w) => recent.has(w)),
      recent: (recency.get(m.id) ?? 0) >= 0.8,
      important: (m.importance ?? 0.5) >= 0.7,
      ...(deep ? { strongFeeling: feeling >= 0.5, samePlace: place, oftenRecalled: strength >= 0.5 } : {}),
      ...(deep?.similarities ? { similarMeaning: similarity >= 0.6 } : {}),
      score: DEEP_MEMORY_WEIGHTS.importance * (m.importance ?? 0.5)
        + DEEP_MEMORY_WEIGHTS.recency * (recency.get(m.id) ?? 0)
        + (m.unresolved ? DEEP_MEMORY_WEIGHTS.openThread : 0)
        + (aboutPresent.length ? DEEP_MEMORY_WEIGHTS.aboutPresent : 0)
        + DEEP_MEMORY_WEIGHTS.keywords * overlap
        + (deep ? DEEP_MEMORY_WEIGHTS.feeling * feeling + DEEP_MEMORY_WEIGHTS.place * Number(place) + DEEP_MEMORY_WEIGHTS.recall * strength : 0)
        + (deep?.similarities ? DEEP_MEMORY_WEIGHTS.similarity * similarity : 0),
    }
  }
  const reasons = new Map(known.map((m) => [m.id, reasonsFor(m)]))
  const ranked = (list: CharacterMemory[]) =>
    [...list].sort((a, b) => (reasons.get(b.id)!.score - reasons.get(a.id)!.score) || tieBreak(a, b))

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
  return picked.map((memory) => ({ memory, reasons: reasons.get(memory.id)! }))
}

export function selectMemories(memories: CharacterMemory[], opts: SelectMemoriesOptions): CharacterMemory[] {
  return selectMemoriesExplained(memories, opts).map((picked) => picked.memory)
}

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`

/** How `characterId` came to know it, as they would put it: a claim or rumor they heard, a belief,
 *  or something a witness told them. '' for what they saw themselves. The player's ruling and any
 *  promotion to canon are deliberately not shown: a character who heard a false rumor believes it. */
function sourceCue(memory: CharacterMemory, characterId: string): string {
  if (memory.certainty === 'claim') return 'Heard, not confirmed'
  if (memory.certainty === 'belief') return 'Believes'
  const told = (memory.toldVia ?? []).some((t) => t.to.includes(characterId))
  return told && !(memory.witnesses ?? []).includes(characterId) ? 'Heard secondhand' : ''
}

/** One memory as `characterId` recalls it: open threads flagged (like `worldinfo/facts.ts`), secrets
 *  marked, how they know it (heard, believed, told), and a short cue for how it felt to them. */
export function formatMemoryLine(memory: CharacterMemory, characterId: string): string {
  const feeling = memory.feelings?.[characterId] ?? 0
  let status = ''
  if (memory.unresolved) status = feeling <= -0.15 ? 'Still unsettled, not resolved' : 'Still an open thread'
  if (memory.kind === 'secret') status = status ? `Kept secret, and ${lowerFirst(status)}` : 'Kept secret'
  const source = sourceCue(memory, characterId)
  const label = status && source ? `${status}; ${lowerFirst(source)}` : status || source
  const cue = feeling <= -0.5 ? ' (it still stings)' : feeling >= 0.5 ? ' (a warm memory)' : ''
  return `${label ? `${label}: ` : ''}${memory.text.trim()}${cue}`
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
