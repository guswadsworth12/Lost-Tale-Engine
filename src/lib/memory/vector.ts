/** Small, dependency-free cosine helpers shared by browser validation and server scoring. */
export const MAX_VECTOR_DIMS = 16384

export function normalizeVector(values: readonly number[]): Float32Array {
  if (!values.length || values.length > MAX_VECTOR_DIMS || values.some((v) => !Number.isFinite(v))) throw new Error('Invalid embedding vector.')
  const length = Math.hypot(...values)
  if (!length || !Number.isFinite(length)) throw new Error('Invalid embedding vector.')
  return Float32Array.from(values, (v) => v / length)
}

// Below this gap between the best and the median score, a "best match" is mostly noise.
const MIN_SIMILARITY_SPREAD = 0.15

/**
 * Raw cosine from real embedding models is bunched (unrelated text often scores 0.4–0.7), so
 * scores are calibrated across the candidates before they count. With five or more, median maps
 * to zero and maximum to one, scaled down when the maximum barely stands out, so noise never
 * crowns a winner; flat distributions add no boost. Small sets use a fixed 0.4 floor, rescaled to
 * 0..1 to avoid amplifying noise. Ids without a finite score calibrate to 0.
 */
export function calibrateSimilarities(ids: readonly string[], scores?: ReadonlyMap<string, number>): Map<string, number> {
  const values = ids.map((id) => scores?.get(id)).filter((v): v is number => v !== undefined && Number.isFinite(v))
    .map((v) => Math.max(0, Math.min(1, v))).sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  const floor = values.length >= 5 ? (values[middle] + values[Math.ceil(values.length / 2) - 1]) / 2 : 0.4
  const ceiling = values.length >= 5 ? values[values.length - 1] : 1
  const confidence = values.length >= 5 ? Math.min(1, (ceiling - floor) / MIN_SIMILARITY_SPREAD) : 1
  return new Map(ids.map((id) => {
    const raw = scores?.get(id)
    return [id, raw !== undefined && Number.isFinite(raw) && ceiling > floor
      ? confidence * Math.max(0, Math.min(1, (raw - floor) / (ceiling - floor))) : 0]
  }))
}

/** Inputs are normalized at write/query time. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('Embedding dimensions differ.')
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return Math.max(-1, Math.min(1, dot))
}
