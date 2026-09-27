import { describe, expect, it } from 'vitest'
import { STARTER_PBTA_CAMPAIGN, resolvePbtaRoll } from './campaign'
import {
  branchConsequencesFrom,
  buildGmPrompt,
  formatGmMessage,
  gmDirectionFor,
  isPlayerCharacter,
  parseGmTurn,
  type GmContext,
  type RecordedMove,
} from './gm'

const move = STARTER_PBTA_CAMPAIGN.moves[0] // Take a Risk
const mixedRoll: RecordedMove = { ...resolvePbtaRoll(move, 1, [4, 3]), id: 'roll-1', createdAt: 1, action: 'I throw a ward over Hana.' }

function ctx(overrides: Partial<GmContext> = {}): GmContext {
  return {
    campaign: { ...STARTER_PBTA_CAMPAIGN, mode: 'mechanical' },
    worldName: 'Emberfall',
    worldDescription: 'A river town under a long winter.',
    canonFacts: ['The east bridge collapsed last winter.'],
    branchConsequences: [],
    scenery: 'Guild Hall (night) — pinned by the player',
    roster: [
      { id: 'ivo', name: 'Ivo Brand', occupation: 'lamplighter' },
      { id: 'hana', name: 'Hana Pike' },
      { id: 'tobin', name: 'Tobin Reed' },
    ],
    playerName: 'Wren Calloway',
    transcript: [{ speaker: 'Hana Pike', text: 'Something is moving under the floor.' }],
    playerAction: 'I throw a ward over Hana.',
    maxSpeakers: 3,
    ...overrides,
  }
}

let n = 0
const ids = () => `p${++n}`

describe('Game Master prompt', () => {
  it('shows the GM only public context, the scenery, and the binding roll', () => {
    const { system, user } = buildGmPrompt(ctx({ recordedMove: mixedRoll }))
    expect(system).toContain('MECHANICAL')
    expect(system).toContain('Never write Wren Calloway')
    expect(system).toContain('NPCs without character cards')
    expect(system).toContain('Put present carded characters who should respond in speakers')
    expect(user).toContain('Current scenery: Guild Hall (night) — pinned by the player')
    expect(user).toContain('Recorded roll (binding): Take a Risk')
    expect(user).toContain('= 8, 7–9 mixed hit')
    expect(user).toContain('- Ivo Brand (lamplighter)')
    expect(user).toContain('The east bridge collapsed last winter.')
  })

  it('tells a guided GM it cannot claim dice', () => {
    const { system } = buildGmPrompt(ctx({ campaign: { ...STARTER_PBTA_CAMPAIGN, mode: 'guided' } }))
    expect(system).toContain('GUIDED')
    expect(system).toContain('Never claim a die roll')
  })
})

