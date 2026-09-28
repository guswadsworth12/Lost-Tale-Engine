import { describe, expect, it } from 'vitest'
import { moveItem, nextRankName, rankLadderProblem, rankSelectOptions } from './rankLadder'

describe('rank ladder editing', () => {
  it('moves a rung one place and ignores moves past either end', () => {
    const list = ['a', 'b', 'c']
    expect(moveItem(list, 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(list, 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(list, 0, -1)).toEqual(list)
    expect(moveItem(list, 2, 1)).toEqual(list)
    expect(moveItem(list, 1, -1)).not.toBe(list)
    expect(list).toEqual(['a', 'b', 'c'])
  })

  it('names a new rung without colliding', () => {
    expect(nextRankName([])).toBe('Rank 1')
    expect(nextRankName([{ name: 'rank 2' }])).toBe('Rank 3')
  })

  it('rejects blank or case-insensitively duplicate names', () => {
    expect(rankLadderProblem([])).toBeUndefined()
    expect(rankLadderProblem([{ name: 'Genin' }, { name: 'Chūnin' }])).toBeUndefined()
    expect(rankLadderProblem([{ name: 'Genin' }, { name: ' ' }])).toMatch(/unique, nonempty/)
    expect(rankLadderProblem([{ name: 'Genin' }, { name: 'genin ' }])).toMatch(/unique, nonempty/)
    expect(rankLadderProblem(Array.from({ length: 21 }, (_, i) => ({ name: `R${i}` })))).toMatch(/at most 20/)
  })
})

describe('rank select options', () => {
  const ladder = [{ name: 'Genin' }, { name: 'Jōnin' }, { name: 'S-Class', note: 'exceptional status, not a rung' }]

  it('lists (none) then each rung lowest first with its note', () => {
    expect(rankSelectOptions(ladder, undefined)).toEqual([
      { value: '', label: '(none)' },
      { value: 'Genin', label: 'Genin' },
      { value: 'Jōnin', label: 'Jōnin' },
      { value: 'S-Class', label: 'S-Class · exceptional status, not a rung' },
    ])
  })

  it('keeps a saved rank that left the ladder as a disabled option', () => {
    const options = rankSelectOptions(ladder, 'Chūnin')
    expect(options[1]).toEqual({ value: 'Chūnin', label: 'Chūnin (not on ladder)', disabled: true })
    expect(options).toHaveLength(5)
    expect(rankSelectOptions(ladder, 'Genin').some((option) => option.disabled)).toBe(false)
  })

  it('shortens a long note', () => {
    const [, option] = rankSelectOptions([{ name: 'Hokage', note: 'x'.repeat(200) }], undefined)
    expect(option.label.length).toBeLessThan(80)
    expect(option.label.endsWith('…')).toBe(true)
  })
})
