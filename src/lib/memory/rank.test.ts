import { describe, expect, it } from 'vitest'
import { formatMemoryLine, keywordOverlap, keywords, latestJournal, memoriesKnownBy, memoryBlock, selectMemories, selectMemoriesExplained } from './rank'
import type { CharacterMemory } from '@/lib/types'

let n = 0
function mem(overrides: Partial<CharacterMemory> & { text: string }): CharacterMemory {
  n++
  return {
    id: `mem${String(n).padStart(3, '0')}`,
    chatId: 'c1',
    kind: 'event',
    witnesses: ['ash'],
    knownBy: ['ash'],
    importance: 0.5,
    active: true,
    origin: 'scribe',
    createdAt: n,
    ...overrides,
  }
}

/** Old, unimportant memories so recency differences between the ones under test stay small. */
const fillers = (count: number) => Array.from({ length: count }, (_, i) => mem({ text: `Filler ${i}.`, importance: 0.1, createdAt: i + 1 }))

describe('memoriesKnownBy / latestJournal', () => {
  it('keeps only active, unfolded, non-journal memories the character knows', () => {
    const keep = mem({ text: 'Ash lit the lamp.' })
    const list = [
      keep,
      mem({ text: 'Bea only.', knownBy: ['bea'] }),
      mem({ text: 'Retired.', active: false }),
      mem({ text: 'Folded.', consolidatedFor: ['ash'] }),
      mem({ text: 'Journal.', kind: 'journal' }),
    ]
    expect(memoriesKnownBy(list, 'ash')).toEqual([keep])
  })

  it('keeps a rumor with those who heard it: the rest of the cast never sees it', () => {
    const rumor = mem({ text: 'Cole said that the mayor fled.', certainty: 'claim', witnesses: ['bea', 'cole'], knownBy: ['bea', 'cole'] })
    expect(memoriesKnownBy([rumor], 'bea')).toEqual([rumor])
    expect(memoriesKnownBy([rumor], 'ash')).toEqual([])
    expect(selectMemories([rumor], { characterId: 'ash', presentIds: ['ash', 'bea', 'cole'], recentText: 'the mayor fled' })).toEqual([])
  })

  it('treats consolidation as per character', () => {
    const shared = mem({ text: 'Ash and Bea crossed the river.', knownBy: ['ash', 'bea'], consolidatedFor: ['ash'] })
    expect(memoriesKnownBy([shared], 'ash')).toEqual([])
    expect(memoriesKnownBy([shared], 'bea')).toEqual([shared])
  })

  it('picks the newest active journal of that character', () => {
    const old = mem({ text: 'Old journal.', kind: 'journal', createdAt: 1 })
    const fresh = mem({ text: 'New journal.', kind: 'journal', createdAt: 5 })
    const other = mem({ text: 'Bea journal.', kind: 'journal', knownBy: ['bea'], createdAt: 9 })
    const retired = mem({ text: 'Retired journal.', kind: 'journal', active: false, createdAt: 10 })
    expect(latestJournal([old, fresh, other, retired], 'ash')).toBe(fresh)
    expect(latestJournal([old], 'cole')).toBeUndefined()
  })
})

describe('keywords', () => {
  it('drops stopwords and lightly stems', () => {
    expect([...keywords('The guards were locking the gates')]).toEqual(['guard', 'lock', 'gate'])
    expect(keywordOverlap('Ash broke the gate ward.', keywords('who broke those gates?'))).toBeCloseTo(2 / 4)
  })
})

