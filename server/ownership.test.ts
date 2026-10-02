import { describe, expect, it } from 'vitest'
import { canChangeVisibility, chatCharacterIds, chatVisibleTo, characterVisibleTo, ownerOf, ownershipPatch, visibleTo } from './ownership.ts'

const site = { id: 'site', role: 'owner' as const }
const ash = { id: 'ash', role: 'member' as const }
const bea = { id: 'bea', role: 'member' as const }

describe('private unless shared on purpose', () => {
  it('shows a row to its owner, and to others only when shared', () => {
    expect(visibleTo({ id: 'w', ownerUserId: 'ash' }, ash, 'site')).toBe(true)
    expect(visibleTo({ id: 'w', ownerUserId: 'ash' }, bea, 'site')).toBe(false)
    expect(visibleTo({ id: 'w', visibility: 'private', ownerUserId: 'ash' }, bea, 'site')).toBe(false)
    expect(visibleTo({ id: 'w', visibility: 'shared', ownerUserId: 'ash' }, bea, 'site')).toBe(true)
    // The site owner role reads no one else's private things.
    expect(visibleTo({ id: 'w', visibility: 'private', ownerUserId: 'ash' }, site, 'site')).toBe(false)
    expect(visibleTo(undefined, ash, 'site')).toBe(false)
  })

  it('gives a row made before accounts to the site owner, and no one else', () => {
    expect(ownerOf({ id: 'old' }, 'site')).toBe('site')
    expect(visibleTo({ id: 'old' }, site, 'site')).toBe(true)
    expect(visibleTo({ id: 'old' }, bea, 'site')).toBe(false)
    expect(visibleTo({ id: 'old' }, bea, undefined)).toBe(false)
  })

  it("keeps a private world's cast private, and a shared world's own cast its owner's", () => {
    const worlds: Record<string, Record<string, unknown>> = {
      mine: { id: 'mine', ownerUserId: 'ash' },
      open: { id: 'open', ownerUserId: 'ash', visibility: 'shared' },
    }
    const lookups = { character: () => undefined, world: (id: string) => worlds[id], siteOwnerId: () => 'site' }
    expect(characterVisibleTo({ id: 'c', ownerUserId: 'ash', visibility: 'shared', worldId: 'mine' }, bea, lookups)).toBe(false)
    expect(characterVisibleTo({ id: 'c', ownerUserId: 'ash', visibility: 'shared', worldId: 'open' }, bea, lookups)).toBe(true)
    expect(characterVisibleTo({ id: 'c', ownerUserId: 'ash', worldId: 'open' }, bea, lookups)).toBe(false)
  })

  it("keeps every story its starter's alone, whatever cast it uses", () => {
    const lookups = { character: () => ({ id: 'x', visibility: 'shared' }), world: () => undefined, siteOwnerId: () => 'site' }
    expect(chatVisibleTo({ characterId: 'x', ownerUserId: 'ash' }, ash, lookups)).toBe(true)
    expect(chatVisibleTo({ characterId: 'x', ownerUserId: 'ash' }, bea, lookups)).toBe(false)
    // Stories from before accounts are the site owner's.
    expect(chatVisibleTo({ characterId: 'x' }, site, lookups)).toBe(true)
    expect(chatVisibleTo({ characterId: 'x' }, bea, lookups)).toBe(false)
    expect(chatCharacterIds({ characterId: 'a', playerCharacterId: 'b', participants: ['a', 'c'] })).toEqual(['a', 'b', 'c'])
  })

  it('lets only the owner change who sees a row', () => {
    expect(canChangeVisibility({ ownerUserId: 'ash' }, ash, 'site')).toBe(true)
    expect(canChangeVisibility({ ownerUserId: 'ash' }, site, 'site')).toBe(false)
    expect(canChangeVisibility({}, site, 'site')).toBe(true)
    expect(canChangeVisibility({}, bea, 'site')).toBe(false)
  })

  it('makes something new private to its maker unless sharing is asked for, and never takes an owner from the client', () => {
    expect(ownershipPatch({ ownerUserId: 'bea' }, undefined, ash, 'site')).toEqual({ patch: { ownerUserId: 'ash', visibility: 'private' } })
    expect(ownershipPatch({ visibility: 'shared' }, undefined, ash, 'site')).toEqual({ patch: { ownerUserId: 'ash', visibility: 'shared' } })
    expect(ownershipPatch({ ownerUserId: 'bea' }, { ownerUserId: 'ash' }, bea, 'site')).toEqual({ patch: {} })
    expect(ownershipPatch({ visibility: 'shared' }, { ownerUserId: 'ash' }, bea, 'site').refused).toBeTruthy()
    // Unset reads as private, so asking for private changes nothing; sharing an old row makes it the site owner's.
    expect(ownershipPatch({ visibility: 'private' }, {}, site, 'site')).toEqual({ patch: {} })
    expect(ownershipPatch({ visibility: 'shared' }, {}, site, 'site')).toEqual({ patch: { visibility: 'shared', ownerUserId: 'site' } })
  })
})
