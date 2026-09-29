import { describe, expect, it } from 'vitest'
import { STARTER_PBTA_CAMPAIGN, campaignFileFrom, parseCampaignFile, resolvePbtaRoll, type PbtaMove } from './campaign'
import {
  carryGameState,
  choiceEffectsText,
  effectsForChoice,
  effectsForRoll,
  effectsForSetEvent,
  effectsText,
  gameStateFrom,
  inferConditionEffects,
  normalizeEffects,
  normalizeGameState,
  normalizeMoveEffects,
  normalizeTracks,
  parseChoiceEffects,
  parseEffects,
  stateLines,
  appliedText,
  type CampaignTrack,
  type StateChange,
} from './gameState'
import type { RecordedMove } from './gm'

const tracks = STARTER_PBTA_CAMPAIGN.tracks!
const moves = STARTER_PBTA_CAMPAIGN.moves
const takeARisk = moves.find((m) => m.id === 'take-a-risk')!
const pushThrough = moves.find((m) => m.id === 'push-through')!
const people = [{ id: 'wren', name: 'Wren Calloway' }, { id: 'bea', name: 'Bea Holt' }, { id: 'cole', name: 'Cole Marsh' }]

/** A saved roll message as the server writes it: dice, outcome, and the move's effects for that tier. */
function rollMessage(id: string, move: PbtaMove, dice: [number, number], modifier = 0) {
  const resolved = resolvePbtaRoll(move, modifier, dice)
  const roll: RecordedMove = { ...resolved, id: `roll-${id}`, createdAt: 1, action: 'I go for it.' }
  const stateChanges = effectsForRoll(move, resolved.tier, roll.id, 'wren')
  return { id, campaignRoll: stateChanges.length ? { ...roll, stateChanges } : roll }
}

describe('roll effects', () => {
  it('apply what the move says for the recorded tier, and nothing on a clean success', () => {
    expect(effectsForRoll(takeARisk, 'strong', 'r1', 'wren')).toEqual([])
    expect(effectsForRoll(takeARisk, 'mixed', 'r1', 'wren')).toEqual([])
    expect(effectsForRoll(takeARisk, 'miss', 'r1', 'wren')).toEqual([{ trackId: 'trouble', delta: 1, who: 'wren', source: 'roll', rollId: 'r1' }])
    expect(effectsForRoll(pushThrough, 'miss', 'r2', 'wren')).toEqual([{ trackId: 'hurt', set: true, who: 'wren', source: 'roll', rollId: 'r2' }])
  })

  it('a miss applies its cost whatever the prose says, and a success leaves state alone', () => {
    const miss = rollMessage('m1', takeARisk, [1, 2])
    expect(miss.campaignRoll.tier).toBe('miss')
    expect(gameStateFrom(tracks, undefined, [miss]).state).toEqual({ trouble: 1 })
    const hit = rollMessage('m2', takeARisk, [6, 6])
    expect(hit.campaignRoll.tier).toBe('strong')
    expect(gameStateFrom(tracks, undefined, [hit]).state).toEqual({})
  })

  it('a chosen cost applies the option the player picked, to the player', () => {
    expect(effectsForChoice(pushThrough, ['spent'], 'r3', 'wren')).toEqual([{ trackId: 'supplies', delta: -1, who: 'wren', source: 'choice', rollId: 'r3' }])
    expect(effectsForChoice(pushThrough, ['Hurt.'], 'r3', 'wren')).toEqual([{ trackId: 'hurt', set: true, who: 'wren', source: 'choice', rollId: 'r3' }])
    expect(effectsForChoice(pushThrough, ['something else'], 'r3', 'wren')).toEqual([])
    expect(effectsForChoice(undefined, ['spent'], 'r3')).toEqual([])
  })
})

