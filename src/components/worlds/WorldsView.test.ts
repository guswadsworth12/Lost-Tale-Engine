import { describe, expect, it } from 'vitest'
import { CAMPAIGN_PRESETS, DEFAULT_CAMPAIGN, STARTER_PBTA_CAMPAIGN, statForMove } from '@/lib/world/campaign'
import { modulesForWorld } from '@/lib/world/worldTemplates'
import { WORLD_TAB_ALIASES } from '@/lib/ui/navigation'
import { changeWorldModule, initialWorldEditorModules, loadCampaignPreset, setCampaignSheetStats, worldEditorTabs } from './WorldsView'

describe('world editor modules', () => {
  it('keeps a campaign-less legacy world’s effective modules when opened and saved', () => {
    const legacy = { template: 'dating_sim' as const }
    const initial = initialWorldEditorModules(legacy)
    expect(modulesForWorld({ ...legacy, ...initial })).toEqual(modulesForWorld(legacy))
    expect(initial.modules.campaignRules).toBe(false)
    expect(initial.campaign).toMatchObject({ relationships: true, dating: true })

    const explicitOff = { template: 'dating_sim' as const, modules: { dating: false } }
    expect(modulesForWorld({ ...explicitOff, ...initialWorldEditorModules(explicitOff) })).toEqual(modulesForWorld(explicitOff))
  })

  it('shows only the tabs supported by effective modules and keeps canon accessible', () => {
    const off = modulesForWorld({ template: 'freeform', campaign: DEFAULT_CAMPAIGN, modules: { campaignRules: false } })
    expect(worldEditorTabs(off, 2)).toEqual([
      { id: 'overview', label: 'Overview' },
      { id: 'canon', label: 'Canon', badge: 2 },
      { id: 'locations', label: 'Locations' },
      { id: 'advanced', label: 'Advanced' },
    ])
    const focus = modulesForWorld({ template: 'dating_sim', campaign: { ...DEFAULT_CAMPAIGN, relationships: true, dating: true } })
    expect(worldEditorTabs(focus, 0).map((tab) => tab.id)).toEqual([
      'overview', 'story-rules', 'canon', 'locations', 'simulation', 'relationships', 'presentation', 'advanced',
    ])
    expect(WORLD_TAB_ALIASES.dating).toBe('relationships')
  })

  it('synchronizes campaign flags while retaining authored settings', () => {
    const campaign = { ...DEFAULT_CAMPAIGN, relationships: true, dating: true, moves: [{ id: 'move', name: 'Move', trigger: '', stat: '', strong: '', mixed: '', miss: '' }] }
    const disabled = changeWorldModule({}, campaign, 'relationships', false)
    expect(disabled.modules).toMatchObject({ relationships: false, dating: false })
    expect(disabled.campaign).toMatchObject({ relationships: false, dating: false, moves: campaign.moves })
    const reenabled = changeWorldModule(disabled.modules, disabled.campaign, 'relationships', true)
    expect(modulesForWorld({ template: 'dating_sim', campaign: reenabled.campaign, modules: reenabled.modules }).dating).toBe(false)
    expect(changeWorldModule(reenabled.modules, reenabled.campaign, 'dating', true).campaign.dating).toBe(true)
    expect(changeWorldModule({}, campaign, 'campaignRules', false).campaign.mode).toBe(campaign.mode)
    expect(changeWorldModule({}, campaign, 'campaignRules', 'mechanical').campaign.mode).toBe('mechanical')
  })

  it('turns legacy move labels into stable sheet references and keeps them synced on rename or removal', () => {
    const legacy = { ...DEFAULT_CAMPAIGN, moves: [
      { id: 'a', name: 'Act', trigger: '', stat: 'Nerve', strong: '', mixed: '', miss: '' },
      { id: 'b', name: 'React', trigger: '', stat: 'nerve', strong: '', mixed: '', miss: '' },
    ] }
    const named = setCampaignSheetStats(legacy, [{ id: 'legacy:nerve', name: 'Resolve' }])
    expect(named.moves.map((move) => [move.statId, move.stat])).toEqual([
      ['legacy:nerve', 'Resolve'], ['legacy:nerve', 'Resolve'],
    ])
    expect(statForMove(named, named.moves[0])?.name).toBe('Resolve')

    const removed = setCampaignSheetStats(named, [])
    expect(removed.moves.map((move) => [move.statId, move.stat])).toEqual([[undefined, ''], [undefined, '']])
    expect(statForMove(removed, removed.moves[0])).toBeUndefined()
  })

  it('preserves starter stat ids when renaming a sheet field', () => {
    const renamed = setCampaignSheetStats(STARTER_PBTA_CAMPAIGN, STARTER_PBTA_CAMPAIGN.stats!.map((stat) =>
      stat.id === 'nerve' ? { ...stat, name: 'Bravery' } : stat))
    expect(renamed.moves[0]).toMatchObject({ statId: 'nerve', stat: 'Bravery' })
    expect(renamed.moves[1]).toMatchObject({ statId: 'wits', stat: 'Wits' })
  })

  it('loads a distinct ruleset sheet without changing relationship settings or sharing preset arrays', () => {
    const preset = CAMPAIGN_PRESETS.find((entry) => entry.campaign.resolver === 'd20')!
    const current = { ...DEFAULT_CAMPAIGN, relationships: true, dating: true }
    const loaded = loadCampaignPreset(current, preset.campaign)
    expect(loaded).toMatchObject({ resolver: 'd20', relationships: true, dating: true })
    expect(loaded.stats?.[0]).toMatchObject({ valueMode: 'ability' })
    expect(loaded.stats).not.toBe(preset.campaign.stats)
    expect(loaded.stats?.[0]).not.toBe(preset.campaign.stats?.[0])
    expect(loaded.moves).not.toBe(preset.campaign.moves)
  })

  it('keeps the world\'s tracked state when a preset has none, and takes a preset\'s own', () => {
    const d20 = CAMPAIGN_PRESETS.find((entry) => entry.campaign.resolver === 'd20')!.campaign
    const current = { ...DEFAULT_CAMPAIGN, tracks: [{ id: 'gear', name: 'Gear', kind: 'items' as const }] }
    expect(loadCampaignPreset(current, d20).tracks).toEqual(current.tracks)
    expect(loadCampaignPreset(current, STARTER_PBTA_CAMPAIGN).tracks).toEqual(STARTER_PBTA_CAMPAIGN.tracks)
  })
})
