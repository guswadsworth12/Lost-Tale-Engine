import type { EmbeddingConnection } from '../memory/meaningRecall'
import { cosine, normalizeVector } from '../memory/vector'
import type { ExampleBankEntry } from './exampleBank'

/** Session-only entry vectors, keyed by connection and exact text hash; no story data is persisted. */
export class ExampleMeaning {
  private vectors = new Map<string, Promise<Float32Array>>()
  async similarities(enabled: boolean, connection: EmbeddingConnection | undefined, query: number[] | undefined, bank: readonly ExampleBankEntry[]): Promise<ReadonlyMap<string, number> | undefined> {
    if (!enabled || !connection || !query || !bank.some((e) => e.enabled) || !crypto.subtle) return undefined
    const signal = AbortSignal.timeout(2500)
    try {
      const entries = await Promise.all(bank.filter((e) => e.enabled).map(async (entry) => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(connection.key + '\n' + entry.text))
        return { entry, key: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('') }
      }))
      const missing = [...new Map(entries.filter(({ key }) => !this.vectors.has(key)).map((e) => [e.key, e])).values()]
      if (missing.length) {
        const batch = connection.embed(missing.map(({ entry }) => entry.text), signal)
        missing.forEach(({ key }, index) => {
          const vector = batch.then((rows) => normalizeVector(rows[index]))
          vector.catch(() => {}) // Failed entries are cached too; retries never spam a failing service.
          this.vectors.set(key, vector)
        })
      }
      const normalizedQuery = normalizeVector(query)
      const scores = Promise.all(entries.map(async ({ entry, key }) => [entry.id, cosine(normalizedQuery, await this.vectors.get(key)!)] as const))
      return await new Promise((resolve) => {
        const abort = () => resolve(undefined)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
        scores.then((rows) => resolve(new Map(rows)), () => resolve(undefined)).finally(() => signal.removeEventListener('abort', abort))
      })
    } catch { return undefined }
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
