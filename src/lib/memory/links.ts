import { placeKey } from './rank.ts'
import type { CharacterMemory } from '../types.ts'

export const LINK_RELATIONS = ['introduced', 'owes', 'promised', 'related to', 'works with', 'rivals', 'loves', 'mentors', 'protects', 'lives at', 'keeps', 'happened at'] as const
export type EntityKind = 'person' | 'place' | 'thing'
export interface MemoryLinkInput {
  fromKind: EntityKind
  fromId: string
  relation: typeof LINK_RELATIONS[number]
  toKind: EntityKind
  toId: string
}
export interface MemoryLink {
  closedBy?: 'player'
  weight?: number | null
  lastUsedAt?: number | null
  sourceMessageId?: string
  id: string; memoryId: string
  fromKind: EntityKind | 'memory'; fromId: string
  relation: MemoryLinkInput['relation'] | 'supersedes'
  toKind: EntityKind | 'memory'; toId: string
  validFrom: number; validTo: number | null; closedByMessageId: string | null; createdAt: number
}
export function linkEntity(kind: unknown, value: unknown, person: (name: string) => string | undefined): { kind: EntityKind; id: string } | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined
  if (kind === 'person') { const id = person(value); return id ? { kind, id } : undefined }
  if (kind === 'place') { const id = placeKey(value); return id.length <= 200 ? { kind, id } : undefined }
  if (kind === 'thing') { const id = value.trim().toLowerCase(); return id.length <= 60 ? { kind, id } : undefined }
}
/** The server accepts only flat entity fields, never model-written ids or temporal/supersedes fields. */
export function normalizeLink(raw: unknown, person: (id: string) => string | undefined): MemoryLinkInput | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  if (Object.keys(r).some((k) => !['fromKind', 'fromId', 'relation', 'toKind', 'toId'].includes(k)) || !(LINK_RELATIONS as readonly unknown[]).includes(r.relation)) return undefined
  const from = linkEntity(r.fromKind, r.fromId, person), to = linkEntity(r.toKind, r.toId, person)
  return from && to ? { fromKind: from.kind, fromId: from.id, relation: r.relation as MemoryLinkInput['relation'], toKind: to.kind, toId: to.id } : undefined
}
/** Deterministic, conservative replacement: shared people or link entities, never text guessing. */
export function replacementFor(old: CharacterMemory, additions: CharacterMemory[]): CharacterMemory | undefined {
  const entities = (m: CharacterMemory) => new Set((m.links ?? []).flatMap((l) => [`${l.fromKind}:${l.fromId}`, `${l.toKind}:${l.toId}`]))
  const oldEntities = entities(old), about = new Set(old.about)
  let best: CharacterMemory | undefined, high = 0
  for (const candidate of additions) {
    const score = (candidate.about ?? []).filter((id) => about.has(id)).length + [...entities(candidate)].filter((id) => oldEntities.has(id)).length
    if (score > high) { high = score; best = candidate }
  }
  return best
}
