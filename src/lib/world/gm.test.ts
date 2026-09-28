import { describe, expect, it } from 'vitest'
import { CAMPAIGN_PRESETS, STARTER_PBTA_CAMPAIGN, resolvePbtaRoll } from './campaign'
import {
  branchConsequencesFrom,
  buildGmPrompt,
  formatGmMessage,
  earlierRollFrom,
  gmDirectionFor,
  grantedQuestions,
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

  it('does not delay an established discovery or reroll questions earned on a strong hit', () => {
    const { system } = buildGmPrompt(ctx({ recordedMove: mixedRoll }))
    expect(system).toContain('Established conditions are true when the player checks them')
    expect(system).toContain('never conceal it to preserve a planned reveal')
    expect(system).toContain('answer the player’s questions from that result without demanding another roll')
  })

  it('carries the story state and asks the GM to present a next situation after a scene pays off', () => {
    const { system, user } = buildGmPrompt(ctx({
      storySoFar: 'The party returned home.',
      openThreads: ['A bridge report has not been checked.'],
      activeObjective: 'Check the bridge — speak with the ferryman',
    }))
    expect(system).toContain('When a scene has paid off, close it or move to a concrete next situation')
    expect(system).toContain('do not wait for the player to invent every lead')
    expect(user).toContain('Story so far: The party returned home.')
    expect(user).toContain('Open threads:\n- A bridge report has not been checked.')
    expect(user).toContain('Current objective: Check the bridge — speak with the ferryman')
  })
})

