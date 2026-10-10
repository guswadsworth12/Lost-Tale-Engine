import { describe, expect, it } from 'vitest'
import { canonAudience, canonFactsFor, type CanonFact } from './canonFacts'

const fact = (id: string, text: string, knownBy?: string[]): CanonFact => ({ id, text, createdAt: 1, ...(knownBy ? { knownBy } : {}) })

describe('canonFactsFor', () => {
  const facts = [
    fact('f1', 'The east bridge fell last winter.'),
    fact('f2', 'Ash asked Bea to dinner tomorrow.', ['ash', 'bea']),
    fact('f3', 'Cole is leaving the guild.', ['cole']),
  ]

  it('tells a character the public facts and the ones they were there for, in order', () => {
    expect(canonFactsFor(facts, 'ash').map((f) => f.id)).toEqual(['f1', 'f2'])
    expect(canonFactsFor(facts, 'cole').map((f) => f.id)).toEqual(['f1', 'f3'])
  })

  it('keeps a private plan out of the prompt of someone who was not in the room', () => {
    expect(canonFactsFor(facts, 'dara').map((f) => f.text)).toEqual(['The east bridge fell last winter.'])
  })

  it('treats facts saved before knownBy existed as public, so older worlds read as they did', () => {
    const old = [fact('f1', 'A'), fact('f2', 'B')]
    expect(canonFactsFor(old, 'anyone')).toEqual(old)
  })

  it('handles a world with no facts', () => {
    expect(canonFactsFor(undefined, 'ash')).toEqual([])
    expect(canonFactsFor([], 'ash')).toEqual([])
  })

  it('does not change the list it was given', () => {
    const copy = structuredClone(facts)
    canonFactsFor(facts, 'dara')
    expect(facts).toEqual(copy)
  })
})

describe('canonFactsFor across stories', () => {
  const recorded = (id: string, sourceChatId: string, knownBy?: string[], shared?: boolean): CanonFact => ({ id, text: id, createdAt: 1, sourceChatId, ...(knownBy ? { knownBy } : {}), ...(shared ? { shared } : {}) })
  const facts = [
    fact('typed', 'Typed into the world by hand.'),
    recorded('here', 'scene-2', ['ash']),
    recorded('earlier', 'scene-1'),
    recorded('other-story', 'elsewhere-1', ['ash']),
    recorded('told-to-all', 'elsewhere-2', ['bea'], true),
  ]
  const branch = new Set(['scene-1', 'scene-2'])

  it('keeps recorded canon in its own story and branch, and hand-typed canon world-wide', () => {
    expect(canonFactsFor(facts, 'ash', branch).map((f) => f.id)).toEqual(['typed', 'here', 'earlier', 'told-to-all'])
    expect(canonFactsFor(facts, 'bea', branch).map((f) => f.id)).toEqual(['typed', 'earlier', 'told-to-all'])
  })

  it('tells the narrator everything in this branch and nothing from another story', () => {
    expect(canonFactsFor(facts, 'narrator', branch).map((f) => f.id)).toEqual(['typed', 'here', 'earlier', 'told-to-all'])
  })

  it('treats a fact told to everyone as world-wide, wherever it was recorded', () => {
    expect(canonFactsFor(facts, 'cole', new Set(['another'])).map((f) => f.id)).toEqual(['typed', 'told-to-all'])
  })
})

describe('canonAudience', () => {
  it('keeps unique ids in order and drops blanks', () => {
    expect(canonAudience(['ash', undefined, 'bea', 'ash', '', null])).toEqual(['ash', 'bea'])
  })

  it('returns undefined, not an empty list, when nobody is named, so the fact stays public', () => {
    expect(canonAudience([])).toBeUndefined()
    expect(canonAudience(undefined)).toBeUndefined()
    expect(canonAudience([undefined, ''])).toBeUndefined()
  })
})
