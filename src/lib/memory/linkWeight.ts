import type { MemoryLink } from './links.ts'
export const LINK_WEIGHT = { increment: 0.1, cap: 2, halfLifeMs: 60 * 86400_000 } as const
/** New links age from creation; legacy links without a timestamp start at full strength. Decay is never saved. */
export function effectiveLinkWeight(link: Pick<MemoryLink, 'weight' | 'lastUsedAt'>, now: number): number {
  const weight = typeof link.weight === 'number' && Number.isFinite(link.weight) ? Math.max(0, link.weight) : 1
  const age = typeof link.lastUsedAt === 'number' && Number.isFinite(link.lastUsedAt) ? Math.max(0, now - link.lastUsedAt) : 0
  return weight * Math.pow(0.5, age / LINK_WEIGHT.halfLifeMs)
}
