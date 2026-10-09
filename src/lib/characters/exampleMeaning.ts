import type { EmbeddingConnection } from '../memory/meaningRecall'
import { cosine, normalizeVector } from '../memory/vector'
import type { ExampleBankEntry } from './exampleBank'

/**
 * Session-only entry vectors, keyed by connection and exact text hash; no story data is persisted.
 * Entries are embedded in the background, never inside a reply's deadline: a reply uses meaning
 * only once every enabled entry has a vector, and situations alone until then. A failed batch is
 * retried after a short pause instead of being remembered as failed for the whole session.
 */
export class ExampleMeaning {
  private ready = new Map<string, Float32Array>()
  private pending = new Set<string>()
  private failedUntil = new Map<string, number>()
  private inFlight = new Set<Promise<void>>()
  constructor(private now: () => number = () => Date.now(), private retryMs = 30_000, private timeoutMs = 15_000) {}

  async similarities(enabled: boolean, connection: EmbeddingConnection | undefined, query: number[] | undefined, bank: readonly ExampleBankEntry[]): Promise<ReadonlyMap<string, number> | undefined> {
    if (!enabled || !connection || !query || !bank.some((e) => e.enabled) || !crypto.subtle) return undefined
    try {
      const entries = await Promise.all(bank.filter((e) => e.enabled).map(async (entry) => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(connection.key + '\n' + entry.text))
        return { entry, key: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('') }
      }))
      const now = this.now()
      const missing = [...new Map(entries.filter(({ key }) => !this.ready.has(key) && !this.pending.has(key) && (this.failedUntil.get(key) ?? 0) <= now)
        .map((e) => [e.key, e])).values()]
      if (missing.length) this.embedInBackground(connection, missing)
      if (!entries.every(({ key }) => this.ready.has(key))) return undefined
      const normalizedQuery = normalizeVector(query)
      return new Map(entries.map(({ entry, key }) => [entry.id, cosine(normalizedQuery, this.ready.get(key)!)] as const))
    } catch { return undefined }
  }

  /** Settles once current background embedding finishes (tests and previews). */
  async idle(): Promise<void> { await Promise.all([...this.inFlight]) }

  private embedInBackground(connection: EmbeddingConnection, missing: { entry: ExampleBankEntry; key: string }[]): void {
    for (const { key } of missing) this.pending.add(key)
    const fail = () => { const until = this.now() + this.retryMs; for (const { key } of missing) this.failedUntil.set(key, until) }
    const job: Promise<void> = connection.embed(missing.map(({ entry }) => entry.text), AbortSignal.timeout(this.timeoutMs)).then((rows) => {
      if (rows.length !== missing.length) return fail()
      missing.forEach(({ key }, index) => {
        try { this.ready.set(key, normalizeVector(rows[index])); this.failedUntil.delete(key) }
        catch { this.failedUntil.set(key, this.now() + this.retryMs) }
      })
    }, fail).finally(() => { for (const { key } of missing) this.pending.delete(key); this.inFlight.delete(job) })
    this.inFlight.add(job)
  }
}
export const exampleMeaning = new ExampleMeaning()

/** Record only successfully sent turns, so Inspector previews/retries don't consume examples. */
export class ExampleHistory {
  private previous = new Map<string, readonly string[]>()
  ids(chatId: string, speakerId: string, messageId?: string): readonly string[] { return messageId ? this.previous.get(`${chatId}|${speakerId}|${messageId}`) ?? [] : [] }
  record(chatId: string, speakerId: string, messageId: string, ids: readonly string[]): void { this.previous.set(`${chatId}|${speakerId}|${messageId}`, [...ids]) }
}
export const exampleHistory = new ExampleHistory()

/** Streaming placeholders and failed replies are not previous successful turns. */
export function previousExampleTurn(messages: readonly { id: string; role: string; text: string; failed?: boolean; speakerId?: string }[], speakerId: string, primaryId: string): string | undefined {
  return [...messages].reverse().find((m) => m.role === 'char' && m.text.trim() && !m.failed && (m.speakerId ?? primaryId) === speakerId)?.id
}
