import { describe, expect, it } from 'vitest'
import type { Character } from '@/lib/characters/cardSpec'
import { isAiPlayable, playerViewOf, switchPlayer } from './player'

const character = (over: Partial<Character> = {}): Character =>
  ({
    id: 'c1',
    card: { name: 'Ash', description: 'Card description' },
    createdAt: 7,
    updatedAt: 7,
    ...over,
  }) as Character

describe('playerViewOf', () => {
  it('uses the player description, falling back to the card description', () => {
    expect(playerViewOf(character({ playerDescription: '  Known by sight.  ' })).description).toBe('Known by sight.')
    expect(playerViewOf(character()).description).toBe('Card description')
  })

  it('never exposes private memory or prompts', () => {
    const view = playerViewOf(character({ privateMemory: 'secret', promptItems: [] }))
    expect(JSON.stringify(view)).not.toContain('secret')
    expect(view).toMatchObject({ id: 'c1', characterId: 'c1', name: 'Ash', createdAt: 7 })
  })
})

describe('switchPlayer', () => {
  const cards: Record<string, Pick<Character, 'id' | 'playerOnly'>> = {
    lead: { id: 'lead' },
    ally: { id: 'ally' },
    ash: { id: 'ash', playerOnly: true },
    wren: { id: 'wren' },
  }
  const lookup = (id: string) => cards[id]

  it('takes a card out of the AI cast when you start playing it', () => {
    const result = switchPlayer({ characterId: 'lead', participants: ['ally'], playerCharacterId: 'ash' }, 'ally', lookup)
    expect(result).toEqual({ ok: true, patch: { playerCharacterId: 'ally', participants: undefined } })
  })

  it('hands the card you leave back to the AI', () => {
    const result = switchPlayer({ characterId: 'lead', participants: ['ally'], playerCharacterId: 'wren' }, 'ally', lookup)
    expect(result).toEqual({ ok: true, patch: { playerCharacterId: 'ally', participants: ['wren'] } })
  })

  it('keeps a "you only" card out of the AI cast when you leave it', () => {
    const result = switchPlayer({ characterId: 'lead', participants: [], playerCharacterId: 'ash' }, 'wren', lookup)
    expect(result).toEqual({ ok: true, patch: { playerCharacterId: 'wren', participants: undefined } })
  })

  it("refuses the story's lead and missing cards", () => {
    expect(switchPlayer({ characterId: 'lead', participants: [] }, 'lead', lookup).ok).toBe(false)
    expect(switchPlayer({ characterId: 'lead', participants: [] }, 'gone', lookup).ok).toBe(false)
  })

  it('reads "you only" as not AI-playable', () => {
    expect(isAiPlayable({ playerOnly: true })).toBe(false)
    expect(isAiPlayable({})).toBe(true)
  })
})
