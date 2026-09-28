import { describe, expect, it } from 'vitest'
import { WORLD_TEMPLATES, assistOverridesForTemplate, getWorldTemplate, hiddenWorldTabs, modulesForWorld, normalizeWorldTemplateId, romanceEmphasisFor } from './worldTemplates'

describe('modulesForWorld', () => {
  it('derives old worlds without changing their stored data', () => {
    expect(modulesForWorld()).toMatchObject({ campaignRules: false, relationships: true, dating: true, romanceEmphasis: 'focus' })
    expect(modulesForWorld({ template: 'visual_novel' })).toMatchObject({ dating: true, visualNovel: true, worldSimulation: true, romanceEmphasis: 'natural' })
    expect(modulesForWorld({ template: 'freeform', campaign: { ruleset: 'Custom', mode: 'guided', resolver: 'pbta', relationships: false, dating: false, moves: [] } })).toEqual({
      campaignRules: 'guided', relationships: false, dating: false, visualNovel: false, worldSimulation: false, romanceEmphasis: 'off',
    })
  })

  it('honors explicit choices and never enables dating without relationships', () => {
    const world = { template: 'dating_sim' as const, campaign: { ruleset: 'Custom', mode: 'guided' as const, resolver: 'pbta' as const, relationships: true, dating: true, moves: [] }, modules: { dating: false, worldSimulation: false } }
    expect(modulesForWorld(world)).toMatchObject({ dating: false, romanceEmphasis: 'off', worldSimulation: false })
    expect(hiddenWorldTabs(world)).toEqual(['dating', 'clock'])
    expect(modulesForWorld({ ...world, modules: { relationships: false, dating: true } })).toMatchObject({ relationships: false, dating: false, romanceEmphasis: 'off' })
  })
})

describe('romanceEmphasisFor', () => {
  it('keeps dating-sim prompts focused and story prompts natural when dating is available', () => {
    expect(romanceEmphasisFor('dating_sim', true)).toBe('focus')
    expect(romanceEmphasisFor('visual_novel', true)).toBe('natural')
    expect(romanceEmphasisFor('freeform', true)).toBe('natural')
    expect(romanceEmphasisFor(undefined, true)).toBe('focus')
  })

  it('honors the campaign dating switch in every template', () => {
    for (const template of WORLD_TEMPLATES) expect(romanceEmphasisFor(template.id, false)).toBe('off')
  })
})

describe('hiddenWorldTabs', () => {
  it('hides nothing for the dating_sim template — the full feature set', () => {
    expect(hiddenWorldTabs('dating_sim')).toEqual([])
  })

  it('treats an unset template exactly like dating_sim, so every pre-existing world is unaffected', () => {
    expect(hiddenWorldTabs(undefined)).toEqual(hiddenWorldTabs('dating_sim'))
  })

  it('hides both dating and clock tabs for freeform', () => {
    const hidden = hiddenWorldTabs('freeform')
    expect(hidden).toContain('dating')
    expect(hidden).toContain('clock')
  })

  it('hides only the dating tab for visual_novel', () => {
    expect(hiddenWorldTabs('visual_novel')).toEqual(['dating'])
  })

  it('never hides overview, lore, or scenes for any template', () => {
    for (const t of WORLD_TEMPLATES) {
      const hidden = hiddenWorldTabs(t.id)
      expect(hidden).not.toContain('overview')
      expect(hidden).not.toContain('lore')
      expect(hidden).not.toContain('scenes')
    }
  })

  it("treats a retired 'slice_of_life' value (from before it merged into Freeform) exactly like freeform", () => {
    expect(hiddenWorldTabs('slice_of_life' as never)).toEqual(hiddenWorldTabs('freeform'))
  })
})

describe('getWorldTemplate', () => {
  it('returns the matching definition for every listed template id', () => {
    for (const t of WORLD_TEMPLATES) {
      expect(getWorldTemplate(t.id).id).toBe(t.id)
    }
  })

  it("resolves a retired 'slice_of_life' value to the Freeform definition", () => {
    expect(getWorldTemplate('slice_of_life' as never).id).toBe('freeform')
  })

  it('no longer lists Slice of Life as an offered template', () => {
    expect(WORLD_TEMPLATES.map((t) => t.id)).not.toContain('slice_of_life')
  })
})

describe('normalizeWorldTemplateId', () => {
  it('maps the retired Slice of Life id to Freeform', () => {
    expect(normalizeWorldTemplateId('slice_of_life')).toBe('freeform')
  })

  it('falls back to dating_sim for an unset value', () => {
    expect(normalizeWorldTemplateId(undefined)).toBe('dating_sim')
  })

  it('passes every live template id through unchanged', () => {
    for (const t of WORLD_TEMPLATES) {
      expect(normalizeWorldTemplateId(t.id)).toBe(t.id)
    }
  })
})

describe('assistOverridesForTemplate', () => {
  it('uses explicit world module choices for new story defaults', () => {
    expect(assistOverridesForTemplate({ template: 'dating_sim', modules: { dating: false } })).toEqual({
      autoTrackRelationship: false,
      autoSuggestChoices: false,
      slowBurnPacing: false,
      showIntentChips: false,
      showDateEventButton: false,
    })
    expect(assistOverridesForTemplate({ template: 'visual_novel', modules: { visualNovel: false } })).toEqual({
      slowBurnPacing: false,
      showIntentChips: false,
      showDateEventButton: false,
    })
  })
  it('turns relationship tracking, choices, slow-burn pacing, intent chips, and the date button off for freeform', () => {
    const romanceOff = {
      autoTrackRelationship: false,
      autoSuggestChoices: false,
      slowBurnPacing: false,
      showIntentChips: false,
      showDateEventButton: false,
    }
    expect(assistOverridesForTemplate('freeform')).toEqual({ ...romanceOff, systemPromptId: 'balanced' })
  })

  it('leaves no override at all for dating_sim or an unset template', () => {
    expect(assistOverridesForTemplate('dating_sim')).toEqual({})
    expect(assistOverridesForTemplate(undefined)).toEqual({})
  })

  it('keeps relationship tracking available but starts Visual Novel dating controls quiet', () => {
    expect(assistOverridesForTemplate('visual_novel')).toEqual({
      visualNovelMode: 'auto',
      slowBurnPacing: false,
      showIntentChips: false,
      showDateEventButton: false,
    })
    expect(assistOverridesForTemplate('dating_sim')).toEqual({})
    expect(assistOverridesForTemplate(undefined)).toEqual({})
  })

  it('seeds a systemPromptId only for the one template that has one', () => {
    expect(assistOverridesForTemplate('freeform').systemPromptId).toBe('balanced')
    expect(assistOverridesForTemplate('visual_novel').systemPromptId).toBeUndefined()
    expect(assistOverridesForTemplate('dating_sim').systemPromptId).toBeUndefined()
  })

  it("bundles a retired 'slice_of_life' value exactly like freeform (its 'balanced' prompt included), since it merged away rather than keeping its own preset", () => {
    expect(assistOverridesForTemplate('slice_of_life' as never)).toEqual(assistOverridesForTemplate('freeform'))
  })
})
