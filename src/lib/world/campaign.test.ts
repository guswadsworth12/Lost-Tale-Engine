import { describe, expect, it } from 'vitest'
import { STARTER_PBTA_CAMPAIGN, campaignFileFrom, campaignPrompt, formatPbtaRoll, parseCampaignFile, resolvePbtaRoll } from './campaign'

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
