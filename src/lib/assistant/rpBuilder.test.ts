import { describe, expect, it } from 'vitest'
import { EMPTY_RP_DRAFT, parseRpDraft, rpCharacterInput, rpDraftError, rpWorldInput } from './rpBuilder'

describe('guided roleplay builder', () => {
  it('keeps mechanics choices with the writer and turns a model draft into editable fields', () => {
    const current = { ...EMPTY_RP_DRAFT, brief: 'A memory market', template: 'visual_novel' as const, ruleset: 'dnd-5-2' }
    const draft = parseRpDraft('```json\n{"world":{"name":"The Memory Market","description":"A city trades memories","rules":"Memories cannot be copied","gmNotes":"The mayor owns the market"},"lore":[{"name":"The quay","detail":"Boats arrive at night"}],"player":{"name":"Ari"},"cast":[{"name":"Vera","description":"A broker","personality":"Direct"}],"goal":"Find the lost ledger","opening":"Vera offers Ari a sealed memory."}\n```', current)
    expect(draft.template).toBe('visual_novel')
    expect(draft.ruleset).toBe('dnd-5-2')
    expect(draft.title).toBe('The Memory Market')
    expect(draft.cast[0].name).toBe('Vera')
    expect(draft.lore[0].detail).toBe('Boats arrive at night')
    expect(draft.goal).toBe('Find the lost ledger')
  })

  it('builds a world with private GM notes and gives the player a usable rules sheet', () => {
    const draft = { ...EMPTY_RP_DRAFT, title: 'The Memory Market', template: 'freeform' as const, ruleset: 'dnd-5-2',
      gmNotes: 'The mayor owns it', lore: [{ name: 'The quay', detail: 'Boats arrive at night' }],
      sheetStats: { strength: 16 }, opening: 'Vera offers a sealed memory.' }
    const world = rpWorldInput(draft)
    expect(world.gmNotes).toBe('The mayor owns it')
    expect(world.modules.campaignRules).toBe('mechanical')
    expect(world.lorebook.entries[0].content).toBe('Boats arrive at night')
    expect(world.lorebook.entries[0].id).toBe(1)
    const player = rpCharacterInput({ name: 'Ari', description: '', personality: '' }, 'world-1', draft, true)
    expect(player.sheet?.stats.strength).toBe(16)
    expect(player.sheet?.stats.dexterity).toBe(10)
    expect(player.card.first_mes).toBe('')
    expect(rpCharacterInput({ name: 'Second', description: '', personality: '' }, 'world-1', draft, false, false).card.first_mes).toBe('')
    expect(rpWorldInput({ ...draft, ruleset: '' }).campaign).toBeNull()
    expect(rpDraftError({ ...draft, cast: [{ name: 'Mara', description: '', personality: '' }], description: 'A city', sheetStats: { strength: 0 } })).toContain('Strength')
  })
})
