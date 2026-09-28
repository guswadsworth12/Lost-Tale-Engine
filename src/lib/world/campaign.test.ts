import { describe, expect, it } from 'vitest'
import { STARTER_PBTA_CAMPAIGN, campaignFileFrom, campaignPrompt, campaignStats, formatPbtaRoll, normalizeCharacterSheet, parseCampaignFile, resolvePbtaRoll, sheetModifier, statForMove } from './campaign'

describe('campaign prompt emphasis', () => {
  it('keeps focus guidance and leaves natural/off turns free of campaign romance steering', () => {
    const dating = { ...STARTER_PBTA_CAMPAIGN, relationships: true, dating: true }
    expect(campaignPrompt(dating, 'focus')).toContain('Dating can arise from character choices')
    expect(campaignPrompt(dating, 'natural')).not.toMatch(/Dating can arise|Romance may occur/)
    expect(campaignPrompt({ ...dating, dating: false }, 'off')).not.toMatch(/Dating can arise|Romance may occur/)
  })
})

describe('PbtA move resolver', () => {
  const move = STARTER_PBTA_CAMPAIGN.moves[0]

  it('uses the recorded dice and modifier for each PbtA result tier', () => {
    expect(resolvePbtaRoll(move, 2, [6, 2])).toMatchObject({ total: 10, tier: 'strong', outcome: move.strong })
    expect(resolvePbtaRoll(move, 0, [4, 3])).toMatchObject({ total: 7, tier: 'mixed', outcome: move.mixed })
    expect(resolvePbtaRoll(move, -1, [3, 4])).toMatchObject({ total: 6, tier: 'miss', outcome: move.miss })
  })

  it('rejects impossible dice and writes an auditable story turn', () => {
    expect(() => resolvePbtaRoll(move, 0, [0, 6])).toThrow()
    expect(formatPbtaRoll({ ...resolvePbtaRoll(move, 2, [6, 2]), id: 'roll-1', createdAt: 1 }, 'Shield Hana'))
      .toContain('Dice: 6 + 2 + 2 Nerve = 10 (10+ strong hit)')
  })
})

describe('campaign character sheets', () => {
  it('links starter moves to stable sheet stats and uses the saved modifier', () => {
    const move = STARTER_PBTA_CAMPAIGN.moves[0]
    expect(statForMove(STARTER_PBTA_CAMPAIGN, move)).toMatchObject({ id: 'nerve', name: 'Nerve' })
    expect(sheetModifier(STARTER_PBTA_CAMPAIGN, move, { stats: { nerve: 2 } })).toBe(2)
    expect(sheetModifier(STARTER_PBTA_CAMPAIGN, move, { stats: {} })).toBeUndefined()
    expect(sheetModifier(STARTER_PBTA_CAMPAIGN, move, { stats: { nerve: 8 } })).toBeUndefined()
  })

  it('derives fields for old worlds and cleans invalid imported sheet values', () => {
    const legacy = { ...STARTER_PBTA_CAMPAIGN, stats: undefined, moves: STARTER_PBTA_CAMPAIGN.moves.map(({ statId: _id, ...move }) => move) }
    expect(campaignStats(legacy).map((stat) => stat.id)).toEqual(['legacy:nerve', 'legacy:wits', 'legacy:heart', 'legacy:grit'])
    expect(sheetModifier(legacy, legacy.moves[0], { stats: { 'legacy:nerve': -1 } })).toBe(-1)
    expect(normalizeCharacterSheet({ stats: { nerve: 2, bad: 9, fraction: 1.5 } })).toEqual({ stats: { nerve: 2 } })
  })
})

describe('campaign files', () => {
  it('round-trips a campaign and validates what comes back in', () => {
    const custom = { ...STARTER_PBTA_CAMPAIGN, ruleset: 'My Setting', mode: 'mechanical' as const }
    expect(parseCampaignFile(campaignFileFrom(custom))).toEqual(custom)
    expect(parseCampaignFile(JSON.stringify({ ruleset: 'Bare', moves: [{ name: 'Go' }, { trigger: 'no name' }], dating: true })))
      .toMatchObject({ ruleset: 'Bare', mode: 'guided', dating: false, moves: [{ id: 'move-1', name: 'Go' }] })
    expect(() => parseCampaignFile('not json')).toThrow('not valid JSON')
    expect(() => parseCampaignFile('{"ruleset":"x"}')).toThrow('"moves"')
  })
})
