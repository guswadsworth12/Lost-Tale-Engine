import { describe, expect, it } from 'vitest'
import { customNeedsTarget, describeBands, describeDice, randomFace, rollCustom, tierLabels, validateCustomResolver, type CustomResolver } from './customRules'

/** Rolls these faces in order, whatever the dice. */
const faces = (...values: number[]) => {
  const queue = [...values]
  return () => {
    if (!queue.length) throw new Error('ran out of faces')
    return queue.shift()!
  }
}

const valid = (raw: unknown): CustomResolver => {
  const { resolver, errors } = validateCustomResolver(raw)
  expect(errors).toEqual([])
  return resolver!
}

// Blades in the Dark: a d6 pool of the action rating, highest die counts; two sixes are a critical.
const blades = valid({
  dice: { count: 0, sides: 6, pool: true, emptyPool: 2, keep: { which: 'highest', count: 1 } },
  compare: 'result',
  bands: [
    { label: 'Critical', tier: 'strong', topFaces: 2, meaning: 'Success with increased effect.' },
    { label: 'Full success', tier: 'strong', min: 6 },
    { label: 'Partial', tier: 'mixed', min: 4, max: 5, meaning: 'You do it, but there is a consequence.' },
    { label: 'Bad outcome', tier: 'miss', max: 3 },
  ],
})

// Savage Worlds: an exploding trait die and an exploding wild d6, the better one plus the modifier, against 4.
const savage = valid({
  dice: { count: 1, sides: 8, explode: true, wildDie: 6 },
  compare: 'margin',
  bands: [
    { label: 'Failure', tier: 'miss', max: -1 },
    { label: 'Success', tier: 'strong', min: 0, max: 3 },
    { label: 'Raise', tier: 'strong', min: 4 },
  ],
})

describe('rolling a custom ruleset', () => {
  it('takes the highest die of a stat pool, and calls two sixes a critical', () => {
    expect(rollCustom(blades, 2, undefined, faces(4, 2))).toMatchObject({ result: 4, band: { label: 'Partial', tier: 'mixed' }, dice: [4, 2] })
    expect(rollCustom(blades, 3, undefined, faces(6, 1, 3)).band.label).toBe('Full success')
    expect(rollCustom(blades, 3, undefined, faces(6, 6, 2)).band.label).toBe('Critical')
  })

  it('rolls two and keeps the lowest for an empty pool', () => {
    const roll = rollCustom(blades, 0, undefined, faces(6, 3))
    expect(roll).toMatchObject({ result: 3, band: { label: 'Bad outcome' } })
    expect(roll.detail).toContain('keeping the lowest (3)')
    // Two sixes on a desperate roll keep a six: a full success, never a critical.
    expect(rollCustom(blades, 0, undefined, faces(6, 6)).band.label).toBe('Full success')
  })

  it('explodes dice on their highest face and lets the wild die stand in', () => {
    // Trait d8: 8, then 3 (11). Wild d6: 2. 11 + 1 = 12 against 4 is a margin of 8: a raise.
    const raise = rollCustom(savage, 1, 4, faces(8, 3, 2))
    expect(raise).toMatchObject({ result: 12, margin: 8, band: { label: 'Raise' }, dice: [11, 2] })
    // Trait 1, wild 6 then 1 (7): the wild die counts. 7 + 0 against 6 is a success.
    expect(rollCustom(savage, 0, 6, faces(1, 6, 1))).toMatchObject({ result: 7, margin: 1, band: { label: 'Success' } })
    expect(rollCustom(savage, 0, 6, faces(2, 3)).band.tier).toBe('miss')
  })

  it('counts successes in a pool against a target number', () => {
    const pool = valid({
      dice: { count: 0, sides: 10, pool: true, successOn: 8 },
      compare: 'result',
      bands: [{ label: 'Failure', tier: 'miss', max: 0 }, { label: 'Success', tier: 'mixed', min: 1, max: 2 }, { label: 'Exceptional', tier: 'strong', min: 3 }],
    })
    expect(rollCustom(pool, 4, undefined, faces(8, 10, 3, 9))).toMatchObject({ result: 3, band: { label: 'Exceptional' } })
    expect(rollCustom(pool, 2, undefined, faces(7, 2)).band.label).toBe('Failure')
  })

  it('rolls fair dice on the server', () => {
    const seen = new Set(Array.from({ length: 400 }, () => randomFace(6)))
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('describing a custom ruleset', () => {
  it('in words the GM and the builder can read', () => {
    expect(describeDice(blades.dice)).toBe('Roll a pool of d6 equal to the sheet value (none: roll 2, keep the lowest), keep the highest 1.')
    expect(describeBands(blades)[2]).toBe('Result 4 to 5: Partial (mixed). You do it, but there is a consequence.')
    expect(describeBands(savage)[0]).toBe('Margin over the difficulty -1 or less: Failure (miss)')
    expect(tierLabels(savage)).toEqual({ strong: 'Success or Raise', mixed: 'Mixed', miss: 'Failure' })
    expect(customNeedsTarget(savage)).toBe(true)
    expect(customNeedsTarget(blades)).toBe(false)
  })
})

describe('validating a custom ruleset', () => {
  const band = (label: string, tier: string, min?: number, max?: number) => ({ label, tier, min, max })

  it('names every gap, overlap, and open end in the outcomes', () => {
    const { resolver, errors } = validateCustomResolver({
      dice: { count: 2, sides: 6 }, compare: 'result',
      bands: [band('Low', 'miss', 2, 5), band('Mid', 'mixed', 5, 8), band('High', 'strong', 10, 12)],
    })
    expect(resolver).toBeUndefined()
    expect(errors).toEqual([
      'Nothing covers results below 2: leave the lowest outcome open at the bottom.',
      'Nothing covers results above 12: leave the highest outcome open at the top.',
      'Low and Mid overlap.',
      'Nothing covers 9, between Mid and High.',
    ])
  })

  it('refuses dice that cannot be rolled', () => {
    const { errors } = validateCustomResolver({
      dice: { count: 30, sides: 1, keep: { which: 'middle', count: 1 }, wildDie: 6, pool: true, successOn: 12 },
      compare: 'sometimes', bands: [band('Only', 'great')],
    })
    expect(errors).toEqual(expect.arrayContaining([
      'A pool\'s base dice must be 0 to 20.',
      'Dice need 2 to 100 sides.',
      'Keep the highest or the lowest dice.',
      'A wild die works with a plain total, not a pool or successes.',
      'Say whether outcomes read the result itself or its margin over a difficulty.',
      'Give 2 to 12 outcomes.',
      'Only must count as strong, mixed, or miss.',
    ]))
  })

  it('keeps only what it knows, trimmed', () => {
    const { resolver } = validateCustomResolver({ dice: { count: 1, sides: 20, extra: true }, compare: 'margin', bands: [band(' Miss ', 'miss', undefined, -1), band('Hit', 'strong', 0)], notes: 'x' })
    expect(resolver).toEqual({ dice: { count: 1, sides: 20 }, compare: 'margin', bands: [{ label: 'Miss', tier: 'miss', max: -1 }, { label: 'Hit', tier: 'strong', min: 0 }] })
  })
})
