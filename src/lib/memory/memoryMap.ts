import type { ExplorerConnection, ExplorerMemory, ExplorerSubject } from './explorer'

/**
 * The memory map: the people, places and things a character's memories involve are hubs on a
 * ring, and each memory is a dot drawn toward every hub it involves, so a memory about two people
 * sits between them. Pure and deterministic (no randomness), so the same memories always land in
 * the same places. Privacy is already settled by the explorer route that supplies the data.
 */

export type MapHubKind = 'person' | 'place' | 'thing' | 'self' | 'others'
export interface MapHub { key: string; kind: MapHubKind; label: string; x: number; y: number; r: number; memoryIds: string[] }
export interface MapDot { id: string; x: number; y: number; r: number; hubKeys: string[]; memory: ExplorerMemory }
export interface MapEdge { key: string; from: string; to: string; relation: string; open: boolean }
export interface MemoryMapLayout {
  /** Width and height of the drawing; the centre is (size / 2, size / 2). */
  size: number
  hubs: MapHub[]
  dots: MapDot[]
  edges: MapEdge[]
}

export const MEMORY_MAP_LIMITS = { hubs: 14, dots: 400, dotRadius: 6 } as const
export const SELF_HUB = 'self'
export const OTHERS_HUB = 'others'

export interface MemoryMapInput {
  memories: ExplorerMemory[]
  subjects: ExplorerSubject[]
  connections: ExplorerConnection[]
  characterId: string
  label: (subject: ExplorerSubject) => string
  selfLabel: string
  showRetired?: boolean
}

/** A stable number in [0, 1) from a string, used instead of randomness. */
function unit(text: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return ((h >>> 0) % 10007) / 10007
}

type Placed = MapDot & { tx: number; ty: number }

