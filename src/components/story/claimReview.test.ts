import { describe, expect, it } from 'vitest'
import { canonTextFrom, claimsToReview, promoteToCanon, ruledClaims } from './claimReview'
import { formatMemoryLine } from '@/lib/memory/rank'
import type { CharacterMemory } from '@/lib/types'

let n = 0
function mem(overrides: Partial<CharacterMemory> & { text: string }): CharacterMemory {
  n++
  return {
    id: `c${String(n).padStart(3, '0')}`,
    chatId: 'scene-1',
    kind: 'learned',
    witnesses: ['ash', 'bea'],
    knownBy: ['ash', 'bea'],
    importance: 0.5,
    active: true,
    origin: 'scribe',
    createdAt: n,
    ...overrides,
  }
}

describe('claimsToReview / ruledClaims', () => {
  it('lists unruled claims and beliefs newest first, and nothing firsthand, retired, or journal', () => {
    const older = mem({ text: 'Cole said that the mayor fled.', certainty: 'claim', createdAt: 1 })
    const newer = mem({ text: 'Bea suspects Cole.', certainty: 'belief', createdAt: 5 })
    const list = [
      older,
      newer,
      mem({ text: 'Ash lit the lamp.', certainty: 'firsthand' }),
      mem({ text: 'Older memory with no certainty.' }),
      mem({ text: 'Cole said that the gate is shut.', certainty: 'claim', active: false }),
      mem({ text: 'Journal.', kind: 'journal', certainty: 'claim' }),
      mem({ text: 'Cole said that the well is dry.', certainty: 'claim', verdict: 'false' }),
    ]
    expect(claimsToReview(list)).toEqual([newer, older])
  })

  it('lists ruled ones most recently ruled first', () => {
    const a = mem({ text: 'Cole said that the well is dry.', certainty: 'claim', verdict: 'false', updatedAt: 50 })
    const b = mem({ text: 'Bea said that the bridge is out.', certainty: 'claim', verdict: 'true', canonFactId: 'f1', updatedAt: 90 })
    const open = mem({ text: 'Cole said that the mayor fled.', certainty: 'claim' })
    expect(ruledClaims([a, b, open])).toEqual([b, a])
  })
})

describe('canonTextFrom', () => {
  it('turns "X said that ..." into the plain fact', () => {
    expect(canonTextFrom('Cole said that the mayor fled the city.')).toBe('The mayor fled the city.')
    expect(canonTextFrom('Bea Marsh claimed that Ash broke the ward.')).toBe('Ash broke the ward.')
    expect(canonTextFrom('Cole told Bea that the well is poisoned.')).toBe('The well is poisoned.')
    expect(canonTextFrom('Cole said that, according to talk at the inn, the mayor fled.')).toBe('The mayor fled.')
  })

  it('leaves anything else as written', () => {
    expect(canonTextFrom('  Bea suspects Cole is lying.  ')).toBe('Bea suspects Cole is lying.')
  })
})

describe('promoteToCanon', () => {
  it('appends a world fact in the shape finishScene writes and marks the claim true and linked', () => {
    const existing = [{ id: 'f0', text: 'The east bridge fell last winter.', createdAt: 1 }]
    const result = promoteToCanon(existing, '  The mayor fled.  ', 'scene-1', 'f1', 100)
    expect(result).toEqual({
      canonFacts: [...existing, { id: 'f1', text: 'The mayor fled.', createdAt: 100, sourceChatId: 'scene-1' }],
      memoryPatch: { verdict: 'true', canonFactId: 'f1' },
    })
    expect(existing).toHaveLength(1)
  })

  it('does nothing for blank text', () => {
    expect(promoteToCanon([], '   ', 'scene-1', 'f1', 100)).toBeNull()
  })

  it('leaves what the characters are told unchanged: they still only heard it', () => {
    const claim = mem({ text: 'Cole said that the mayor fled.', certainty: 'claim' })
    const promoted = { ...claim, ...promoteToCanon(undefined, 'The mayor fled.', 'scene-1', 'f1', 100)!.memoryPatch }
    const ruledFalse = { ...claim, verdict: 'false' as const }
    expect(formatMemoryLine(promoted, 'ash')).toBe(formatMemoryLine(claim, 'ash'))
    expect(formatMemoryLine(ruledFalse, 'ash')).toBe(formatMemoryLine(claim, 'ash'))
  })
})
