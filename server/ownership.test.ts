import { describe, expect, it } from 'vitest'
import { canChangeVisibility, chatCharacterIds, chatVisibleTo, ownershipPatch, visibleTo } from './ownership.ts'

const ash = { id: 'ash', role: 'member' as const }
const bea = { id: 'bea', role: 'member' as const }
const site = { id: 'site', role: 'owner' as const }

describe('ownership', () => {
  it('shows shared and legacy rows to everyone, and private ones to their owner only', () => {
    expect(visibleTo({ id: 'w' }, bea)).toBe(true)
    expect(visibleTo({ id: 'w', visibility: 'shared', ownerUserId: 'ash' }, bea)).toBe(true)
    expect(visibleTo({ id: 'w', visibility: 'private', ownerUserId: 'ash' }, ash)).toBe(true)
    expect(visibleTo({ id: 'w', visibility: 'private', ownerUserId: 'ash' }, bea)).toBe(false)
    expect(visibleTo({ id: 'w', visibility: 'private', ownerUserId: 'ash' }, site)).toBe(false)
    expect(visibleTo(undefined, ash)).toBe(false)
  })

  it('makes a chat private when anything it uses is', () => {
    const rows: Record<string, Record<string, unknown>> = {
      lead: { id: 'lead', worldId: 'w' },
      hidden: { id: 'hidden', visibility: 'private', ownerUserId: 'ash' },
      w: { id: 'w', visibility: 'private', ownerUserId: 'ash' },
    }
    const lookups = { character: (id: string) => rows[id], world: (id: string) => rows[id] }
    expect(chatCharacterIds({ characterId: 'lead', playerCharacterId: 'p', participants: ['lead', 'x'] })).toEqual(['lead', 'p', 'x'])
    expect(chatVisibleTo({ characterId: 'lead' }, ash, lookups)).toBe(true)
    expect(chatVisibleTo({ characterId: 'lead' }, bea, lookups)).toBe(false)
    expect(chatVisibleTo({ characterId: 'gone', participants: ['hidden'] }, bea, lookups)).toBe(false)
    expect(chatVisibleTo({ characterId: 'gone' }, bea, lookups)).toBe(true)
  })

  it('lets only an owner change who sees a row, and only the site owner take a legacy row private', () => {
    expect(canChangeVisibility({ ownerUserId: 'ash' }, ash)).toBe(true)
    expect(canChangeVisibility({ ownerUserId: 'ash' }, site)).toBe(false)
    expect(canChangeVisibility({}, bea)).toBe(false)
    expect(canChangeVisibility({}, site)).toBe(true)
  })

  it('owns a new row by its maker and never takes an owner from the client', () => {
    expect(ownershipPatch({ ownerUserId: 'bea' }, undefined, ash)).toEqual({ patch: { ownerUserId: 'ash', visibility: 'shared' } })
    expect(ownershipPatch({ visibility: 'private' }, undefined, ash)).toEqual({ patch: { ownerUserId: 'ash', visibility: 'private' } })
    expect(ownershipPatch({ ownerUserId: 'bea' }, { ownerUserId: 'ash' }, bea)).toEqual({ patch: {} })
    expect(ownershipPatch({ visibility: 'private' }, { ownerUserId: 'ash' }, bea).refused).toBeTruthy()
    expect(ownershipPatch({ visibility: 'private' }, {}, site)).toEqual({ patch: { visibility: 'private', ownerUserId: 'site' } })
    expect(ownershipPatch({ visibility: 'shared' }, { visibility: 'shared' }, bea)).toEqual({ patch: {} })
  })
})
