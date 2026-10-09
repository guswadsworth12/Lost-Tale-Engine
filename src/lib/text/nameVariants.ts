/** How narration refers to a character: the full card name, or the first name alone ("Wren" for "Wren Talley"). */
export function nameVariants(name: string): string[] {
  const full = name.trim()
  const first = full.split(/\s+/)[0] ?? ''
  return [...new Set([full, first.length >= 3 ? first : ''])].filter(Boolean)
}
