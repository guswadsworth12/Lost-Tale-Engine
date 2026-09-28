import { describe, expect, it } from 'vitest'
import { clampStagePoint, moveStagePoint, stagePointStyle } from './stageArea'

describe('stage area', () => {
  it('narrows the allowed floor space toward the back line', () => {
    expect(clampStagePoint({ x: 0, depth: 0 }).x).toBeCloseTo(0.22)
    expect(clampStagePoint({ x: 0, depth: 1 })).toEqual({ x: 0, depth: 1 })
  })

  it('moves and sizes a figure with perspective while clamping a drag', () => {
    const back = stagePointStyle({ x: 0.5, depth: 0 }, 45)
    const front = stagePointStyle({ x: 0.5, depth: 1 }, 45)
    expect(back.bottom).toBeGreaterThan(front.bottom)
    expect(back.height).toBeLessThan(front.height)
    expect(moveStagePoint({ x: 0.5, depth: 0.5 }, 2, 2, 45)).toEqual({ x: 1, depth: 1 })
  })
})
