/**
 * A small text diff for reviewing a proposed change: which words (or lines) were kept, removed, and
 * added. The common start and end are trimmed first, so a long prompt with one changed section only
 * compares that section.
 */

export interface DiffPart {
  type: 'same' | 'removed' | 'added'
  text: string
}

/** Past this many token pairs, the middle is shown as one removal and one addition. */
const MAX_CELLS = 2_000_000

function diffTokens(a: string[], b: string[]): DiffPart[] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const midA = a.slice(start, endA)
  const midB = b.slice(start, endB)
  const parts: DiffPart[] = []
  const push = (type: DiffPart['type'], text: string) => {
    if (!text) return
    const last = parts[parts.length - 1]
    if (last?.type === type) last.text += text
    else parts.push({ type, text })
  }
  push('same', a.slice(0, start).join(''))
  if (midA.length * midB.length > MAX_CELLS) {
    push('removed', midA.join(''))
    push('added', midB.join(''))
  } else {
    // Longest common subsequence, then walk it.
    const n = midA.length
    const m = midB.length
    const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { push('same', midA[i]); i++; j++ }
      else if (lcs[i + 1][j] >= lcs[i][j + 1]) { push('removed', midA[i]); i++ }
      else { push('added', midB[j]); j++ }
    }
    while (i < n) push('removed', midA[i++])
    while (j < m) push('added', midB[j++])
  }
  push('same', a.slice(endA).join(''))
  return parts
}

/** Word by word, keeping the spaces with the words: for short texts such as a prompt's guidance. */
export function diffWords(before: string, after: string): DiffPart[] {
  const split = (text: string) => text.match(/\s+|[^\s]+/g) ?? []
  return diffTokens(split(before), split(after))
}

/** Line by line: for a whole prompt. */
export function diffLines(before: string, after: string): DiffPart[] {
  const split = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? []
  return diffTokens(split(before), split(after))
}

/** Whether a diff changes anything. */
export function hasChanges(parts: readonly DiffPart[]): boolean {
  return parts.some((p) => p.type !== 'same')
}
