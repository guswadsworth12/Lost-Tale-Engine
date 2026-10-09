import { expect, it } from 'vitest'
import type { CharacterMemory, MemoryRecall } from '../types'
import { pickForJournal, JOURNAL_WEIGHTS } from './journal'
import { effectiveLinkWeight, LINK_WEIGHT } from './linkWeight'
import { selectMemoriesExplained, MEMORY_TOKEN_BUDGET, memoryBlock, memoryPrompt } from './rank'
import { estimateTokens } from '../tokenEstimate'
import { whyLabels } from '../../components/chat/memoryWhy'
import { buildConsolidationPrompt, consolidationMetadata, consolidationAllowed, consolidationClusters, tryParseConsolidation } from './consolidation'
const now = 100 * 86400_000
type RecalledMemory = CharacterMemory & { recall?: MemoryRecall }
const m = (id: string, extra: Partial<RecalledMemory> = {}): RecalledMemory => ({ id, chatId: 'scene', text: `Mara remembers ${id}.`, kind: 'event', witnesses: ['mara'], knownBy: ['mara'], importance: 0.1, origin: 'manual', active: true, createdAt: 1, ...extra })
it('keeps the original journal order off, and weighs feeling and diminishing time-faded recalls on', () => {
  const memories = [m('felt', { feelings: { mara: -1 } }), m('recalled', { recall: { count: 10, lastAt: now } }), m('old'), m('new', { createdAt: now, importance: 0.5 }), m('pinned', { pinned: true }), m('open', { unresolved: true })]
  expect(pickForJournal(memories, 'mara', { keepRecent: 2 }).map((m) => m.id)).toEqual(['recalled', 'old'])
  expect(pickForJournal(memories, 'mara', { keepRecent: 2, deep: { now } }).map((m) => m.id)).toEqual(['old', 'new'])
  const faded = memories.map((m) => m.id === 'recalled' ? { ...m, recall: { count: 10, lastAt: 0 } } : m)
  expect(pickForJournal(faded, 'mara', { keepRecent: 2, deep: { now } }).map((m) => m.id)).toContain('recalled')
  expect(JOURNAL_WEIGHTS).toEqual({ importance: 0.6, recency: 0.4, feeling: 1, recall: 1 })
})
it('scales by the strongest link, caps the boost, labels effective strength, and never mutates links', () => {
  const link = { id: 'link', memoryId: 'edge', fromKind: 'person' as const, fromId: 'present', toKind: 'person' as const, toId: 'mara', relation: 'owes' as const, validFrom: 0, validTo: null, closedByMessageId: null, createdAt: 0, weight: 2, lastUsedAt: now - LINK_WEIGHT.halfLifeMs * 3 }
  const memories = [m('edge', { links: [link] }), m('target', { about: ['mara'] })]
  const opts = { characterId: 'mara', presentIds: ['present'], recentText: '', deep: { now, nameOf: () => 'Mara' } }
  const score = (weight: number) => selectMemoriesExplained([m('edge', { links: [{ ...link, weight }] }), memories[1]], opts).find((p) => p.memory.id === 'target')!
  expect(effectiveLinkWeight({}, now)).toBe(1)
  expect(effectiveLinkWeight(link, now)).toBe(0.25)
  expect(score(2).reasons.score - score(0).reasons.score).toBeCloseTo(0.1)
  expect(score(100).reasons.score - score(0).reasons.score).toBeCloseTo(0.4)
  expect(whyLabels(score(2).reasons, [])).toContain('Linked through Mara (faint)')
  expect(whyLabels(score(100).reasons, [])).toContain('Linked through Mara (strong)')
  expect(memories[0].links).toEqual([link])
})
it('clusters only known, active, settled, unfolded originals with shared entities, and strictly parses all summaries', () => {
  const eligible = Array.from({ length: 3 }, (_, i) => m(`known-${i}`, { location: ' QUAY ' }))
  const excluded = [m('unknown', { knownBy: ['other'], text: 'Hidden vault password.' }), m('pinned', { pinned: true }), m('open', { unresolved: true }), m('inactive', { active: false }), m('folded', { consolidatedFor: ['mara'] })].map((m) => ({ ...m, location: 'quay' }))
  const clusters = consolidationClusters([...eligible, ...excluded], 'mara', now)
  expect(clusters.flat().map((m) => m.id).sort()).toEqual(eligible.map((m) => m.id))
  expect(buildConsolidationPrompt(clusters, 'mara')).not.toContain('Hidden vault password')
  expect(buildConsolidationPrompt([[m('claim', { certainty: 'claim' })]], 'mara')).toContain('Heard, not confirmed')
  expect(consolidationClusters(eligible.slice(0, 2), 'mara', now)).toEqual([])
  expect(consolidationClusters(Array.from({ length: 12 }, (_, i) => m(String(i), { about: [String(Math.floor(i / 3))] })), 'mara', now)).toHaveLength(3)
  for (const raw of ['bad', '{}', '{"summaries":[""]}', '{"summaries":["ok"],"extra":1}', '{"summaries":["a","b"]}', JSON.stringify({ summaries: ['x'.repeat(601)] })]) expect(tryParseConsolidation(raw, 1)).toBeUndefined()
  expect(tryParseConsolidation('{"summaries":["Mara remembers the quay."]}', 1)).toEqual(['Mara remembers the quay.'])
  expect(consolidationAllowed(undefined, [], 'mara', now)).toBe(false)
})
for (const deep of [false, true]) it(`200-memory story folds at 20 scene ends with module ${deep ? 'on' : 'off'} and stays in budget`, () => {
  const story: RecalledMemory[] = []
  for (let scene = 0; scene < 20; scene++) {
    story.push(...Array.from({ length: 10 }, (_, i) => m(`scene-${scene}-${i}`, { chatId: `scene-${scene}`, createdAt: scene * 10 + i, importance: 0.05 })))
    if (!scene) {
      story[0] = { ...story[0], importance: 1 }
      story[1] = { ...story[1], feelings: { mara: -1 } }
      story[2] = { ...story[2], recall: { count: 10, lastAt: now } }
    }
    const folded = new Set(pickForJournal(story, 'mara', deep ? { deep: { now } } : undefined).map((m) => m.id))
    for (const memory of story) if (folded.has(memory.id)) memory.consolidatedFor = ['mara']
  }
  expect(story).toHaveLength(200)
  const selected = selectMemoriesExplained(story, { characterId: 'mara', presentIds: [], recentText: '', ...(deep ? { deep: { now, recalls: new Map(story.flatMap((m) => m.recall ? [[m.id, m.recall] as const] : [])) } } : {}) }).map((p) => p.memory)
  const tokens = estimateTokens(memoryBlock('Mara', selected, m('journal', { kind: 'journal', text: 'Mara spent twenty scenes at the harbor.' }), 'mara'))
  expect(tokens).toBeLessThanOrEqual(MEMORY_TOKEN_BUDGET)
  console.info(`Long story (${deep ? 'on' : 'off'}): 200 memories, 20 scene ends, ${selected.length} individual lines, ${tokens}/350 prompt tokens; salient kept ${story.slice(0, 3).filter((m) => !m.consolidatedFor?.includes('mara')).length}/3.`)
  expect(selected.map((m) => m.id)).toContain('scene-0-0')
  if (deep) expect(selected.map((m) => m.id)).toEqual(expect.arrayContaining(['scene-0-1', 'scene-0-2']))
  else expect(story.slice(1, 3).every((m) => m.consolidatedFor?.includes('mara'))).toBe(true)
})