describe('gameStateFrom', () => {
  const mixed = rollMessage('m1', pushThrough, [4, 3])
  const choice = { id: 'm2', gm: { stateChanges: effectsForChoice(pushThrough, ['spent'], mixed.campaignRoll.id, 'wren') } }

  it('replays a roll, its chosen cost, and the player\'s corrections in order', () => {
    const edit: StateChange = { trackId: 'supplies', delta: 2, source: 'player' }
    const { state, log } = gameStateFrom(tracks, undefined, [mixed, choice, { id: 'm3', stateEdits: [edit] }], { playerId: 'wren' })
    expect(state).toEqual({ supplies: 3 })
    expect(log.map((entry) => appliedText(entry))).toEqual(['Supplies 3 → 2', 'Supplies 2 → 3'])
    expect(log.map((entry) => entry.messageId)).toEqual(['m2', 'm3'])
  })

  it('applies a roll or choice once however many messages carry it (a repeated submission)', () => {
    const miss = rollMessage('m1', takeARisk, [1, 1])
    const again = { ...miss, id: 'm1-copy' }
    expect(gameStateFrom(tracks, undefined, [miss, again]).state).toEqual({ trouble: 1 })
    const twice = { id: 'm4', gm: { stateChanges: choice.gm.stateChanges } }
    expect(gameStateFrom(tracks, undefined, [mixed, choice, twice]).state).toEqual({ supplies: 2 })
  })

  it('a rewind drops what came after the cut, and a fork keeps what came before it', () => {
    const branch = [mixed, choice, rollMessage('m5', takeARisk, [1, 1]), rollMessage('m6', pushThrough, [1, 1])]
    const full = gameStateFrom(tracks, { supplies: 3 }, branch, { playerId: 'wren' }).state
    expect(full).toEqual({ supplies: 2, trouble: 1, 'hurt@wren': true })
    // Rewind to the choice: the later rolls are gone.
    expect(gameStateFrom(tracks, { supplies: 3 }, branch.slice(0, 2), { playerId: 'wren' }).state).toEqual({ supplies: 2 })
    // A fork copies the messages up to its cut (new ids, same content) and lands on the same state.
    const forked = branch.slice(0, 3).map((m, i) => ({ ...m, id: `fork-${i}` }))
    expect(gameStateFrom(tracks, { supplies: 3 }, forked, { playerId: 'wren' }).state).toEqual({ supplies: 2, trouble: 1 })
  })

  it('applies a GM proposal\'s changes only once the player confirms it', () => {
    const proposal = (status: string) => ({ id: 'g', gm: { proposals: [{ status, changes: [{ trackId: 'hurt', set: true, who: 'bea' }] }] } })
    expect(gameStateFrom(tracks, undefined, [proposal('pending')]).state).toEqual({})
    expect(gameStateFrom(tracks, undefined, [proposal('rejected')]).state).toEqual({})
    expect(gameStateFrom(tracks, undefined, [proposal('confirmed')]).state).toEqual({ 'hurt@bea': true })
  })

  it('keeps values in range and skips tracks the world no longer has', () => {
    const edits: StateChange[] = [
      { trackId: 'supplies', delta: -9, source: 'player' },
      { trackId: 'trouble', delta: 9, source: 'player' },
      { trackId: 'gone', delta: 1, source: 'player' },
    ]
    expect(gameStateFrom(tracks, undefined, [{ stateEdits: edits }]).state).toEqual({ supplies: 0, trouble: 4 })
    expect(gameStateFrom(undefined, { supplies: 1 }, [{ stateEdits: edits }]).state).toEqual({ supplies: 1 })
  })

  it('keeps an item list without duplicates', () => {
    const gear: CampaignTrack = { id: 'gear', name: 'Gear', kind: 'items' }
    const edits: StateChange[] = [
      { trackId: 'gear', gain: 'rope', source: 'player' },
      { trackId: 'gear', gain: 'Rope', source: 'player' },
      { trackId: 'gear', gain: 'lantern', source: 'player' },
      { trackId: 'gear', lose: 'ROPE', source: 'player' },
    ]
    expect(gameStateFrom([gear], undefined, [{ stateEdits: edits }]).state).toEqual({ gear: ['lantern'] })
  })
})

describe('carryGameState', () => {
  it('carries values into the next scene but empties per-scene clocks', () => {
    expect(carryGameState({ supplies: 1, trouble: 3, 'hurt@wren': true, gone: 2 }, tracks)).toEqual({ supplies: 1, 'hurt@wren': true })
    expect(carryGameState({ trouble: 3 }, tracks)).toBeUndefined()
  })
})

describe('set events', () => {
  it('use their own effects, or put on conditions their consequence names', () => {
    expect(effectsForSetEvent({ id: 'e1', effects: [{ trackId: 'supplies', delta: -2 }] }, tracks, people, 'wren'))
      .toEqual([{ trackId: 'supplies', delta: -2, who: 'wren', source: 'set_event', setEventId: 'e1' }])
    expect(effectsForSetEvent({ id: 'e2', consequence: 'Bea is hurt in the fall.' }, tracks, people, 'wren'))
      .toEqual([{ trackId: 'hurt', set: true, who: 'bea', source: 'set_event', setEventId: 'e2' }])
  })

  it('never infers an amount, or a condition the consequence clears', () => {
    const strained: CampaignTrack = { id: 'strained', name: 'Strained', kind: 'condition', perCharacter: true }
    expect(inferConditionEffects('Cole is strained.', [strained], people)).toEqual([{ trackId: 'strained', set: true, who: 'cole' }])
    expect(inferConditionEffects('Cole is no longer strained.', [strained], people)).toEqual([])
    expect(inferConditionEffects('Supplies run low.', tracks, people)).toEqual([])
  })

  it('apply once per branch', () => {
    const changes = effectsForSetEvent({ id: 'e3', effects: [{ trackId: 'supplies', delta: -1 }] }, tracks, people)
    expect(gameStateFrom(tracks, undefined, [{ gm: { stateChanges: changes } }, { gm: { stateChanges: changes } }]).state).toEqual({ supplies: 2 })
  })
})

