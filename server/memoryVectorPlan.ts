import { createHash } from 'node:crypto'
import type { CharacterMemory } from '../src/lib/types.ts'
import { memoriesKnownBy } from '../src/lib/memory/rank.ts'
import { cosine } from '../src/lib/memory/vector.ts'
import { memoryAsSeenFrom } from './memoryPlan.ts'

export const memoryTextHash = (model: string, text: string) => createHash('sha256').update(model + text).digest('hex')
export interface MemoryVector { model: string; textHash: string; vector: Float32Array }

/** Filter branch, knowledge and live/folded state before even looking up a vector. */
export function memorySimilarities(memories: CharacterMemory[], chain: Set<string>, characterId: string, model: string,
  query: Float32Array, getVector: (id: string) => MemoryVector | undefined): Record<string, number> {
  const candidates = memoriesKnownBy(memories.filter((m) => chain.has(m.chatId)).map((m) => memoryAsSeenFrom(m, chain)), characterId)
  const scores: Record<string, number> = {}
  for (const memory of candidates) {
    const stored = getVector(memory.id)
    if (!stored || stored.model !== model || stored.textHash !== memoryTextHash(model, memory.text) || stored.vector.length !== query.length) continue
    scores[memory.id] = cosine(query, stored.vector)
  }
  return scores
}
