import type { CharacterMemory } from '@/lib/types'

/**
 * What the Game Master needs to know about character memory: the GM sees every memory, and is
 * told who in the scene does not know something that someone else present does (dramatic irony,
 * secrets, things a character could let slip).
 */

type NameOf = (id: string) => string | undefined

function byImportance(a: CharacterMemory, b: CharacterMemory): number {
  return (b.importance ?? 0) - (a.importance ?? 0)
    || Number(!!b.unresolved) - Number(!!a.unresolved)
    || b.createdAt - a.createdAt
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

const bare = (text: string) => text.trim().replace(/[.!\s]+$/, '')

function isGapWorthy(m: CharacterMemory): boolean {
  return m.active && m.kind !== 'journal' && typeof m.text === 'string' && !!m.text.trim()
    && ((m.importance ?? 0) >= 0.6 || !!m.unresolved || m.kind === 'secret')
}

/** One line per present character who is missing something another present character knows,
 *  e.g. "Bea does not know: Ash broke the east gate ward." Up to 3 memories per line, the
 *  character missing the most important one first, at most `max` lines. */
export function knowledgeGaps(
  memories: CharacterMemory[],
  presentIds: string[],
  nameOf: NameOf,
  opts?: { max?: number },
): string[] {
  const max = opts?.max ?? 6
  const present = [...new Set(presentIds)]
  const unaware = new Map<string, CharacterMemory[]>()
  for (const m of memories.filter(isGapWorthy).sort(byImportance)) {
    if (!present.some((id) => m.knownBy.includes(id))) continue
    for (const id of present) {
      if (m.knownBy.includes(id) || !nameOf(id)) continue
      const list = unaware.get(id) ?? []
      list.push(m)
      unaware.set(id, list)
    }
  }
  return [...unaware.entries()]
    .sort(([a, ma], [b, mb]) => byImportance(ma[0], mb[0]) || present.indexOf(a) - present.indexOf(b))
    .slice(0, max)
    .map(([id, list]) => `${nameOf(id)} does not know: ${list.slice(0, 3).map((m) => bare(m.text)).join('; ')}.`)
}

/** The GM's view of memory: the top memories across everyone, each with who knows it. */
export function gmMemoryDigest(memories: CharacterMemory[], nameOf: NameOf, opts?: { max?: number }): string[] {
  const max = opts?.max ?? 12
  const live = memories.filter((m) => m.active && m.kind !== 'journal' && typeof m.text === 'string' && m.text.trim())
  if (live.length === 0) return []
  const byAge = [...live].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const lastRank = Math.max(1, byAge.length - 1)
  const recency = new Map(byAge.map((m, i) => [m.id, byAge.length === 1 ? 1 : i / lastRank]))
  const score = (m: CharacterMemory) =>
    0.5 * (m.importance ?? 0.5) + (m.unresolved ? 0.3 : 0) + 0.2 * (recency.get(m.id) ?? 0) + (m.pinned ? 0.2 : 0)
  const scores = new Map(live.map((m) => [m.id, score(m)]))
  return live
    .sort((a, b) => (scores.get(b.id)! - scores.get(a.id)!) || byImportance(a, b))
    .slice(0, max)
    .map((m) => {
      const names = [...new Set(m.knownBy)].map(nameOf).filter((n): n is string => !!n)
      const tags = [m.kind === 'secret' ? 'secret' : '', m.unresolved ? 'unresolved' : ''].filter(Boolean)
      const known = names.length ? `known by: ${names.join(', ')}` : 'known by: no one named'
      return `- ${m.text.trim()} (${[...tags, known].join('; ')})`
    })
}
