import { expect, it } from 'vitest'
import type { ExplorerConnection, ExplorerMemory, ExplorerSubject } from './explorer'
import { MEMORY_MAP_LIMITS, SELF_HUB, memoryMap } from './memoryMap'

const memory = (id: string, about: string[] = [], extra: Partial<ExplorerMemory> = {}): ExplorerMemory => ({
  id, chatId: 'scene', text: `Mara remembers ${id}.`, kind: 'event', witnesses: ['mara'], knownBy: ['mara'], about, importance: 0.5,
  origin: 'manual', active: true, createdAt: 1, status: 'active', recall: { count: 0, lastAt: 0 }, ...extra,
})
const subjectsOf = (memories: ExplorerMemory[]): ExplorerSubject[] => {
  const people = [...new Set(memories.flatMap((m) => m.about ?? []))]
  return people.map((id) => ({ key: `person:${id}`, kind: 'person', id, memoryIds: memories.filter((m) => m.about?.includes(id)).map((m) => m.id), linkIds: [] }))
}
const map = (memories: ExplorerMemory[], extra: { connections?: ExplorerConnection[]; showRetired?: boolean } = {}) =>
  memoryMap({ memories, subjects: subjectsOf(memories), connections: extra.connections ?? [], characterId: 'mara', label: (s) => s.id, selfLabel: 'Mara', showRetired: extra.showRetired })

it('puts people on the ring, never the character, and gathers memories about no one else at "Just Mara"', () => {
  const layout = map([memory('a', ['tavi']), memory('b', ['mara', 'tavi']), memory('c', ['mara']), memory('d')])
  expect(layout.hubs.map((h) => h.key)).toEqual(['person:tavi', SELF_HUB])
  expect(layout.hubs.find((h) => h.key === SELF_HUB)).toMatchObject({ label: 'Just Mara', memoryIds: ['c', 'd'] })
  expect(layout.dots.find((d) => d.id === 'b')!.hubKeys).toEqual(['person:tavi'])
})

it('draws a memory about two people between them, and is the same every time', () => {
  const memories = [
    ...Array.from({ length: 6 }, (_, i) => memory(`tavi-${i}`, ['tavi'])),
    ...Array.from({ length: 6 }, (_, i) => memory(`bram-${i}`, ['bram'])),
    ...Array.from({ length: 6 }, (_, i) => memory(`orla-${i}`, ['orla'])),
    memory('both', ['tavi', 'bram']),
  ]
  const layout = map(memories)
  expect(map(memories)).toEqual(layout)
  const hub = (id: string) => layout.hubs.find((h) => h.key === `person:${id}`)!
  const dot = layout.dots.find((d) => d.id === 'both')!
  const mid = { x: (hub('tavi').x + hub('bram').x) / 2, y: (hub('tavi').y + hub('bram').y) / 2 }
  const span = Math.hypot(hub('tavi').x - hub('bram').x, hub('tavi').y - hub('bram').y)
  expect(Math.hypot(dot.x - mid.x, dot.y - mid.y)).toBeLessThan(span / 4)
  // A one-person memory stays nearer its own person than anyone else.
  const own = layout.dots.find((d) => d.id === 'orla-0')!
  const distance = (id: string) => Math.hypot(own.x - hub(id).x, own.y - hub(id).y)
  expect(distance('orla')).toBeLessThan(Math.min(distance('tavi'), distance('bram')))
})

it('keeps dots apart and inside the drawing', () => {
  const layout = map(Array.from({ length: 120 }, (_, i) => memory(String(i), [['tavi', 'bram', 'orla'][i % 3]])))
  for (const d of layout.dots) {
    expect(d.x).toBeGreaterThanOrEqual(0); expect(d.x).toBeLessThanOrEqual(layout.size)
    expect(d.y).toBeGreaterThanOrEqual(0); expect(d.y).toBeLessThanOrEqual(layout.size)
  }
  const close = layout.dots.filter((a, i) => layout.dots.some((b, j) => j > i && Math.hypot(a.x - b.x, a.y - b.y) < MEMORY_MAP_LIMITS.dotRadius))
  expect(close.length).toBeLessThan(layout.dots.length / 20)
})

it('hides journals and, unless asked, retired memories; caps the hubs and the dots', () => {
  const layout = map([memory('j', ['tavi'], { kind: 'journal' }), memory('old', ['tavi'], { status: 'retired', active: false }), memory('now', ['tavi'])])
  expect(layout.dots.map((d) => d.id)).toEqual(['now'])
  expect(map([memory('old', ['tavi'], { status: 'retired', active: false })], { showRetired: true }).dots).toHaveLength(1)
  const crowd = Array.from({ length: 20 }, (_, i) => memory(`p${i}`, [`person-${i}`], { createdAt: i }))
  const crowded = map(crowd)
  expect(crowded.hubs.filter((h) => h.kind === 'person')).toHaveLength(MEMORY_MAP_LIMITS.hubs)
  expect(crowded.hubs.find((h) => h.kind === 'others')!.memoryIds).toHaveLength(20 - MEMORY_MAP_LIMITS.hubs)
  expect(map(Array.from({ length: MEMORY_MAP_LIMITS.dots + 5 }, (_, i) => memory(String(i), [], { createdAt: i }))).dots).toHaveLength(MEMORY_MAP_LIMITS.dots)
})

it('draws connections between people on the map, preferring an open one over an ended duplicate', () => {
  const link = (id: string, validTo: number | null): ExplorerConnection => ({ id, memoryId: 'a', fromKind: 'person', fromId: 'tavi', relation: 'owes', toKind: 'person', toId: 'bram',
    validFrom: 0, validTo, closedByMessageId: null, createdAt: 0, effectiveWeight: 1, startedScene: 'The quay' })
  const memories = [memory('a', ['tavi']), memory('b', ['bram'])]
  expect(map(memories, { connections: [link('l1', 5), link('l2', null)] }).edges).toEqual([{ key: 'person:tavi|owes|person:bram', from: 'person:tavi', to: 'person:bram', relation: 'owes', open: true }])
  expect(map(memories, { connections: [{ ...link('l3', null), toId: 'stranger' }] }).edges).toEqual([])
})
