import type { CharacterMemory } from '@/lib/types'

/** "Ash", "Ash and Bea", "Ash, Bea and Cole". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Active, non-journal memories grouped by the message they came from. Memories with no source message are left out. */
export function memoriesByMessage(memories: CharacterMemory[]): Map<string, CharacterMemory[]> {
  const out = new Map<string, CharacterMemory[]>()
  for (const m of memories) {
    if (!m.sourceMessageId || m.active === false || m.kind === 'journal') continue
    const list = out.get(m.sourceMessageId)
    if (list) list.push(m)
    else out.set(m.sourceMessageId, [m])
  }
  return out
}

/** Everyone who knows any of these, as names in first-seen order. Ids with no name become one "Someone", listed last. */
export function rememberers(memories: CharacterMemory[], nameOf: (id: string) => string | undefined): string[] {
  const names: string[] = []
  let someone = false
  for (const m of memories) {
    for (const id of m.knownBy ?? []) {
      const name = nameOf(id)?.trim()
      if (!name) someone = true
      else if (!names.includes(name)) names.push(name)
    }
  }
  return someone ? [...names, 'Someone'] : names
}

/** The line under a message: "Ash and Bea will remember this". */
export function rememberLine(names: string[]): string {
  return `${joinNames(names.length ? names : ['Someone'])} will remember this`
}
