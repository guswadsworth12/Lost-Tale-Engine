import { describe, expect, it } from 'vitest'
import { buildCharacterProfileNote } from './profile'
import { blankCharacterData, type Character } from './cardSpec'

function character(overrides: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    card: blankCharacterData('Test'),
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  }
}

describe('buildCharacterProfileNote', () => {
  it('returns undefined when nothing is set', () => {
    expect(buildCharacterProfileNote(character())).toBeUndefined()
  })

  it('folds occupation and workplace into one line', () => {
    const note = buildCharacterProfileNote(character({ occupation: 'barista', workplace: 'Sakura Hill Cafe' }))
    expect(note).toContain('Works as barista at Sakura Hill Cafe')
  })

  it('lists boundaries in full, uncapped, regardless of count', () => {
    const boundaries = Array.from({ length: 20 }, (_, i) => `Limit ${i}`)
    const note = buildCharacterProfileNote(character({ boundaries }))
    for (const b of boundaries) expect(note).toContain(b)
  })

  it('caps likes to the first 8 rather than growing without bound', () => {
    const likes = Array.from({ length: 20 }, (_, i) => `Like ${i}`)
    const note = buildCharacterProfileNote(character({ likes }))
    expect(note).toContain('Like 0')
    expect(note).toContain('Like 7')
    expect(note).not.toContain('Like 8')
    expect(note).not.toContain('Like 19')
  })

  it('caps goals to the first 5', () => {
    const goals = Array.from({ length: 10 }, (_, i) => `Goal ${i}`)
    const note = buildCharacterProfileNote(character({ goals }))
    expect(note).toContain('Goal 4')
    expect(note).not.toContain('Goal 5')
  })

  it('caps frequented locations to the first 5', () => {
    const frequentedLocations = Array.from({ length: 10 }, (_, i) => `Spot ${i}`)
    const note = buildCharacterProfileNote(character({ frequentedLocations }))
    expect(note).toContain('Spot 4')
    expect(note).not.toContain('Spot 5')
  })

  it('caps social connections to the first 6', () => {
    const socialConnections = Array.from({ length: 10 }, (_, i) => ({ id: String(i), name: `Person ${i}`, relation: 'friend' }))
    const note = buildCharacterProfileNote(character({ socialConnections }))
    expect(note).toContain('Person 5')
    expect(note).not.toContain('Person 6')
  })

  it('keeps register guidance without forcing tics or catchphrases', () => {
    const note = buildCharacterProfileNote(character({ voiceFingerprint: {
      verbalTics: ['well'], catchphrases: ['show me'], dialectNotes: 'formal under pressure', sentenceRhythm: 'Long sentences',
    } }))!
    expect(note).toContain('formal under pressure')
    expect(note).toContain('Long sentences')
    expect(note).not.toContain('"well"')
    expect(note).not.toContain('"show me"')
    expect(note).not.toContain('every single reply')
  })

  it('does not turn a tic-only fingerprint into prompt guidance', () => {
    expect(buildCharacterProfileNote(character({ voiceFingerprint: { verbalTics: ['well'] } }))).toBeUndefined()
  })

  it('folds a "when_then" behavioral rule into a "When X: Y." line', () => {
    const note = buildCharacterProfileNote(
      character({ behavioralRules: [{ id: 'r1', kind: 'when_then', when: 'he brings up her sister', then: 'she deflects with a joke' }] }),
    )
    expect(note).toContain('current explicit author guidance takes precedence')
    expect(note).toContain('When he brings up her sister: she deflects with a joke.')
  })

  it('folds a "never" behavioral rule into a "Never: Y." line, ignoring any `when`', () => {
    const note = buildCharacterProfileNote(character({ behavioralRules: [{ id: 'r1', kind: 'never', when: 'ignored', then: 'initiate a kiss first' }] }))
    expect(note).toContain('Never: initiate a kiss first.')
    expect(note).not.toContain('ignored')
  })

  it('falls back to "it comes up" when a when_then rule has no when text authored', () => {
    const note = buildCharacterProfileNote(character({ behavioralRules: [{ id: 'r1', kind: 'when_then', then: 'she goes quiet' }] }))
    expect(note).toContain('When it comes up: she goes quiet.')
  })

  it('drops rules with blank `then` text and returns undefined if none remain', () => {
    const note = buildCharacterProfileNote(character({ behavioralRules: [{ id: 'r1', kind: 'never', then: '   ' }] }))
    expect(note).toBeUndefined()
  })

  it('caps behavioral rules to the first 10', () => {
    const behavioralRules = Array.from({ length: 15 }, (_, i) => ({ id: String(i), kind: 'never' as const, then: `rule ${i}` }))
    const note = buildCharacterProfileNote(character({ behavioralRules }))
    expect(note).toContain('rule 9')
    expect(note).not.toContain('rule 10')
  })

  it('keeps dialect-only guidance compact', () => {
    expect(buildCharacterProfileNote(character({ voiceFingerprint: { dialectNotes: 'blunt, one-word answers' } })))
      .toContain('Voice guidance: dialect/register: blunt, one-word answers')
  })
})