it('reserves journal space on, keeps the off block byte-identical, and leaves source rows intact', () => {
  const journal = m('journal', { kind: 'journal', text: 'Mara remembers the harbor. '.repeat(55), createdAt: now })
  const memories = [journal, ...Array.from({ length: 30 }, (_, i) => m(String(i), { text: `Mara recalls event ${i}: ` + 'A cargo was carefully stored at the quay. '.repeat(3), importance: i === 0 ? 1 : 0.1, feelings: i === 1 ? { mara: -1 } : undefined }))]
  const opts = { characterId: 'mara', presentIds: [], recentText: '' }
  const off = memoryPrompt(memories, opts, 'Mara')
  expect(off.text).toBe(memoryBlock('Mara', selectMemoriesExplained(memories, opts).map((p) => p.memory), journal, 'mara'))
  const on = memoryPrompt(memories, { ...opts, deep: { now } }, 'Mara')
  expect(estimateTokens(on.text)).toBeLessThanOrEqual(MEMORY_TOKEN_BUDGET)
  expect(on.picks.map((p) => p.memory.id)).toEqual(expect.arrayContaining(['0', '1']))
  expect(on.journal!.text.length).toBeLessThan(journal.text.length)
  expect(memories[0]).toBe(journal)
})

it('groups by one key, excludes the player and speaker, and protects salient originals', () => {
  const playerMemories = Array.from({ length: 12 }, (_, i) => m(`player-${i}`, { about: ['player', 'mara'] }))
  const placeMemories = Array.from({ length: 3 }, (_, i) => m(`place-${i}`, { about: ['player'], location: 'quay' }))
  const protectedMemories = [m('important', { location: 'quay', importance: 0.7 }), m('felt', { location: 'quay', feelings: { mara: -0.5 } }), m('recalled', { location: 'quay', recall: { count: 10, lastAt: now } })]
  expect(consolidationClusters([...playerMemories, ...placeMemories, ...protectedMemories], 'mara', now, ['player'])).toEqual([placeMemories])
  const overlaps = [m('a', { about: ['tavi'], location: 'quay' }), m('b', { about: ['tavi'], location: 'quay' }), m('c', { about: ['tavi'] }), m('d', { location: 'quay' }), m('e', { location: 'quay' })]
  const groups = consolidationClusters(overlaps, 'mara', now)
  expect(groups.map((g) => g.map((m) => m.id))).toEqual([['a', 'b', 'd', 'e']])
})

