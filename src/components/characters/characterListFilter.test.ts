import { describe, expect, it } from 'vitest'
import { filterCast, groupByTag, UNTAGGED } from './characterListFilter'

const card = (name: string, opts: { tags?: string[]; playerOnly?: boolean } = {}) => ({
  playerOnly: opts.playerOnly,
  card: { name, tags: opts.tags } as { name: string; tags?: string[] },
})

// Only `name` and `tags` are read; the cast keeps the fixtures short.
const cast = [
  card('Aiko', { tags: ['school'] }),
  card('Me', { playerOnly: true }),
  card('Ren', { tags: ['school', 'rival'], playerOnly: false }),
  card('Wanderer', { tags: ['school'], playerOnly: true }),
] as unknown as Parameters<typeof filterCast>[0]

const names = (list: { card: { name: string } }[]) => list.map((c) => c.card.name)

describe('filterCast', () => {
  it('shows everything under "all"', () => {
    expect(names(filterCast(cast, { kind: 'all' }, ''))).toEqual(['Aiko', 'Me', 'Ren', 'Wanderer'])
  })

  it('narrows to cards marked "you only", and only those', () => {
    expect(names(filterCast(cast, { kind: 'player' }, ''))).toEqual(['Me', 'Wanderer'])
  })

  it('narrows to a tag folder, with untagged cards under their own folder', () => {
    expect(names(filterCast(cast, { kind: 'tag', tag: 'school' }, ''))).toEqual(['Aiko', 'Ren', 'Wanderer'])
    expect(names(filterCast(cast, { kind: 'tag', tag: UNTAGGED }, ''))).toEqual(['Me'])
  })

  it('applies the search inside every scope, ignoring case and surrounding space', () => {
    expect(names(filterCast(cast, { kind: 'all' }, ' re '))).toEqual(['Ren', 'Wanderer'])
    expect(names(filterCast(cast, { kind: 'player' }, 'WAN'))).toEqual(['Wanderer'])
    expect(names(filterCast(cast, { kind: 'tag', tag: 'school' }, 'ai'))).toEqual(['Aiko'])
  })
})

describe('groupByTag', () => {
  it('files a card under each of its tags and untagged cards under Untagged', () => {
    const groups = groupByTag(cast)
    expect([...groups.keys()].sort()).toEqual(['Untagged', 'rival', 'school'])
    expect(names(groups.get('school')!)).toEqual(['Aiko', 'Ren', 'Wanderer'])
    expect(names(groups.get(UNTAGGED)!)).toEqual(['Me'])
  })
})
