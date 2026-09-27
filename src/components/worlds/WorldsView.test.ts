import { describe, expect, it } from 'vitest'
import { DEFAULT_CAMPAIGN } from '@/lib/world/campaign'
import { modulesForWorld } from '@/lib/world/worldTemplates'
import { WORLD_TAB_ALIASES } from '@/lib/ui/navigation'
import { changeWorldModule, initialWorldEditorModules, worldEditorTabs } from './WorldsView'

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
})
