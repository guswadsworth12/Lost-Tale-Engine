import { describe, expect, it } from 'vitest'
import { CHARACTER_TAB_ALIASES, LEGACY_VIEW_ALIASES, VIEW_IDS, WORLD_TAB_ALIASES } from './navigation'

describe('navigation aliases', () => {
  it('resolves every retired top-level view and the dating deep link', () => {
    for (const id of Object.values(LEGACY_VIEW_ALIASES)) expect(VIEW_IDS).toContain(id)
    expect(WORLD_TAB_ALIASES.dating).toBe('relationships')
    expect(CHARACTER_TAB_ALIASES.dating).toBe('relationships')
  })
})
