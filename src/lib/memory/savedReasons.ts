import type { MemoryReasons } from './rank'
/** Bound saved diagnostics without changing the reasons used for ranking or inspection. */
export function savedRecallReasons(reasons: MemoryReasons): MemoryReasons {
  const strings = (items: string[]) => items.slice(0, 10).map((s) => s.slice(0, 80))
  return {
    ...reasons,
    aboutPresent: strings(reasons.aboutPresent),
    matchedWords: strings(reasons.matchedWords),
    ...(reasons.linkedThrough ? { linkedThrough: strings(reasons.linkedThrough) } : {}),
    ...(reasons.linkedWeights ? { linkedWeights: Object.fromEntries(Object.entries(reasons.linkedWeights).slice(0, 10).map(([name, weight]) => [name.slice(0, 80), weight])) } : {}),
  }
}