describe('effect text', () => {
  const gear: CampaignTrack = { id: 'gear', name: 'Gear', kind: 'items' }
  const all = [...tracks, gear]

  it('reads the short form and writes it back', () => {
    const parsed = parseEffects('Supplies -1, Hurt on for Bea, Trouble = 2, Gear + rope, Gear - old map', all, people)
    expect(parsed.errors).toEqual([])
    expect(parsed.effects).toEqual([
      { trackId: 'supplies', delta: -1 },
      { trackId: 'hurt', set: true, who: 'bea' },
      { trackId: 'trouble', set: 2 },
      { trackId: 'gear', gain: 'rope' },
      { trackId: 'gear', lose: 'old map' },
    ])
    expect(effectsText(parsed.effects, all, people)).toBe('Supplies -1, Hurt on for Bea Holt, Trouble = 2, Gear + rope, Gear - old map')
  })

  it('reports what it cannot read instead of guessing', () => {
    const parsed = parseEffects('Stamina -1, Hurt a lot, Supplies -1 for Bea, Hurt on for Zed', all, people)
    expect(parsed.effects).toEqual([])
    expect(parsed.errors).toHaveLength(4)
  })

  it('reads choice costs by option', () => {
    const parsed = parseChoiceEffects('hurt: Hurt on; spent: Supplies -1; nothing here', tracks)
    expect(parsed.choiceEffects).toEqual([
      { option: 'hurt', effects: [{ trackId: 'hurt', set: true }] },
      { option: 'spent', effects: [{ trackId: 'supplies', delta: -1 }] },
    ])
    expect(parsed.errors).toHaveLength(1)
    expect(choiceEffectsText(pushThrough.choiceEffects, tracks)).toBe('hurt: Hurt on; spent: Supplies -1; noticed: Trouble +1')
  })
})

describe('stateLines', () => {
  const state = { supplies: 2, trouble: 4, 'hurt@wren': true, 'hurt@bea': true }
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name

  it('shows the GM everything, including a full clock', () => {
    expect(stateLines(state, tracks, { audience: 'gm', playerId: 'wren', nameOf })).toEqual([
      'Hurt: Wren Calloway, Bea Holt',
      'Supplies: 2/3',
      'Trouble clock: 4/4 (full: what it counts toward happens now)',
    ])
  })

  it('shows a character the story-wide tracks and only their own condition', () => {
    expect(stateLines(state, tracks, { audience: { characterId: 'bea' }, playerId: 'wren', nameOf })).toEqual(['Hurt: Bea Holt', 'Supplies: 2/3'])
    expect(stateLines(state, tracks, { audience: { characterId: 'cole' }, playerId: 'wren', nameOf })).toEqual(['Supplies: 2/3'])
  })
})

describe('normalizing saved rules', () => {
  it('keeps valid tracks and drops the rest', () => {
    expect(normalizeTracks([
      { name: 'Supplies', kind: 'resource', max: 3, start: 9 },
      { name: 'supplies', kind: 'resource' },
      { name: 'Threat', kind: 'clock', perScene: true, gmOnly: true },
      { name: 'Worn', kind: 'condition', perCharacter: true, perScene: true },
      { name: '' },
      'nonsense',
    ])).toEqual([
      { id: 'supplies', name: 'Supplies', kind: 'resource', max: 3 },
      { id: 'threat', name: 'Threat', kind: 'clock', max: 4, perScene: true, gmOnly: true },
      { id: 'worn', name: 'Worn', kind: 'condition', perCharacter: true },
    ])
  })

  it('keeps effects that do something', () => {
    expect(normalizeEffects([{ trackId: 'a', delta: 1 }, { trackId: 'b' }, { delta: 1 }, { trackId: 'c', set: true, who: 'bea' }]))
      .toEqual([{ trackId: 'a', delta: 1 }, { trackId: 'c', set: true, who: 'bea' }])
    expect(normalizeMoveEffects({ effects: { miss: [{ trackId: 'a', delta: 1 }], strong: [] }, choiceEffects: [{ option: 'x', effects: [] }] }))
      .toEqual({ effects: { miss: [{ trackId: 'a', delta: 1 }] } })
    expect(normalizeGameState({ a: 2, b: true, c: ['rope', 3], d: -1, e: 'x' })).toEqual({ a: 2, b: true, c: ['rope'] })
  })

  it('travels in a campaign file', () => {
    const parsed = parseCampaignFile(campaignFileFrom({ ...STARTER_PBTA_CAMPAIGN, mode: 'mechanical' }))
    expect(parsed.tracks).toEqual(STARTER_PBTA_CAMPAIGN.tracks)
    expect(parsed.moves.find((m) => m.id === 'push-through')).toEqual(pushThrough)
  })
})