describe('Game Master decision validation', () => {
  it('honors the recorded roll even when the model narrates a different tier', () => {
    const raw = JSON.stringify({
      narration: 'The ward flares as the floor splits.',
      pacing: 'advance',
      speakers: ['Hana', 'Ivo Brand'],
      adjudication: { action: 'ward', move: "Take a Risk", tier: 'strong', outcome: 'Everything is fine.' },
      proposals: [{ scope: 'branch', text: 'The guild hall floor is cracked open.' }],
    })
    const turn = parseGmTurn(raw, ctx({ recordedMove: mixedRoll }), ids)
    expect(turn.adjudication).toMatchObject({ source: 'recorded_roll', tier: 'mixed', total: 8, outcome: move.mixed, rollId: 'roll-1' })
    expect(turn.corrections?.join(' ')).toContain('recorded mixed result stands')
    expect(turn.speakerIds).toEqual(['hana', 'ivo'])
    expect(turn.pacing).toBe('advance')
    expect(turn.proposals).toEqual([{ id: expect.any(String), scope: 'branch', text: 'The guild hall floor is cracked open.', status: 'pending' }])
    expect(formatGmMessage(turn)).toContain('[Take a Risk: 7–9 mixed hit (8, recorded roll)]')
    expect(gmDirectionFor(turn, 'Hana Pike', 'Wren Calloway')).toContain(`Binding recorded result`)
  })

  it('asks for a roll instead of accepting an invented mechanical result', () => {
    const raw = '{"narration":"Hana braces.","speakers":["Hana Pike"],"adjudication":{"action":"ward","move":"Take a Risk","tier":"strong","outcome":"You hold."}}'
    const turn = parseGmTurn(raw, ctx(), ids)
    expect(turn.adjudication).toMatchObject({ source: 'roll_needed', moveId: 'take-a-risk' })
    expect(turn.adjudication?.tier).toBeUndefined()
  })

  it('keeps a guided ruling labeled as judgment, never a tier', () => {
    const raw = '{"narration":"x","speakers":["Tobin"],"adjudication":{"action":"ward","move":null,"tier":"mixed","outcome":"The ward holds but cracks."}}'
    const turn = parseGmTurn(raw, ctx({ campaign: { ...STARTER_PBTA_CAMPAIGN, mode: 'guided' } }), ids)
    expect(turn.adjudication).toEqual({ action: 'ward', source: 'guided_judgment', outcome: 'The ward holds but cracks.' })
    expect(formatGmMessage(turn)).toContain('GM judgment (guided, not a rules result)')
  })

  it("never hands the player's character to an agent or lets narration speak for them", () => {
    const raw = JSON.stringify({
      narration: 'Dust rains down.\nWren: "Get back!"',
      speakers: ['Wren Calloway', 'Wren', 'Tobin Reed', 'Nobody'],
    })
    const turn = parseGmTurn(raw, ctx(), ids)
    expect(turn.speakerIds).toEqual(['tobin'])
    expect(turn.narration).toBe('Dust rains down.')
    expect(turn.corrections).toHaveLength(3)
    expect(isPlayerCharacter('Wren Calloway', 'Wren Calloway')).toBe(true)
    expect(isPlayerCharacter('Hana Pike', 'Wren Calloway')).toBe(false)
  })

  it('keeps carded characters out of the GM message but lets an uncarded NPC speak', () => {
    const context = ctx({ cardedNames: ['Ivo Brand', 'Hana Pike', 'Tobin Reed', 'Mira Vale'] })
    const duplicate = parseGmTurn(JSON.stringify({
      narration: 'Hana smiles and says, "Welcome home." The rain stops.',
      speakers: ['Hana Pike'],
      adjudication: { action: 'return home', move: null, tier: null, outcome: 'Hana welcomes Wren warmly.' },
    }), context, ids)
    expect(duplicate.speakerIds).toEqual(['hana'])
    expect(duplicate.narration).toBe('')
    expect(duplicate.adjudication).toBeUndefined()
    expect(formatGmMessage(duplicate)).not.toContain('Welcome home')
    expect(formatGmMessage(duplicate)).not.toContain('welcomes Wren')
    expect(duplicate.corrections?.join(' ')).toContain('Hana Pike')

    const absentCard = parseGmTurn('{"narration":"Mira enters the hall.","speakers":["Hana"]}', context, ids)
    expect(absentCard.narration).toBe('')

    const npc = parseGmTurn('{"narration":"The barkeep says the bridge is closed.","speakers":["Hana"],"adjudication":{"action":"ask directions","outcome":"The bridge is blocked."}}', context, ids)
    expect(npc.narration).toBe('The barkeep says the bridge is closed.')
    expect(npc.adjudication?.outcome).toBe('The bridge is blocked.')
  })

  it('falls back without the model, still honoring the roll and the addressed character', () => {
    const turn = parseGmTurn('I think Hana should talk next.', ctx({ recordedMove: mixedRoll, playerAction: 'Tobin, cover the door!' }), ids)
    expect(turn.fallback).toBeTruthy()
    expect(turn.speakerIds).toEqual(['tobin'])
    expect(turn.adjudication?.source).toBe('recorded_roll')
  })

  it('caps who acts and lets a cut end the scene with nobody speaking', () => {
    const many = parseGmTurn('{"speakers":["Ivo","Hana","Tobin"]}', ctx({ maxSpeakers: 2 }), ids)
    expect(many.speakerIds).toEqual(['ivo', 'hana'])
    expect(parseGmTurn('{"pacing":"cut","speakers":[]}', ctx(), ids).speakerIds).toEqual([])
  })

  it('only adds available non-player characters and creates a fork when allowed', () => {
    const context = ctx({ availableRoster: [{ id: 'mira', name: 'Mira Vale' }], canFork: true })
    const turn = parseGmTurn(JSON.stringify({
      speakers: ['Hana'], addCharacters: ['Wren', 'Mira Vale', 'Unknown'],
      fork: { title: 'The road north', reason: 'The party split to follow two leads.' },
    }), context, ids)
    expect(turn.addCharacterIds).toEqual(['mira'])
    expect(turn.speakerIds).toEqual(['hana'])
    expect(turn.fork).toEqual({ title: 'The road north', reason: 'The party split to follow two leads.' })
    expect(parseGmTurn('{"fork":{"title":"Another","reason":"Split"}}', ctx({ canFork: false }), ids).fork).toBeUndefined()
  })

  it('calls only listed lore and keeps storyteller notes in the GM prompt', () => {
    const context = ctx({
      gmNotes: 'Mira has a secret the others do not know.',
      loreIndex: [{ id: 'bridge', title: 'The East Bridge' }, { id: 'guild', title: 'Guild History' }],
    })
    const prompt = buildGmPrompt(context)
    expect(prompt.user).toContain('Storyteller-only continuity')
    const turn = parseGmTurn('{"loreCalls":["The East Bridge","Unknown","Guild History"]}', context, ids)
    expect(turn.loreCallIds).toEqual(['bridge', 'guild'])
  })
})

