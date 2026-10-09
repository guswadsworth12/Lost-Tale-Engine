export interface EmbeddingConnection { model: string; key: string; dimensions?: () => number | undefined; embed: (texts: string[], signal?: AbortSignal) => Promise<number[][]> }
export interface MeaningResult { queryVector?: number[]; similarities?: ReadonlyMap<string, number>; skipped?: string }

// Bound both embedding and scoring, even if a provider ignores cancellation.
function withinReplyDeadline<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Browser-only query cache, bounded and shared by retries and the Inspector, never persisted. */
export class MeaningRecall {
  private queries = new Map<string, { expires: number; dims?: number; value: Promise<number[]> }>()
  async recall(enabled: boolean, connection: EmbeddingConnection | undefined, text: string,
    score: (model: string, vector: number[], signal?: AbortSignal) => Promise<Record<string, number>>): Promise<MeaningResult> {
    if (!enabled) return { skipped: 'Recall by meaning is off for this world.' }
    if (!connection) return { skipped: 'No embedding model is selected.' }
    if (!text.trim()) return { skipped: 'There is no recent conversation to compare yet.' }
    if (!crypto.subtle) return { skipped: 'Recall by meaning needs HTTPS or a browser on localhost.' }
    const signal = AbortSignal.timeout(2500)
    let queryVector: number[] | undefined
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(connection.key + text))
      const key = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
      let cached = this.queries.get(key)
      const dims = connection.dimensions?.()
      if (cached && (cached.expires < Date.now() || (dims && cached.dims && dims !== cached.dims))) { this.queries.delete(key); cached = undefined }
      if (!cached) {
        const entry: { expires: number; dims?: number; value: Promise<number[]> } = { expires: Infinity, value: withinReplyDeadline(connection.embed([text], signal), signal).then((rows) => { entry.dims = rows[0].length; return rows[0] }) }
        // Keep a failed query briefly too: Inspector/retries don't spam an unavailable service.
        entry.value.catch(() => { entry.expires = Date.now() + 30_000 })
        this.queries.set(key, entry)
        while (this.queries.size > 32) this.queries.delete(this.queries.keys().next().value!)
        cached = entry
      }
      const vector = await withinReplyDeadline(cached.value, signal)
      queryVector = vector
      const scores = await withinReplyDeadline(score(connection.model, vector, signal), signal)
      if (!Object.keys(scores).length) return { queryVector: vector, skipped: 'No current indexed memories are available for this speaker.' }
      return { queryVector: vector, similarities: new Map(Object.entries(scores)) }
    } catch { return { ...(queryVector ? { queryVector } : {}), skipped: 'The embedding service or meaning search could not answer. Ordinary recall was used.' } }
  }
  clear() { this.queries.clear() }
}
