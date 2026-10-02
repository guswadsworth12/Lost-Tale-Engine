import { describe, expect, it } from 'vitest'
import { appearanceNote, cardBrief } from './cardBrief'
import type { Character } from './cardSpec'

const item = (name: string, content: string, extra: Record<string, unknown> = {}) => ({ id: name, name, content, role: 'system' as const, enabled: true, ...extra })

describe('a card, briefly, for the GM', () => {
  it('reads an imported card from its prompt items, skipping scaffolding', () => {
    const lyra = {
      card: { name: 'Lyra' },
      promptItems: [
        item('Open Tag', '<{{this_card}}>'),
        item('📋 General', '<📋 General {{this_card}}>\n**{{this_card}}** is a small, bright-green feline Exceed who trusts {{user}}.'),
        item('📖 The sleeper', 'Before she was {{char}}, she was the sleeper under the seal.'),
        item('💬 Example 1', '{{user}}: hi\n{{char}}: hello'),
        item('🗣️ Voice', 'No closing epigrams.'),
        item('Old rule', 'secret', { enabled: false }),
        item('Script', 'eval()', { importWarning: 'macro' }),
      ],
    } as unknown as Character
    expect(cardBrief(lyra, { userName: 'Wren' })).toBe('**Lyra** is a small, bright-green feline Exceed who trusts Wren.\n\nBefore she was Lyra, she was the sleeper under the seal.')
  })

  it('puts the description and personality first, and keeps it short', () => {
    const bea = { card: { name: 'Bea', description: 'A tall lamplighter.', personality: 'Dry.' }, promptItems: [item('Notes', 'x'.repeat(50))] } as unknown as Character
    expect(cardBrief(bea, { userName: 'Wren' })).toBe(`A tall lamplighter.\n\nPersonality: Dry.\n\n${'x'.repeat(50)}`)
    expect(cardBrief(bea, { userName: 'Wren', maxChars: 10 })).toBe('A tall lam…')
  })

  it('tells the GM each described form apart from outfits, before the rest of the card', () => {
    const outfits = [
      { id: 'construct', label: 'construct', kind: 'form' as const, description: 'A jade-and-brass construct body, heavy and slow.' },
      { id: 'wisp', label: 'wisp', kind: 'form' as const, description: 'A drifting mote of green light. Cannot hold things.' },
      { id: 'gown', label: 'gown', description: 'A dark green dinner gown.' },
      { id: 'plain', label: 'plain' },
    ]
    const brief = cardBrief({ card: { name: 'Wren', description: 'A guide for travellers.' } as never, outfits, promptItems: [] }, { userName: 'Sam' })
    expect(brief).toContain('Forms (besides their usual one): construct: A jade-and-brass construct body, heavy and slow. | wisp: A drifting mote of green light. Cannot hold things.')
    expect(brief).toContain('Outfits: gown: A dark green dinner gown.')
    expect(brief).not.toContain('plain')
    expect(brief.indexOf('A guide')).toBeLessThan(brief.indexOf('Forms'))
  })
})

describe('the form a character is in now', () => {
  const outfits = [{ id: 'wisp', label: 'wisp', kind: 'form' as const, description: 'A drifting mote of green light.' }, { id: 'gown', label: 'gown', description: 'A dark green gown.' }, { id: 'plain', label: 'plain' }]
  it('says what their current form or outfit is, only when it is described', () => {
    expect(appearanceNote('Wren', outfits, 'wisp')).toBe('Right now Wren is in their wisp form: A drifting mote of green light.')
    expect(appearanceNote('Wren', outfits, 'gown')).toBe('Right now Wren is wearing gown: A dark green gown.')
    expect(appearanceNote('Wren', outfits, 'plain')).toBe('')
    expect(appearanceNote('Wren', outfits, 'base')).toBe('')
    expect(appearanceNote('Wren', outfits, undefined)).toBe('')
  })
})