describe('branch consequences', () => {
  it('only confirmed branch proposals count, in story order, so a rewind drops them with their message', () => {
    const turn = parseGmTurn('{"proposals":[{"scope":"branch","text":"A"},{"scope":"world","text":"W"},{"scope":"branch","text":"B"}]}', ctx(), ids)
    const confirmed = { ...turn, proposals: turn.proposals.map((p) => ({ ...p, status: p.text === 'B' ? 'rejected' as const : 'confirmed' as const })) }
    const branch = [{}, { gm: confirmed }]
    expect(branchConsequencesFrom(branch)).toEqual(['A'])
    expect(branchConsequencesFrom(branch.slice(0, 1))).toEqual([])
  })
})

describe('group interplay and scene moves', () => {
  it('shows the GM where the scene is and asks for speakers who can play off each other', () => {
    const { system, user } = buildGmPrompt(ctx({ location: 'Guild Library', atmosphere: 'rain on the windows' }))
    expect(user).toContain('Current location: Guild Library (rain on the windows)')
    expect(system).toContain('Characters may answer one another, not only the player.')
    expect(system).toContain('A character arriving is not a move.')
  })

  it('records a move the fiction made, ignores a "move" to where the scene already is', () => {
    const moved = parseGmTurn('{"speakers":["Hana"],"setting":{"location":"Balcony terrace above the courtyard","atmosphere":"Late sun"}}', ctx({ location: 'Guild Library' }), ids)
    expect(moved.setting).toEqual({ location: 'Balcony terrace above the courtyard', atmosphere: 'Late sun' })
    expect(formatGmMessage(moved)).toContain('[Scene: Balcony terrace above the courtyard]')
    expect(parseGmTurn('{"speakers":["Hana"],"setting":{"location":"guild library"}}', ctx({ location: 'Guild Library' }), ids).setting).toBeUndefined()
    expect(parseGmTurn('{"speakers":["Hana"],"setting":null}', ctx(), ids).setting).toBeUndefined()
  })

  it('tells each agent who already spoke this beat (answerable) and who follows (theirs to answer)', () => {
    const turn = parseGmTurn('{"speakers":["Ivo","Tobin","Hana"]}', ctx(), ids)
    const order = ['Ivo Brand', 'Tobin Reed', 'Hana Pike']
    const first = gmDirectionFor(turn, 'Ivo Brand', 'Wren Calloway', order)
    const last = gmDirectionFor(turn, 'Hana Pike', 'Wren Calloway', order)
    expect(first).toContain('Tobin Reed and Hana Pike will speak after Ivo Brand; leave their responses to them.')
    expect(first).not.toContain('just spoke')
    expect(last).toContain('Ivo Brand and Tobin Reed just spoke this beat. Hana Pike can respond to them as readily as to Wren Calloway.')
    expect(last).toContain('Never speak or act for Wren Calloway or any other carded character.')
    expect(gmDirectionFor(turn, 'Hana Pike', 'Wren Calloway')).not.toContain('just spoke')
  })
})
