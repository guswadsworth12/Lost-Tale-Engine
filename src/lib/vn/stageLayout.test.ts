import { describe, expect, it } from 'vitest'
import { stageLayout } from './stageLayout'

describe('stageLayout', () => {
  it('frames a six-person scene through foreground, midground, and background', () => {
    const shot = stageLayout(['a', 'b', 'c', 'd', 'e', 'f'], 'c')
    expect(shot.map((member) => member.depth)).toEqual([
      'midground', 'background', 'foreground', 'background', 'background', 'background',
    ])
    expect(shot.filter((member) => member.visibleOnPhone).map((member) => member.id)).toEqual(['c'])
    expect(shot[0].bottom).toBeLessThan(shot[1].bottom)
    expect(new Set(shot.map((member) => member.x)).size).toBeGreaterThan(3)
  })

  it('holds a desktop shot through narration while showing no character on a phone', () => {
    const shot = stageLayout(['a', 'b', 'c'], 'b', null)
    expect(shot.find((member) => member.id === 'b')?.depth).toBe('foreground')
    expect(shot.filter((member) => member.visibleOnPhone)).toEqual([])
    expect(shot.find((member) => member.id === 'c')?.depth).toBe('background')
  })

  it('moves the focus and supporting cast when the speaker changes', () => {
    const ids = ['a', 'b', 'c']
    expect(stageLayout(ids, 'b').find((member) => member.id === 'a')?.x)
      .not.toBe(stageLayout(ids, 'c').find((member) => member.id === 'a')?.x)
  })
})