describe('Game Master decision validation', () => {
  it('records the GM difficulty before a d20 roll and rejects a missing difficulty', () => {
    const campaign = CAMPAIGN_PRESETS.find((entry) => entry.id === 'dnd-5-2')!.campaign
    const input = (target?: number) => JSON.stringify({ narration: 'The gate opens.', pacing: 'advance', speakers: [],
      adjudication: { action: 'lift gate', move: campaign.moves[0].name, target, tier: 'strong', outcome: 'It opens.' } })
    const ready = parseGmTurn(input(20), ctx({ campaign }), ids)
    expect(ready.adjudication).toMatchObject({ source: 'roll_needed', target: 20, moveId: campaign.moves[0].id })
    expect(ready.narration).toBe('')
    const missing = parseGmTurn(input(), ctx({ campaign }), ids)
    expect(missing.fallback).toContain('without setting a difficulty')
    expect(missing.adjudication).toBeUndefined()
  })

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
    const raw = JSON.stringify({
      narration: 'The door opens and the party escapes.', pacing: 'cut', speakers: ['Hana Pike'],
      addCharacters: ['Mira Vale'], fork: { title: 'Escape', reason: 'The door opened.' },
      setting: { location: 'Outside' }, proposals: [{ scope: 'world', text: 'The party escaped.' }],
      adjudication: { action: 'force the door', move: 'Take a Risk', tier: 'strong', outcome: 'You escape.' },
    })
    const turn = parseGmTurn(raw, ctx({ availableRoster: [{ id: 'mira', name: 'Mira Vale' }] }), ids)
    expect(turn.adjudication).toMatchObject({ source: 'roll_needed', moveId: 'take-a-risk' })
    expect(turn.adjudication?.action).toBe('I throw a ward over Hana.')
    expect(turn.adjudication?.tier).toBeUndefined()
    expect(turn).toMatchObject({ narration: '', pacing: 'linger', speakerIds: [], proposals: [] })
    expect(turn.addCharacterIds).toBeUndefined()
    expect(turn.fork).toBeUndefined()
    expect(turn.setting).toBeUndefined()
    expect(formatGmMessage(turn)).not.toContain('escapes')
  })

  it('makes a recorded miss the only action result, even when the model claims success', () => {
    const miss: RecordedMove = { ...resolvePbtaRoll(move, 0, [1, 2]), id: 'roll-miss', createdAt: 2, action: 'I force the door.' }
    const raw = JSON.stringify({
      narration: 'The door opens and the party escapes.', pacing: 'cut', speakers: ['Hana Pike'],
      addCharacters: ['Mira Vale'], fork: { title: 'Escape', reason: 'The party got out.' },
      setting: { location: 'Outside' }, proposals: [{ scope: 'world', text: 'The party escaped.' }],
      adjudication: { action: 'force the door', move: 'Take a Risk', tier: 'strong', outcome: 'You escape.' },
    })
    const turn = parseGmTurn(raw, ctx({ recordedMove: miss, availableRoster: [{ id: 'mira', name: 'Mira Vale' }] }), ids)
    expect(turn.adjudication).toMatchObject({ source: 'recorded_roll', tier: 'miss', total: 3, outcome: move.miss })
    expect(turn).toMatchObject({ narration: '', pacing: 'linger', proposals: [] })
    expect(turn.addCharacterIds).toBeUndefined()
    expect(turn.fork).toBeUndefined()
    expect(turn.setting).toBeUndefined()
    const publicText = formatGmMessage(turn)
    expect(publicText).toContain('Failed check')
    expect(publicText).toContain(move.miss)
    expect(publicText).not.toContain('door opens')
    expect(publicText).not.toContain('party escaped')
    expect(gmDirectionFor(turn, 'Hana Pike', 'Wren Calloway')).toContain('The check failed. Apply only the recorded miss outcome')
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

  it('pauses an unrolled mechanical action when the GM response is unusable', () => {
    for (const raw of [
      'The ward succeeds.',
      '{"adjudication":{"action":"ward","move":"Unknown Move","outcome":"It succeeds."},"speakers":["Hana"]}',
    ]) {
      const turn = parseGmTurn(raw, ctx(), ids)
      expect(turn.fallback).toBeTruthy()
      expect(turn.speakerIds).toEqual([])
      expect(turn.adjudication).toBeUndefined()
      expect(formatGmMessage(turn)).toContain('Retry the ruling or withdraw')
    }
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
    // The arrival answers in the same beat, after whoever the GM listed.
    expect(turn.speakerIds).toEqual(['hana', 'mira'])
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

describe('questions earned by an earlier roll', () => {
  const read = { ...STARTER_PBTA_CAMPAIGN.moves[0], id: 'read', name: 'Read the Threads', mixed: 'Ask one useful question; the GM also reveals a complication.' }
  const campaign = { ...STARTER_PBTA_CAMPAIGN, mode: 'mechanical' as const, moves: [read, ...STARTER_PBTA_CAMPAIGN.moves] }
  const rolled = (tier: 'strong' | 'mixed' | 'miss', outcome: string, rollId = 'r1') => ({
    gm: { adjudication: { action: 'I read the marks.', source: 'recorded_roll' as const, moveId: 'read', moveName: 'Read the Threads', tier, total: 8, rollId, outcome } },
  }) as never
  const followUp = (rollId = 'r1') => ({ gm: { adjudication: { action: 'q', source: 'recorded_roll' as const, followUp: true, rollId, outcome: 'answer' } } }) as never

  it('reads how many questions an outcome grants', () => {
    expect(grantedQuestions('Ask one useful question; the GM also reveals a complication.')).toBe(1)
    expect(grantedQuestions('Ask 3 questions from the list.')).toBe(3)
    expect(grantedQuestions('ask two good questions')).toBe(2)
    expect(grantedQuestions('You learn something troubling.')).toBe(0)
  })

  it('keeps an allowance open until it is used, never for a miss, and only for recent rolls', () => {
    const hit = rolled('mixed', 'Ask one useful question; the GM also reveals a complication.')
    expect(earlierRollFrom([hit])).toMatchObject({ moveName: 'Read the Threads', granted: 1, remaining: 1 })
    expect(earlierRollFrom([hit, followUp()])).toBeUndefined()
    expect(earlierRollFrom([rolled('miss', 'Ask one question anyway.')])).toBeUndefined()
    expect(earlierRollFrom([hit, ...Array.from({ length: 10 }, () => ({}) as never)])).toBeUndefined()
  })

  it('answers the earned question without new dice when the GM marks it as a follow-up', () => {
    const earlierRoll = earlierRollFrom([rolled('mixed', 'Ask one useful question; the GM also reveals a complication.')])
    const turn = parseGmTurn(JSON.stringify({
      narration: 'The scraped glyphs show no spellwork at all.',
      adjudication: { action: 'Is it magical?', move: 'Read the Threads', followUp: true, outcome: 'Not magical: physical tampering.' },
    }), ctx({ campaign, earlierRoll, roster: [], playerAction: 'Can I tell if the interference is magical?' }), ids)
    expect(turn.adjudication).toMatchObject({ source: 'recorded_roll', followUp: true, rollId: 'r1', outcome: 'Not magical: physical tampering.' })
    expect(formatGmMessage(turn)).toContain('question from the earlier 7–9 mixed hit (8)')
  })

  it('accepts the earlier result when the GM reuses its tier instead of discarding it for a new roll', () => {
    const earlierRoll = earlierRollFrom([rolled('mixed', 'Ask one useful question; the GM also reveals a complication.')])
    const turn = parseGmTurn(JSON.stringify({
      adjudication: { action: 'Is it magical?', move: 'Read the Threads', tier: 'mixed', outcome: 'It is not magical.' },
    }), ctx({ campaign, earlierRoll, roster: [] }), ids)
    expect(turn.adjudication).toMatchObject({ source: 'recorded_roll', followUp: true })
    expect(turn.corrections?.join(' ')).toContain('Answered from the earlier Read the Threads roll')
  })

  it('still asks for a roll when no earlier result covers the question', () => {
    const turn = parseGmTurn(JSON.stringify({
      adjudication: { action: 'Is it magical?', move: 'Read the Threads', tier: 'mixed', outcome: 'It is not magical.' },
    }), ctx({ campaign, roster: [] }), ids)
    expect(turn.adjudication?.source).toBe('roll_needed')
  })

  it('tells the GM about the open allowance', () => {
    const earlierRoll = earlierRollFrom([rolled('mixed', 'Ask one useful question; the GM also reveals a complication.')])
    const { user } = buildGmPrompt(ctx({ campaign, earlierRoll }))
    expect(user).toContain('Earlier roll still in effect: Read the Threads')
    expect(user).toContain('Questions left: 1')
  })
})

describe('bringing characters into the scene', () => {
  const available = [{ id: 'mae', name: 'Mae Rook' }, { id: 'avi', name: 'Avi Pyre' }]

  it('lets a character the GM adds answer in the same beat when nobody else is here', () => {
    const turn = parseGmTurn(JSON.stringify({ narration: '', addCharacters: ['Mae Rook'], speakers: [] }),
      ctx({ roster: [], availableRoster: available, playerAction: 'I call Mae through the link.' }), ids)
    expect(turn.addCharacterIds).toEqual(['mae'])
    expect(turn.speakerIds).toEqual(['mae'])
  })

  it('brings in the character the player addressed when the GM added nobody and nobody is here', () => {
    const turn = parseGmTurn(JSON.stringify({ narration: '', speakers: [] }),
      ctx({ roster: [], availableRoster: [...available].reverse(), playerAction: 'I call Mae. "Mae, meet me at the aqueduct and bring Avi."' }), ids)
    expect(turn.addCharacterIds).toEqual(['mae'])
    expect(turn.speakerIds).toEqual(['mae'])
    expect(turn.corrections?.join(' ')).toContain('Brought in Mae Rook')
  })

  it('tells an arriving character to answer the way the player reached them, not to report others', () => {
    const turn = parseGmTurn(JSON.stringify({ addCharacters: ['Mae Rook'], speakers: [] }),
      ctx({ roster: [], availableRoster: available, playerAction: 'I call Mae through the link.' }), ids)
    const direction = gmDirectionFor(turn, 'Mae Rook', 'Wren Calloway', ['Mae Rook'], true)
    expect(direction).toContain('reply from wherever Mae Rook is instead of appearing in person')
    expect(direction).toContain('does not know where anyone else is')
    expect(gmDirectionFor(turn, 'Mae Rook', 'Wren Calloway', ['Mae Rook'])).not.toContain('drawn into this scene')
  })

  it('does not pull someone in when a present character can answer', () => {
    const turn = parseGmTurn(JSON.stringify({ narration: '', speakers: [] }),
      ctx({ availableRoster: available, playerAction: '"Mae would love this," I tell Hana.' }), ids)
    expect(turn.addCharacterIds).toBeUndefined()
    expect(turn.speakerIds).toEqual(['hana'])
  })
})

describe('rank scaling', () => {
  const ranked = { ...STARTER_PBTA_CAMPAIGN, mode: 'mechanical' as const, ranks: [
    { name: 'Novice' }, { name: 'Adept' }, { name: 'Master' }, { name: 'Legend', note: 'exceptional status, not a rung' },
  ] }

  it('gives the GM the ladder, the scale rule, and everyone\'s rank', () => {
    const { system, user } = buildGmPrompt(ctx({
      campaign: ranked,
      playerRank: 'Legend',
      roster: [{ id: 'ivo', name: 'Ivo Brand', occupation: 'lamplighter', rank: 'Novice' }],
    }))
    expect(system).toContain('Rank ladder, lowest to highest: Novice → Adept → Master → Legend (exceptional status, not a rung).')
    expect(system).toContain('Something well within that rank is routine: no roll')
    expect(system).toContain('not a plain roll')
    expect(user).toContain('Wren Calloway\'s rank: Legend')
    expect(user).toContain('- Ivo Brand (rank: Novice; lamplighter)')
  })

  it('adds nothing when the world has no ladder', () => {
    const { system, user } = buildGmPrompt(ctx())
    expect(system).not.toContain('Rank ladder')
    expect(user).not.toContain('rank:')
  })
})
