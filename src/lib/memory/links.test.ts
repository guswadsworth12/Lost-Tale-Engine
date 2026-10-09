import fs from 'node:fs'
import { expect, it } from 'vitest'
import { buildScribePrompt, parseScribeResponse, type ScribeInput } from './scribe'
import { selectMemoriesExplained, DEEP_MEMORY_WEIGHTS } from './rank'
import { replacementFor, type MemoryLink } from './links'
import type { CharacterMemory } from '../types'

const input: ScribeInput = { playerName: 'Ash', cast: [{ id: 'ash', name: 'Ash' }], messages: [{ n: 1, id: 'message', name: 'Ash', text: 'Ash kept the key.', witnessIds: ['ash'] }], existing: [] }
it('keeps the module-off scribe prompt byte-identical to the pre-Phase-3 snapshot', () => {
  const before = fs.readFileSync(new URL('./fixtures/scribe-module-off.txt', import.meta.url), 'utf8')
  expect(buildScribePrompt(input)).toBe(before)
  expect(buildScribePrompt({ ...input, deepMemory: false })).toBe(before)
  expect(buildScribePrompt({ ...input, deepMemory: true })).toContain('"links"')
  expect(buildScribePrompt({ ...input, deepMemory: true })).toContain('"from":{"person":"Name"}')
})
it('strictly parses explicit kinds and cast names, drops unknown shapes/relations, and caps links', () => {
  const valid = { from: { person: 'Ash' }, relation: 'keeps', to: { thing: ' Brass Key ' } }
  const invalid = [
    { ...valid, from: 'Ash' }, { ...valid, from: { person: 'Unknown' } },
    { ...valid, to: { object: 'key' } }, { ...valid, relation: 'supersedes' },
    { ...valid, relation: 'befriends' }, { ...valid, from: { person: 'Ash', place: 'quay' } },
    { ...valid, to: { thing: 'a'.repeat(61) } }, { ...valid, surprise: true },
  ]
  const links = [...invalid, valid, { ...valid, relation: 'lives at', to: { place: '  Ferry   Landing ' } }, { ...valid, relation: 'promised' }, { ...valid, relation: 'protects' }]
  const raw = JSON.stringify({ add: [{ from: 1, text: 'A durable key promise.', links }] })
  expect(parseScribeResponse(raw, input).add[0]).not.toHaveProperty('links')
  const add = parseScribeResponse(raw, { ...input, deepMemory: true }).add[0]
  expect(add.links).toHaveLength(3)
  expect(add.links?.[0]).toMatchObject({ fromKind: 'person', fromId: 'ash', toKind: 'thing', toId: 'brass key' })
  expect(add.links?.[1].toId).toBe('ferry landing')
  const batch = parseScribeResponse(JSON.stringify({ add: Array.from({ length: 20 }, (_, i) => ({ from: 1, text: `Remembered discovery ${i}.`, links })) }), { ...input, maxNew: 20, deepMemory: true })
  expect(batch.add.flatMap((a) => a.links ?? [])).toHaveLength(30)
})
const link = (fromId: string, toId: string, extra: Partial<MemoryLink> = {}): MemoryLink => ({ id: `${fromId}-${toId}`, memoryId: 'edge', fromKind: 'person', fromId, relation: 'works with', toKind: 'person', toId, validFrom: 0, validTo: null, closedByMessageId: null, createdAt: 0, ...extra })
const memory = (id: string, extra: Partial<CharacterMemory> = {}): CharacterMemory => ({ id, chatId: 'scene', text: `A remembered event ${id}.`, kind: 'event', active: true, witnesses: ['speaker'], knownBy: ['speaker'], importance: 0.5, createdAt: 1, origin: 'manual', ...extra })
it('expands only one step from visible open links and witnessed introductions, with display names', () => {
  const edge = memory('edge', { links: [link('seed', 'neighbour'), link('neighbour', 'second')] })
  const target = memory('target', { about: ['neighbour'] }), second = memory('second', { about: ['second'] })
  const opts = { characterId: 'speaker', presentIds: ['seed'], recentText: '', deep: { now: 100, nameOf: (id: string) => id === 'neighbour' ? 'Mara' : id } }
  const picks = selectMemoriesExplained([edge, target, second], opts)
  expect(picks.find((p) => p.memory.id === 'target')?.reasons.linkedThrough).toEqual(['Mara'])
  expect(picks.find((p) => p.memory.id === 'second')?.reasons.linkedThrough).toEqual([])
  const normal = selectMemoriesExplained([edge, target, second], { ...opts, deep: undefined })
  expect(picks.find((p) => p.memory.id === 'target')!.reasons.score - normal.find((p) => p.memory.id === 'target')!.reasons.score).toBeCloseTo(DEEP_MEMORY_WEIGHTS.linked)
  for (const hidden of [memory('edge', { ...edge, knownBy: ['other'] }), memory('edge', { ...edge, active: false }), memory('edge', { ...edge, consolidatedFor: ['speaker'] }), memory('edge', { links: [link('seed', 'neighbour', { validTo: 10 })] })]) {
    expect(selectMemoriesExplained([hidden, target], opts).find((p) => p.memory.id === 'target')?.reasons.linkedThrough).toEqual([])
  }
  const intro = { newcomerId: 'seed', personId: 'neighbour', byId: 'host', messageId: 'intro', at: 1, witnessIds: ['speaker'] }
  expect(selectMemoriesExplained([target], { ...opts, deep: { ...opts.deep, introductions: [intro] } })[0].reasons.linkedThrough).toEqual(['Mara'])
  expect(selectMemoriesExplained([target], { ...opts, deep: { ...opts.deep, introductions: [{ ...intro, witnessIds: ['other'] }] } })[0].reasons.linkedThrough).toEqual([])
  const place = memory('place', { links: [link('quay', 'neighbour', { fromKind: 'place' })] })
  expect(selectMemoriesExplained([place, target], { ...opts, presentIds: [], deep: { ...opts.deep, location: '  QUAY ' } }).find((p) => p.memory.id === 'target')?.reasons.linkedThrough).toEqual(['Mara'])
})
it('chooses the replacement with most shared about people and link entities, or none', () => {
  const old = memory('old', { about: ['seed'], links: [link('seed', 'neighbour')] })
  const best = memory('best', { about: ['seed'], links: [link('seed', 'neighbour')] })
  expect(replacementFor(old, [memory('none'), memory('less', { about: ['seed'] }), best])?.id).toBe('best')
  expect(replacementFor(old, [memory('none')])).toBeUndefined()
})

it('does not expand through an absent player or change aboutPresent when the player links to everyone', () => {
  const edge = memory('edge', { about: ['player'], links: [link('player', 'neighbour'), link('player', 'second')] })
  const target = memory('target', { about: ['neighbour'] })
  const opts = { characterId: 'speaker', presentIds: ['speaker'], recentText: '', deep: { now: 100 } }
  for (const pick of selectMemoriesExplained([edge, target], opts)) {
    expect(pick.reasons.linkedThrough).toEqual([])
    expect(pick.reasons.aboutPresent).toEqual([])
  }
  expect(selectMemoriesExplained([edge, target], { ...opts, presentIds: ['player'] }).find((p) => p.memory.id === 'target')?.reasons.linkedThrough).toEqual(['neighbour'])
})
