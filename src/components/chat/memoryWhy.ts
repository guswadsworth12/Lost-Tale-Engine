import type { MemoryReasons } from '@/lib/memory/rank'

/** How many shared words a "Matches" chip names before it stops listing. */
const MAX_MATCHED_WORDS = 4

/**
 * The reason chips the Prompt Inspector shows for one memory, in a fixed order: Pinned, Open
 * thread, About <names>, Matches <words>, Recent, Important. Only the ones that apply.
 */
export function whyLabels(reasons: MemoryReasons, aboutNames: string[]): string[] {
  const labels: string[] = []
  if (reasons.pinned) labels.push('Pinned')
  if (reasons.openThread) labels.push('Open thread')
  const names = aboutNames.filter((n) => n.trim())
  if (names.length) labels.push(`About ${names.join(', ')}`)
  const words = reasons.matchedWords.filter((w) => w.trim())
  if (words.length) {
    const shown = words.slice(0, MAX_MATCHED_WORDS).join(', ')
    const more = words.length - MAX_MATCHED_WORDS
    labels.push(`Matches: ${shown}${more > 0 ? ` +${more}` : ''}`)
  }
  if (reasons.recent) labels.push('Recent')
  if (reasons.important) labels.push('Important')
  if (reasons.strongFeeling) labels.push('Strong feeling')
  if (reasons.samePlace) labels.push('Happened here')
  if (reasons.oftenRecalled) labels.push('Often remembered')
  if (reasons.similarMeaning) labels.push('Similar meaning')
  for (const name of reasons.linkedThrough ?? []) labels.push(`Linked through ${name}`)
  return labels
}
