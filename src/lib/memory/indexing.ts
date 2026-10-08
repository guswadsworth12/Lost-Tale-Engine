import type { EmbeddingConnection } from './meaningRecall'

export interface MissingVectors { total: number; missing: { memoryId: string; text: string; textHash: string }[] }
export interface VectorUpload { memoryId: string; model: string; dims: number; textHash: string; vector: number[] }

/** One throttled background step. Recheck pause/cancel after every asynchronous boundary. */
export async function indexMemoryBatch(enabled: boolean, connection: EmbeddingConnection | undefined, signal: AbortSignal,
  paused: () => boolean, missing: () => Promise<MissingVectors>, put: (rows: VectorUpload[]) => Promise<void>) {
  if (!enabled || !connection || paused() || signal.aborted) return undefined
  const batch = await missing()
  if (!batch.missing.length || paused() || signal.aborted) return { indexed: 0, remaining: batch.total }
  const rows = batch.missing.slice(0, 32)
  const vectors = await connection.embed(rows.map((r) => r.text), signal)
  if (paused() || signal.aborted) return undefined
  if (vectors.length !== rows.length) throw new Error('Incomplete embedding batch.')
  await put(rows.map((row, i) => ({ ...row, model: connection.model, dims: vectors[i].length, vector: vectors[i] })))
  return { indexed: rows.length, remaining: Math.max(0, batch.total - rows.length) }
}
