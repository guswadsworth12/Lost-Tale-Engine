import { describe, expect, it } from 'vitest'
import type { CharacterMemory } from '@/lib/types'
import { buildJournalPrompt, parseJournalResponse, pickForJournal } from './journal'

let seq = 0
function mem(over: Partial<CharacterMemory> = {}): CharacterMemory {
  seq++
  return {
    id: `m${seq}`,
    chatId: 'chat-1',
    text: `Memory ${seq}`,
    kind: 'event',
    witnesses: ['ash'],
    knownBy: ['ash'],
    importance: 0.5,
    active: true,
    origin: 'scribe',
    createdAt: seq,
    ...over,
  }
}

describe('pickForJournal', () => {
  it('returns nothing when there are no more candidates than keepRecent', () => {
    const memories = Array.from({ length: 12 }, () => mem())
    expect(pickForJournal(memories, 'ash')).toEqual([])
    expect(pickForJournal(memories.slice(0, 3), 'ash', { keepRecent: 3 })).toEqual([])
  })

  it('ignores memories that are not candidates', () => {
    const excluded = [
      mem({ active: false }),
      mem({ knownBy: ['bea'] }),
      mem({ kind: 'journal' }),
      mem({ pinned: true }),
      mem({ consolidatedFor: ['ash'] }),
      mem({ unresolved: true }),
    ]
    const plain = [mem(), mem({ consolidatedFor: ['bea'] })]
    expect(pickForJournal([...excluded, ...plain], 'ash', { keepRecent: 2 })).toEqual([])
    const folded = pickForJournal([...excluded, ...plain, mem()], 'ash', { keepRecent: 2 })
    expect(folded.map((m) => m.id)).toEqual([plain[0].id])
  })

  it('folds the oldest, least important memories and returns them oldest first', () => {
    const oldImportant = mem({ importance: 1, createdAt: 1 })
    const oldMinor = mem({ importance: 0.1, createdAt: 2 })
    const midMinor = mem({ importance: 0.1, createdAt: 3 })
    const recent = mem({ importance: 0.5, createdAt: 4 })
    const newest = mem({ importance: 0.2, createdAt: 5 })
    const folded = pickForJournal([newest, midMinor, oldImportant, recent, oldMinor], 'ash', { keepRecent: 3 })
    expect(folded.map((m) => m.id)).toEqual([oldMinor.id, midMinor.id])
  })
})

describe('buildJournalPrompt', () => {
  it('includes the previous journal, the memories and the constraints', () => {
    const prompt = buildJournalPrompt({
      name: 'Bea',
      previousJournal: 'Bea came to the city looking for her brother.',
      toFold: [{ text: 'Ash gave Bea the key.', feeling: 0.6 }, { text: 'Cole lied to Bea.', feeling: -0.8 }, { text: '  ' }],
      worldName: 'Testland',
    })
    expect(prompt).toContain('Bea came to the city looking for her brother.')
    expect(prompt).toContain('- Ash gave Bea the key. (sat well with Bea)')
    expect(prompt).toContain('- Cole lied to Bea. (sat badly with Bea)')
    expect(prompt).toContain('under 180 words')
    expect(prompt).toContain('Reply with only the journal text.')
    expect(prompt).toContain('Testland')
  })
})

describe('parseJournalResponse', () => {
  it('strips fences, labels and quotes and collapses whitespace', () => {
    expect(parseJournalResponse('```\nJournal: Bea keeps the key.\n\nShe trusts Ash.\n```')).toBe('Bea keeps the key. She trusts Ash.')
    expect(parseJournalResponse('**Updated journal:** "Bea keeps the key."')).toBe('Bea keeps the key.')
    expect(parseJournalResponse('{"journal": "Bea keeps the key."}')).toBe('Bea keeps the key.')
  })

  it('returns an empty string for empty input and caps long text', () => {
    expect(parseJournalResponse('')).toBe('')
    expect(parseJournalResponse('```\n```')).toBe('')
    const long = parseJournalResponse('Bea remembers the road. '.repeat(200))
    expect(long.length).toBeLessThanOrEqual(1500)
    expect(long.endsWith('.')).toBe(true)
  })
})
