import { describe, expect, it } from 'vitest'
import { gmMemoryDigest, knowledgeGaps } from './gmKnowledge'
import type { CharacterMemory } from '@/lib/types'

let n = 0
function mem(overrides: Partial<CharacterMemory> & { text: string; knownBy: string[] }): CharacterMemory {
  n++
  return {
    id: `g${String(n).padStart(3, '0')}`,
    chatId: 'c1',
    kind: 'event',
    witnesses: overrides.knownBy,
    importance: 0.7,
    active: true,
    origin: 'scribe',
    createdAt: n,
    ...overrides,
  }
}

const names: Record<string, string> = { ash: 'Ash', bea: 'Bea', cole: 'Cole', dara: 'Dara' }
const nameOf = (id: string) => names[id]

describe('knowledgeGaps', () => {
  it('tells the GM who present does not know what another present character knows', () => {
    const list = [mem({ text: 'Ash broke the east gate ward.', knownBy: ['ash', 'cole'] })]
    expect(knowledgeGaps(list, ['ash', 'bea', 'cole'], nameOf)).toEqual(['Bea does not know: Ash broke the east gate ward.'])
  })

  it('groups per character, most important first, up to 3 per line', () => {
    const list = [
      mem({ text: 'Low but secret.', kind: 'secret', importance: 0.2, knownBy: ['ash'] }),
      mem({ text: 'Top.', importance: 0.95, knownBy: ['ash'] }),
      mem({ text: 'Mid.', importance: 0.8, knownBy: ['ash'] }),
      mem({ text: 'Open thread.', importance: 0.3, unresolved: true, knownBy: ['ash'] }),
      mem({ text: 'Trivial.', importance: 0.3, knownBy: ['ash'] }),
      mem({ text: 'Only Cole missing this.', importance: 0.9, knownBy: ['ash', 'bea'] }),
    ]
    expect(knowledgeGaps(list, ['ash', 'bea', 'cole'], nameOf)).toEqual([
      'Bea does not know: Top; Mid; Open thread.',
      'Cole does not know: Top; Only Cole missing this; Mid.',
    ])
  })

  it('ignores memories no present character knows, journals, retired ones, and unnamed ids', () => {
    const list = [
      mem({ text: 'Dara saw it alone.', knownBy: ['dara'] }),
      mem({ text: 'Journal.', kind: 'journal', knownBy: ['ash'] }),
      mem({ text: 'Retired.', active: false, knownBy: ['ash'] }),
      mem({ text: 'Visible gap.', knownBy: ['ash'] }),
    ]
    expect(knowledgeGaps(list, ['ash', 'bea', 'ghost'], nameOf)).toEqual(['Bea does not know: Visible gap.'])
  })

  it('caps the number of lines', () => {
    const list = [mem({ text: 'Something.', knownBy: ['ash'] })]
    expect(knowledgeGaps(list, ['ash', 'bea', 'cole', 'dara'], nameOf, { max: 2 })).toHaveLength(2)
  })
})

describe('gmMemoryDigest', () => {
  it('lists everything with who knows it, highest priority first', () => {
    const list = [
      mem({ text: 'Minor thing.', importance: 0.1, knownBy: ['bea'] }),
      mem({ text: 'Bea hid the key.', kind: 'secret', importance: 0.9, knownBy: ['bea', 'ash'] }),
      mem({ text: 'Journal.', kind: 'journal', knownBy: ['ash'] }),
    ]
    expect(gmMemoryDigest(list, nameOf)).toEqual([
      '- Bea hid the key. (secret; known by: Bea, Ash)',
      '- Minor thing. (known by: Bea)',
    ])
  })

  it('ignores consolidation: the GM sees everything', () => {
    const list = [mem({ text: 'Folded for Ash.', knownBy: ['ash'], consolidatedFor: ['ash'] })]
    expect(gmMemoryDigest(list, nameOf)).toEqual(['- Folded for Ash. (known by: Ash)'])
    expect(knowledgeGaps(list, ['ash', 'bea'], nameOf)).toEqual(['Bea does not know: Folded for Ash.'])
  })

  it('respects max', () => {
    const list = Array.from({ length: 20 }, (_, i) => mem({ text: `M${i}.`, knownBy: ['ash'] }))
    expect(gmMemoryDigest(list, nameOf)).toHaveLength(12)
    expect(gmMemoryDigest(list, nameOf, { max: 3 })).toHaveLength(3)
  })
})
