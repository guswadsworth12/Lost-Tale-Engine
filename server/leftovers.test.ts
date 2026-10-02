import { describe, expect, it } from 'vitest'
import { findLeftovers, planCleanup, type OwnedRows } from './leftovers.ts'

type Row = Record<string, unknown>
const empty = (): OwnedRows => ({
  worlds: [], characters: [], world_info_books: [], personas: [],
  chats: [], stories: [], presets: [], themes: [], instruct_templates: [], assistant_threads: [],
})
const live = new Set(['owner', 'member'])
const ids = (refs: { table: string; id: string }[]) => refs.map((r) => `${r.table}:${r.id}`)

describe('what removed accounts left behind', () => {
  it('groups records by an owner nobody signs in as, named where the removal was recorded', () => {
    const rows = empty()
    rows.worlds = [{ id: 'w1', ownerUserId: 'gone', visibility: 'shared' }, { id: 'w2', ownerUserId: 'owner' }, { id: 'w3' }]
    rows.characters = [{ id: 'c1', ownerUserId: 'gone' }, { id: 'c2', ownerUserId: 'older' }]
    rows.chats = [{ id: 'ch1', ownerUserId: 'gone' }] as Row[]
    const found = findLeftovers(rows, live, new Map([['gone', { username: 'sample', removedAt: 20 }]]))
    expect(found).toEqual([
      { formerOwnerId: 'gone', username: 'sample', removedAt: 20, counts: { worlds: 1, characters: 1, chats: 1 }, total: 3, shared: 1 },
      { formerOwnerId: 'older', counts: { characters: 1 }, total: 1, shared: 0 },
    ])
  })

  it('takes everything over as it is', () => {
    const rows = empty()
    rows.worlds = [{ id: 'w1', ownerUserId: 'gone', visibility: 'private' }]
    rows.stories = [{ id: 's1', ownerUserId: 'gone' }]
    const plan = planCleanup(rows, 'gone', 'adopt', live)
    expect(ids(plan.adopt)).toEqual(['stories:s1', 'worlds:w1'])
    expect(plan.remove).toEqual([])
  })

  it('deletes only what nobody else has or uses: shared and in-use records pass to the owner', () => {
    const rows = empty()
    rows.worlds = [
      { id: 'shared-world', ownerUserId: 'gone', visibility: 'shared' },
      { id: 'home', ownerUserId: 'gone', visibility: 'private' },
      { id: 'lonely', ownerUserId: 'gone', visibility: 'private' },
    ]
    rows.characters = [
      { id: 'lead', ownerUserId: 'gone', visibility: 'private' },
      { id: 'guest', ownerUserId: 'gone', visibility: 'private' },
      { id: 'resident', ownerUserId: 'member', worldId: 'home' },
    ]
    rows.personas = [{ id: 'mask', ownerUserId: 'gone', visibility: 'private' }]
    rows.chats = [
      { id: 'theirs', ownerUserId: 'gone', characterId: 'lead' },
      // A living member's group chat still has their guest in it, and plays their persona.
      { id: 'party', ownerUserId: 'member', characterId: 'resident', participants: ['guest'], personaId: 'mask' },
    ]
    rows.stories = [{ id: 'saga', ownerUserId: 'gone' }]
    rows.presets = [{ id: 'p', ownerUserId: 'gone' }]
    const plan = planCleanup(rows, 'gone', 'delete', live)
    expect(ids(plan.adopt).sort()).toEqual(['characters:guest', 'personas:mask', 'worlds:home', 'worlds:shared-world'])
    // Stories first, so their scenes go with them.
    expect(ids(plan.remove)).toEqual(['stories:saga', 'chats:theirs', 'characters:lead', 'worlds:lonely', 'presets:p'])
  })

  it('never touches a living account', () => {
    const rows = empty()
    rows.worlds = [{ id: 'w', ownerUserId: 'member' }]
    expect(planCleanup(rows, 'member', 'delete', live)).toEqual({ adopt: [], remove: [] })
  })
})