describe('selectMemories', () => {
  const base = { characterId: 'ash', presentIds: [], recentText: '' }

  it('never returns a memory the character does not know', () => {
    const list = [mem({ text: 'Mine.' }), mem({ text: 'Bea secret.', knownBy: ['bea'], importance: 1 })]
    expect(selectMemories(list, base).map((m) => m.text)).toEqual(['Mine.'])
  })

  it('stops at the token budget', () => {
    const list = Array.from({ length: 30 }, (_, i) => mem({ text: `Memory number ${i} about something that happened on the road north.` }))
    const picked = selectMemories(list, { ...base, budgetTokens: 60 })
    expect(picked.length).toBeGreaterThan(0)
    expect(picked.length).toBeLessThan(30)
    const tokens = picked.reduce((s, m) => s + Math.ceil(`- ${m.text}\n`.length / 4), 0)
    expect(tokens).toBeLessThanOrEqual(60)
  })

  it('puts pinned first and keeps them even over budget, capped at 8', () => {
    const pinned = Array.from({ length: 10 }, (_, i) => mem({ text: `Core memory ${i}, long enough to cost real tokens.`, pinned: true, importance: 0.1 }))
    const loose = mem({ text: 'Important but loose.', importance: 1 })
    const picked = selectMemories([loose, ...pinned], { ...base, budgetTokens: 10 })
    expect(picked).toHaveLength(8)
    expect(picked.every((m) => m.pinned)).toBe(true)

    const roomy = selectMemories([loose, pinned[0]], { ...base, budgetTokens: 500 })
    expect(roomy.map((m) => m.text)).toEqual([pinned[0].text, loose.text])
  })

  it('lets keyword relevance beat a slightly more important unrelated memory', () => {
    const unrelated = mem({ text: 'Cole owes money to the ferryman.', importance: 0.7, createdAt: 20 })
    const relevant = mem({ text: 'Ash broke the east gate ward.', importance: 0.55, createdAt: 19 })
    const list = [...fillers(8), unrelated, relevant]
    const picked = selectMemories(list, { ...base, recentText: 'Who broke the ward on the east gate?' })
    expect(picked[0]).toBe(relevant)
    const noContext = selectMemories(list, base)
    expect(noContext[0]).toBe(unrelated)
  })

  it('ranks memories about someone present higher', () => {
    const bea = mem({ text: 'Bea sang badly.', about: ['bea'], createdAt: 19 })
    const dara = mem({ text: 'Dara laughed at the fire.', about: ['dara'], createdAt: 20 })
    const list = [...fillers(8), bea, dara]
    expect(selectMemories(list, { ...base, presentIds: ['bea'] })[0]).toBe(bea)
    expect(selectMemories(list, { ...base, presentIds: ['dara'] })[0]).toBe(dara)
  })

  it('orders ties deterministically', () => {
    const a = mem({ text: 'Same A.', createdAt: 5 })
    const b = mem({ text: 'Same B.', createdAt: 5 })
    const order1 = selectMemories([a, b], base).map((m) => m.id)
    const order2 = selectMemories([b, a], base).map((m) => m.id)
    expect(order1).toEqual(order2)
  })
})