it('cuts journal excerpts at sentence endings, or adds an ellipsis at a word boundary', () => {
  const opts = { characterId: 'mara', presentIds: [], recentText: '', budgetTokens: 40, deep: { now } }
  const journal = m('j', { kind: 'journal', text: 'unfinished words '.repeat(3) + 'Then it ended. ' + 'more words '.repeat(20) })
  expect(memoryPrompt([journal], opts, 'Mara').journal!.text).toBe('unfinished words '.repeat(3) + 'Then it ended.')
  // A sentence ending too early to keep half the room gives way to a word cut.
  const early = memoryPrompt([m('j', { kind: 'journal', text: 'One complete sentence. ' + 'unfinished words '.repeat(40) })], opts, 'Mara').journal!.text
  expect(early).toMatch(/…$/)
  expect(early.length).toBeGreaterThan(40)
  const noSentence = m('j', { kind: 'journal', text: 'unfinished words '.repeat(40) })
  const result = memoryPrompt([noSentence], opts, 'Mara')
  expect(result.journal!.text).toMatch(/(?:words|unfinished)…$/)
  expect(result.journal!.text.length).toBeLessThanOrEqual(80)
  expect(estimateTokens(result.text)).toBeLessThanOrEqual(40)
  expect(noSentence.text.endsWith('…')).toBe(false)
})

it('preserves summary certainty, promise precedence and recall cues for people and places', () => {
  const originals = [m('a', { kind: 'promise', about: ['mara', 'tavi'], location: 'quay', certainty: 'claim', feelings: { mara: -0.4 } }), m('b', { location: 'quay', certainty: 'belief' }), m('c', { location: 'quay' })]
  const summary = m('summary', { ...consolidationMetadata(originals, 'mara'), origin: 'consolidation', text: 'A harbor undertaking.' })
  expect(summary).toMatchObject({ kind: 'promise', certainty: 'belief', about: ['tavi'], location: 'quay', feelings: { mara: -0.4 } })
  const pick = selectMemoriesExplained([summary], { characterId: 'mara', presentIds: ['tavi'], recentText: '', deep: { now, location: 'quay' } })[0]
  expect(pick.memory.id).toBe('summary')
  expect(pick.reasons).toMatchObject({ samePlace: true, aboutPresent: ['tavi'] })
  expect(buildConsolidationPrompt([[summary]], 'mara')).toContain('Believes')
})
