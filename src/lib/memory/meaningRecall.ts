export interface EmbeddingConnection { model: string; key: string; embed: (texts: string[], signal?: AbortSignal) => Promise<number[][]> }
export interface MeaningResult { similarities?: ReadonlyMap<string, number>; skipped?: string }

/** Browser-only query cache, bounded and shared by retries and the Inspector, never persisted. */
export class MeaningRecall {
  private queries = new Map<string, { expires: number; value: Promise<number[]> }>()
  async recall(enabled: boolean, connection: EmbeddingConnection | undefined, text: string,
    score: (model: string, vector: number[]) => Promise<Record<string, number>>): Promise<MeaningResult> {
    if (!enabled) return { skipped: 'Recall by meaning is off for this world.' }
    if (!connection) return { skipped: 'No embedding model is selected.' }
    if (!text.trim()) return { skipped: 'There is no recent conversation to compare yet.' }
    if (!crypto.subtle) return { skipped: 'Recall by meaning needs HTTPS or a browser on localhost.' }
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(connection.key + text))
      const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
      let cached = this.queries.get(key)
      if (cached && cached.expires < Date.now()) { this.queries.delete(key); cached = undefined }
      if (!cached) {
        const entry = { expires: Infinity, value: connection.embed([text]).then((rows) => rows[0]) }
        // Keep a failed query briefly too: Inspector/retries don't spam an unavailable service.
        entry.value.catch(() => { entry.expires = Date.now() + 30_000 })
        this.queries.set(key, entry)
        while (this.queries.size > 32) this.queries.delete(this.queries.keys().next().value!)
        cached = entry
      }
      const scores = await score(connection.model, await cached.value)
      if (!Object.keys(scores).length) return { skipped: 'No current indexed memories are available for this speaker.' }
      return { similarities: new Map(Object.entries(scores)) }
    } catch { return { skipped: 'The embedding service or meaning search could not answer. Ordinary recall was used.' } }
  }
  clear() { this.queries.clear() }
}