describe('formatMemoryLine', () => {
  it('reads the same event differently per character', () => {
    const m = mem({ text: 'Ash broke the east gate ward.', knownBy: ['ash', 'bea'], unresolved: true, feelings: { ash: 0.6, bea: -0.7 } })
    expect(formatMemoryLine(m, 'ash')).toBe('Still an open thread: Ash broke the east gate ward. (a warm memory)')
    expect(formatMemoryLine(m, 'bea')).toBe('Still unsettled, not resolved: Ash broke the east gate ward. (it still stings)')
    expect(formatMemoryLine(m, 'cole')).toBe('Still an open thread: Ash broke the east gate ward.')
  })

  it('marks secrets', () => {
    expect(formatMemoryLine(mem({ text: 'Bea hid the key.', kind: 'secret' }), 'ash')).toBe('Kept secret: Bea hid the key.')
    expect(formatMemoryLine(mem({ text: 'Bea hid the key.', kind: 'secret', unresolved: true }), 'ash'))
      .toBe('Kept secret, and still an open thread: Bea hid the key.')
  })

  it('leaves a resolved promise plain', () => {
    expect(formatMemoryLine(mem({ text: 'Cole promised to return.', kind: 'promise' }), 'ash')).toBe('Cole promised to return.')
  })

  it('marks a claim as heard and a belief as believed, for every knower', () => {
    const claim = mem({ text: 'Cole said that the mayor fled the city.', certainty: 'claim', knownBy: ['ash', 'bea'], witnesses: ['ash', 'bea'] })
    expect(formatMemoryLine(claim, 'ash')).toBe('Heard, not confirmed: Cole said that the mayor fled the city.')
    expect(formatMemoryLine(claim, 'bea')).toBe('Heard, not confirmed: Cole said that the mayor fled the city.')
    expect(formatMemoryLine(mem({ text: 'Bea is hiding something.', certainty: 'belief' }), 'ash')).toBe('Believes: Bea is hiding something.')
    expect(formatMemoryLine(mem({ text: 'Ash lit the lamp.', certainty: 'firsthand' }), 'ash')).toBe('Ash lit the lamp.')
  })

  it('marks what a character was only told as secondhand, but not for those who saw it', () => {
    const m = mem({ text: 'Ash broke the ward.', witnesses: ['ash'], toldVia: [{ to: ['bea'], by: 'ash', at: 1 }], knownBy: ['ash', 'bea'] })
    expect(formatMemoryLine(m, 'ash')).toBe('Ash broke the ward.')
    expect(formatMemoryLine(m, 'bea')).toBe('Heard secondhand: Ash broke the ward.')
    const rumor = { ...m, certainty: 'claim' as const }
    expect(formatMemoryLine(rumor, 'bea')).toBe('Heard, not confirmed: Ash broke the ward.')
  })

  it('never tells a character the player ruled a rumor false or made it canon', () => {
    const ruledFalse = mem({ text: 'Cole said that the well is poisoned.', certainty: 'claim', verdict: 'false' })
    const canon = mem({ text: 'Bea said that the old king lives.', certainty: 'claim', verdict: 'true', canonFactId: 'fact-1' })
    expect(formatMemoryLine(ruledFalse, 'ash')).toBe('Heard, not confirmed: Cole said that the well is poisoned.')
    expect(formatMemoryLine(canon, 'ash')).toBe('Heard, not confirmed: Bea said that the old king lives.')
  })

  it('combines how it is known with secret and open-thread marks', () => {
    expect(formatMemoryLine(mem({ text: 'Bea said that Cole hid the key.', kind: 'secret', certainty: 'claim' }), 'ash'))
      .toBe('Kept secret; heard, not confirmed: Bea said that Cole hid the key.')
    expect(formatMemoryLine(mem({ text: 'Cole owes Bea a favour.', unresolved: true, certainty: 'belief', feelings: { ash: -0.6 } }), 'ash'))
      .toBe('Still unsettled, not resolved; believes: Cole owes Bea a favour. (it still stings)')
  })
})

describe('memoryBlock', () => {
  it('is empty with nothing to say', () => {
    expect(memoryBlock('Ash', [], undefined, 'ash')).toBe('')
  })

  it('renders header, journal, then lines', () => {
    const j = mem({ text: 'I came north looking for my brother.', kind: 'journal' })
    const line = mem({ text: 'Bea lied about the map.' })
    expect(memoryBlock('Ash', [line], j, 'ash')).toBe(
      'What Ash remembers (only Ash knows exactly this; others may not):\n'
      + 'I came north looking for my brother.\n'
      + '- Bea lied about the map.',
    )
  })
})

describe('selectMemoriesExplained', () => {
  it('picks exactly what selectMemories picks, with the reasons', () => {
    const list = [
      { id: 'p', chatId: 'c', text: 'Ash swore to guard the east gate.', kind: 'promise' as const, witnesses: ['ash'], knownBy: ['ash'], about: ['bea'], importance: 0.8, pinned: true, unresolved: true, active: true, origin: 'scribe' as const, createdAt: 1 },
      { id: 'q', chatId: 'c', text: 'The ward on the gate cracked at dusk.', kind: 'event' as const, witnesses: ['ash'], knownBy: ['ash'], importance: 0.4, active: true, origin: 'scribe' as const, createdAt: 2 },
    ]
    const opts = { characterId: 'ash', presentIds: ['bea'], recentText: 'Who cracked the ward?' }
    const explained = selectMemoriesExplained(list, opts)
    expect(explained.map((e) => e.memory.id)).toEqual(selectMemories(list, opts).map((m) => m.id))
    expect(explained[0].reasons).toMatchObject({ pinned: true, openThread: true, aboutPresent: ['bea'], important: true })
    expect(explained.find((e) => e.memory.id === 'q')!.reasons.matchedWords).toEqual(expect.arrayContaining(['ward', 'crack']))
  })
})
