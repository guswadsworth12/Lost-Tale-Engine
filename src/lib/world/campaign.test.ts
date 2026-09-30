import { describe, expect, it } from 'vitest'
import { CAMPAIGN_PRESETS, DEFAULT_CAMPAIGN, STARTER_PBTA_CAMPAIGN, campaignFileFrom, campaignPrompt, campaignStats, formatPbtaRoll, normalizeCampaignRanks, normalizeCharacterSheet, normalizeCharacterSheets, parseCampaignFile, resolveCampaignRoll, resolveCustomCampaignRoll, resolvePbtaRoll, scaleGuidance, sheetForWorld, sheetModifier, statForMove } from './campaign'

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
    expect(normalizeCharacterSheet({ stats: { nerve: 2, otherSystemRating: 9, fraction: 1.5 } })).toEqual({ stats: { nerve: 2, otherSystemRating: 9 } })
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

describe('portable sheets and core check resolvers', () => {
  const preset = (id: string) => CAMPAIGN_PRESETS.find((entry) => entry.id === id)!.campaign

  it('keeps separate sheets for worlds and derives a d20 modifier from an ability score', () => {
    const character = { worldId: 'old', sheet: { worldId: 'old', stats: { nerve: 2 } }, sheets: { new: { worldId: 'new', stats: { strength: 18 } } } }
    expect(sheetForWorld(character, 'old')?.stats.nerve).toBe(2)
    expect(sheetForWorld(character, 'new')?.stats.strength).toBe(18)
    expect(sheetModifier(preset('dnd-5-2'), preset('dnd-5-2').moves[0], sheetForWorld(character, 'new'))).toBe(4)
    expect(normalizeCharacterSheets({ new: { stats: { strength: 18, invalid: 101 } } })).toEqual({ new: { worldId: 'new', stats: { strength: 18 } } })
  })

  it('resolves a d20 check against its DC without automatic success on a natural 20', () => {
    const campaign = preset('dnd-5-2')
    const move = campaign.moves[0]
    expect(resolveCampaignRoll(campaign, move, -10, [20], 15)).toMatchObject({ total: 10, target: 15, tier: 'miss', degree: 'failure' })
    expect(resolveCampaignRoll(campaign, move, 4, [6], 10)).toMatchObject({ total: 10, tier: 'strong', degree: 'success' })
    expect(resolveCampaignRoll(campaign, move, 4, [2, 19], 20, 'advantage')).toMatchObject({ natural: 19, total: 23, degree: 'success' })
  })

  it('uses four degrees and natural die shifts for Starfinder 2e checks', () => {
    const campaign = preset('starfinder-2')
    const move = campaign.moves[0]
    expect(resolveCampaignRoll(campaign, move, 0, [20], 25)).toMatchObject({ total: 20, degree: 'success', tier: 'strong' })
    expect(resolveCampaignRoll(campaign, move, 0, [1], 5)).toMatchObject({ total: 1, degree: 'critical failure', tier: 'miss' })
  })

  it('records Fate ties and 3d6 roll-under failures explicitly', () => {
    const fate = preset('fate-core')
    expect(resolveCampaignRoll(fate, fate.moves[0], 2, [1, -1, 0, 0], 2)).toMatchObject({ total: 2, degree: 'tie', tier: 'mixed' })
    const under = preset('roll-under')
    expect(resolveCampaignRoll(under, under.moves[0], 12, [6, 6, 6])).toMatchObject({ total: 18, target: 12, degree: 'critical failure', tier: 'miss' })
    expect(resolveCampaignRoll(under, under.moves[0], 12, [2, 3, 4])).toMatchObject({ total: 9, degree: 'success', tier: 'strong' })
  })
})

