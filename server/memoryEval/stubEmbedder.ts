import table from './fixtures/stub/concepts.json'
import { normalizeVector } from '../../src/lib/memory/vector'

/** Deliberately synthetic concept vectors: proves the pipeline, never real-world quality. */
export function stubEmbedding(text: string): Float32Array {
  const lower = text.toLowerCase()
  const values = table.concepts.map((c) => Number(c.phrases.some((phrase) => lower.includes(phrase))))
  values.push(Number(values.every((v) => v === 0)))
  return normalizeVector(values)
}
