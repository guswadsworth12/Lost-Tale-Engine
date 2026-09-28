/** Text-only records retrieved from the app's own saved library for Writer's Room. */
export interface LocalSource {
  kind: 'world' | 'cast' | 'lore' | 'story' | 'message' | 'goal' | 'fact'
  id: string
  title: string
  excerpt: string
}

export function formatLocalSources(sources: readonly LocalSource[]): string {
  return sources.map((source, index) =>
    `[${index + 1}] ${source.kind}: ${source.title}\n${source.excerpt}`,
  ).join('\n\n')
}
