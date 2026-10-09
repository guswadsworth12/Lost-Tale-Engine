import { describe, expect, it } from 'vitest'
import type { MemoryReasons } from '@/lib/memory/rank'
import { whyLabels } from './memoryWhy'

const reasons = (over: Partial<MemoryReasons> = {}): MemoryReasons => ({
  pinned: false,
  openThread: false,
  aboutPresent: [],
  matchedWords: [],
  recent: false,
  important: false,
  score: 0.3,
  ...over,
})

describe('whyLabels', () => {
  it('is empty when nothing applies', () => {
    expect(whyLabels(reasons(), [])).toEqual([])
  })

  it('lists every reason that applies, in a fixed order', () => {
    const all = reasons({
      important: true,
      recent: true,
      matchedWords: ['ward', 'gate'],
      aboutPresent: ['bea'],
      openThread: true,
      pinned: true,
    })
    expect(whyLabels(all, ['Bea'])).toEqual(['Pinned', 'Open thread', 'About Bea', 'Matches: ward, gate', 'Recent', 'Important'])
  })

  it('names several people in one chip', () => {
    expect(whyLabels(reasons({ aboutPresent: ['ash', 'bea'] }), ['Ash', 'Bea'])).toEqual(['About Ash, Bea'])
  })

  it('leaves out the About chip when no name resolved', () => {
    expect(whyLabels(reasons({ aboutPresent: ['someone'] }), [])).toEqual([])
    expect(whyLabels(reasons(), ['  '])).toEqual([])
  })

  it('caps a long list of matched words', () => {
    const words = ['ward', 'gate', 'lantern', 'river', 'bridge', 'tower']
    expect(whyLabels(reasons({ matchedWords: words }), [])).toEqual(['Matches: ward, gate, lantern, river +2'])
  })

  it('shows single reasons on their own', () => {
    expect(whyLabels(reasons({ recent: true }), [])).toEqual(['Recent'])
    expect(whyLabels(reasons({ important: true }), [])).toEqual(['Important'])
    expect(whyLabels(reasons({ openThread: true }), [])).toEqual(['Open thread'])
  })
})


it('explains all Deep Memory boosts in plain language', () => {
  expect(whyLabels(reasons({ strongFeeling: true, samePlace: true, oftenRecalled: true, similarMeaning: true }), []))
    .toEqual(['Strong feeling', 'Happened here', 'Often remembered', 'Similar meaning'])
})


it('names the one-step connection in the Inspector', () => {
  expect(whyLabels({ pinned: false, openThread: false, aboutPresent: [], matchedWords: [], recent: false, important: false, score: 1, linkedThrough: ['Mara'] }, [])).toEqual(['Linked through Mara'])
})
