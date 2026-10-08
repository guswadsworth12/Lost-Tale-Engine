/** Small, dependency-free cosine helpers shared by browser validation and server scoring. */
export const MAX_VECTOR_DIMS = 16384

export function normalizeVector(values: readonly number[]): Float32Array {
  if (!values.length || values.length > MAX_VECTOR_DIMS || values.some((v) => !Number.isFinite(v))) throw new Error('Invalid embedding vector.')
  const length = Math.hypot(...values)
  if (!length || !Number.isFinite(length)) throw new Error('Invalid embedding vector.')
  return Float32Array.from(values, (v) => v / length)
}

/** Inputs are normalized at write/query time. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) throw new Error('Embedding dimensions differ.')
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return Math.max(-1, Math.min(1, dot))
}