describe('rank ladders', () => {
  it('keeps named, unique ranks in order, with optional notes', () => {
    expect(normalizeCampaignRanks(['Novice', { name: 'Adept' }, { name: 'novice' }, { name: '' }, { name: 'Legend', note: ' beyond the ladder ' }])).toEqual([
      { name: 'Novice' }, { name: 'Adept' }, { name: 'Legend', note: 'beyond the ladder' },
    ])
    expect(normalizeCampaignRanks('nope')).toBeUndefined()
  })

  it('keeps a character sheet rank', () => {
    expect(normalizeCharacterSheet({ worldId: 'w', rank: ' Adept ', stats: { might: 2 } })).toEqual({ worldId: 'w', rank: 'Adept', stats: { might: 2 } })
  })

  it('survives a campaign file round trip', () => {
    const file = campaignFileFrom({ ruleset: 'Custom', mode: 'mechanical', resolver: 'pbta', relationships: false, dating: false, moves: [{ id: 'm', name: 'Act', trigger: 'you act', stat: 'Might', strong: 's', mixed: 'm', miss: 'x' }], ranks: [{ name: 'Novice' }, { name: 'Master' }] })
    expect(parseCampaignFile(file).ranks).toEqual([{ name: 'Novice' }, { name: 'Master' }])
  })

  it('writes a scale rule only when there is a ladder', () => {
    const base = { ruleset: 'Custom', mode: 'mechanical' as const, resolver: 'pbta' as const, relationships: false, dating: false, moves: [] }
    expect(scaleGuidance(base)).toBe('')
    expect(scaleGuidance({ ...base, ranks: [{ name: 'Novice' }, { name: 'Master' }] })).toContain('Novice → Master')
  })
})

describe('a custom ruleset', () => {
  const custom = {
    dice: { count: 0, sides: 6, pool: true, emptyPool: 2, keep: { which: 'highest' as const, count: 1 } },
    compare: 'result' as const,
    bands: [
      { label: 'Full success', tier: 'strong' as const, min: 6 },
      { label: 'Partial', tier: 'mixed' as const, min: 4, max: 5, meaning: 'There is a consequence.' },
      { label: 'Bad outcome', tier: 'miss' as const, max: 3 },
    ],
  }
  const config = { ...DEFAULT_CAMPAIGN, mode: 'mechanical' as const, resolver: 'custom' as const, custom }
  const move = { id: 'skirmish', name: 'Skirmish', trigger: 'you fight', stat: 'Skirmish', strong: 'You win the exchange.', mixed: 'You win, but pay for it.', miss: 'You are driven back.' }
  const faces = (...values: number[]) => () => values.shift()!

  it('records the band as the degree and its tier, with the band meaning ahead of the move text', () => {
    expect(resolveCustomCampaignRoll(config, move, 2, undefined, faces(5, 1))).toMatchObject({
      resolver: 'custom', dice: [5, 1], total: 5, tier: 'mixed', degree: 'Partial',
      outcome: 'There is a consequence. You win, but pay for it.', detail: expect.stringContaining('2d6: 5, 1'),
    })
  })

  it('needs a difficulty only when outcomes read the margin', () => {
    const margin = { ...config, custom: { ...custom, compare: 'margin' as const, bands: [{ label: 'Miss', tier: 'miss' as const, max: -1 }, { label: 'Hit', tier: 'strong' as const, min: 0 }] } }
    expect(() => resolveCustomCampaignRoll(margin, move, 2, undefined, faces(5, 1))).toThrow(/difficulty/)
    expect(resolveCustomCampaignRoll(margin, move, 2, 4, faces(5, 1))).toMatchObject({ target: 4, tier: 'strong', degree: 'Hit' })
  })

  it('travels in a campaign file, and a broken one says what to fix', () => {
    expect(parseCampaignFile(campaignFileFrom({ ...config, moves: [move] }))).toMatchObject({ resolver: 'custom', custom })
    expect(() => parseCampaignFile(JSON.stringify({ resolver: 'custom', custom: { ...custom, bands: [custom.bands[0]] }, moves: [] }))).toThrow(/Give 2 to 12 outcomes/)
  })
})