export function memoryMap(input: MemoryMapInput): MemoryMapLayout {
  const r = MEMORY_MAP_LIMITS.dotRadius
  const memories = input.memories
    .filter((m) => m.kind !== 'journal' && (input.showRetired || m.status !== 'retired'))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MEMORY_MAP_LIMITS.dots)
  const visible = new Set(memories.map((m) => m.id))

  // Hubs: the subjects with the most memories, never the character themself.
  const subjects = input.subjects
    .filter((s) => !(s.kind === 'person' && s.id === input.characterId))
    .map((s) => ({ subject: s, ids: s.memoryIds.filter((id) => visible.has(id)) }))
    .filter((s) => s.ids.length)
    .sort((a, b) => b.ids.length - a.ids.length || a.subject.key.localeCompare(b.subject.key))
  const shown = subjects.slice(0, MEMORY_MAP_LIMITS.hubs)
  const hubsOf = new Map<string, string[]>()
  for (const { subject, ids } of shown) for (const id of ids) hubsOf.set(id, [...(hubsOf.get(id) ?? []), subject.key])
  // Memories whose only subjects didn't make the cut gather at "Others"; the rest involve no one else.
  const cut = new Set(subjects.slice(MEMORY_MAP_LIMITS.hubs).flatMap((s) => s.ids))
  const others = memories.filter((m) => !hubsOf.has(m.id) && cut.has(m.id)).map((m) => m.id)
  const alone = memories.filter((m) => !hubsOf.has(m.id) && !cut.has(m.id)).map((m) => m.id)
  const extra: { key: string; kind: MapHubKind; label: string; ids: string[] }[] = []
  if (others.length) extra.push({ key: OTHERS_HUB, kind: 'others', label: 'Others', ids: others })
  if (alone.length) extra.push({ key: SELF_HUB, kind: 'self', label: `Just ${input.selfLabel}`, ids: alone })
  for (const hub of extra) for (const id of hub.ids) hubsOf.set(id, [hub.key])

  const raw = [
    ...shown.map(({ subject, ids }) => ({ key: subject.key, kind: subject.kind as MapHubKind, label: input.label(subject), ids })),
    ...extra,
  ]

  // Order the ring so hubs that share memories sit next to each other.
  const sharedCount = new Map<string, number>()
  for (const keys of hubsOf.values()) for (const a of keys) for (const b of keys) if (a < b) sharedCount.set(`${a}|${b}`, (sharedCount.get(`${a}|${b}`) ?? 0) + 1)
  const shared = (a: string, b: string) => sharedCount.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0
  const order = raw.slice(0, 1)
  const rest = raw.slice(1)
  while (rest.length) {
    const last = order[order.length - 1].key
    let best = 0
    for (let i = 1; i < rest.length; i++) if (shared(last, rest[i].key) > shared(last, rest[best].key)) best = i
    order.push(...rest.splice(best, 1))
  }

  const ring = Math.max(240, Math.sqrt((memories.length * (2.8 * r) ** 2) / Math.PI) * 1.5)
  // Room outside the ring for the hub labels.
  const margin = 150
  const size = Math.round(2 * (ring + margin))
  const c = size / 2
  const hubs: MapHub[] = order.map((h, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / order.length
    const onRing = order.length > 1
    return {
      key: h.key, kind: h.kind, label: h.label, memoryIds: h.ids, r: 12 + Math.sqrt(h.ids.length) * 2.5,
      x: onRing ? c + ring * Math.cos(angle) : c, y: onRing ? c + ring * Math.sin(angle) : c,
    }
  })
  const hubAt = new Map(hubs.map((h) => [h.key, h]))

  // Each dot aims for the middle of its hubs; a dot with one hub gathers just inside it.
  const dots: Placed[] = memories.map((m) => {
    const keys = hubsOf.get(m.id) ?? []
    const own = keys.flatMap((k) => hubAt.get(k) ?? [])
    let tx = c, ty = c
    if (own.length === 1) {
      const h = own[0], dx = c - h.x, dy = c - h.y, d = Math.hypot(dx, dy), pull = h.r + 6 * r
      const angle = unit(m.id) * 2 * Math.PI
      tx = d ? h.x + (dx / d) * pull : h.x + pull * Math.cos(angle)
      ty = d ? h.y + (dy / d) * pull : h.y + pull * Math.sin(angle)
    } else if (own.length > 1) {
      tx = own.reduce((s, h) => s + h.x, 0) / own.length
      ty = own.reduce((s, h) => s + h.y, 0) / own.length
    }
    const jitter = 3 * r
    return {
      id: m.id, hubKeys: keys, memory: m, r: r * (0.75 + 0.6 * Math.min(1, Math.max(0, m.importance ?? 0.5))),
      x: tx + (unit(m.id, 1) - 0.5) * jitter, y: ty + (unit(m.id, 2) - 0.5) * jitter, tx, ty,
    }
  })

  // Settle: dots push apart, keep clear of hubs, and drift back toward their aim.
  const gap = 2.6 * r
  for (let step = 0; step < 90; step++) {
    for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) {
      const a = dots[i], b = dots[j]
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy)
      if (d >= gap) continue
      const push = (gap - d) / 2
      const ux = d ? dx / d : unit(a.id + b.id) - 0.5, uy = d ? dy / d : unit(b.id + a.id) - 0.5
      a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push
    }
    for (const dot of dots) {
      dot.x += (dot.tx - dot.x) * 0.04
      dot.y += (dot.ty - dot.y) * 0.04
      for (const h of hubs) {
        const dx = dot.x - h.x, dy = dot.y - h.y, d = Math.hypot(dx, dy), min = h.r + 1.8 * r
        if (d >= min) continue
        if (d) { dot.x += (dx / d) * (min - d); dot.y += (dy / d) * (min - d) } else dot.y += min
      }
      dot.x = Math.min(size - r, Math.max(r, dot.x))
      dot.y = Math.min(size - r, Math.max(r, dot.y))
    }
  }

  // Connections between two hubs, from Deep Memory; an open one wins over a closed duplicate.
  const edges = new Map<string, MapEdge>()
  for (const l of input.connections) {
    if (l.fromKind === 'memory' || l.toKind === 'memory' || l.relation === 'supersedes') continue
    const from = `${l.fromKind}:${l.fromId}`, to = `${l.toKind}:${l.toId}`
    if (!hubAt.has(from) || !hubAt.has(to) || from === to) continue
    const key = `${from}|${l.relation}|${to}`
    if (!edges.get(key)?.open) edges.set(key, { key, from, to, relation: l.relation, open: l.validTo === null })
  }

  return {
    size,
    hubs,
    dots: dots.map(({ id, x, y, r: radius, hubKeys, memory }) => ({ id, x, y, r: radius, hubKeys, memory })),
    edges: [...edges.values()],
  }
}
