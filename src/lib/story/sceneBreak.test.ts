import { describe, expect, it } from 'vitest'
import { sceneBreakHint } from './sceneBreak'

describe('sceneBreakHint', () => {
  it('is urgent at or above 85% of context', () => {
    expect(sceneBreakHint({ contextRatio: 0.85, messagesInScene: 2 })).toEqual({
      reason: 'This scene is nearly out of room. End it to keep replies sharp.',
      urgent: true,
    })
    expect(sceneBreakHint({ contextRatio: 1.2, messagesInScene: 0 })?.urgent).toBe(true)
  })

  it('warns at or above 70% of context', () => {
    expect(sceneBreakHint({ contextRatio: 0.7, messagesInScene: 1 })).toEqual({
      reason: "This scene is using most of the model's context.",
      urgent: false,
    })
    expect(sceneBreakHint({ contextRatio: 0.84, messagesInScene: 1 })?.urgent).toBe(false)
  })

  it('lets context pressure win over a location change or time skip', () => {
    const hint = sceneBreakHint({ contextRatio: 0.9, messagesInScene: 20, locationChanged: 'the docks', timeSkipped: true })
    expect(hint?.urgent).toBe(true)
    expect(hint?.reason).toContain('nearly out of room')
    expect(sceneBreakHint({ contextRatio: 0.75, messagesInScene: 20, locationChanged: 'the docks' })?.reason).toContain('most of')
  })

  it('suggests a break on a location change once the scene has 6+ messages', () => {
    expect(sceneBreakHint({ contextRatio: 0.2, messagesInScene: 6, locationChanged: '  the docks ' })).toEqual({
      reason: 'The story moved to the docks. A good point for a new scene.',
      urgent: false,
    })
  })

  it('suggests a break on a time skip once the scene has 6+ messages', () => {
    const hint = sceneBreakHint({ contextRatio: 0.2, messagesInScene: 8, timeSkipped: true })
    expect(hint?.urgent).toBe(false)
    expect(hint?.reason).toMatch(/good point for a new scene/)
  })

  it('prefers the location line over the time-skip line', () => {
    expect(sceneBreakHint({ contextRatio: 0, messagesInScene: 10, locationChanged: 'Vell', timeSkipped: true })?.reason).toContain('moved to Vell')
  })

  it('ignores seams in a short scene', () => {
    expect(sceneBreakHint({ contextRatio: 0.2, messagesInScene: 5, locationChanged: 'the docks' })).toBeNull()
    expect(sceneBreakHint({ contextRatio: 0.2, messagesInScene: 5, timeSkipped: true })).toBeNull()
  })

  it('returns null otherwise', () => {
    expect(sceneBreakHint({ contextRatio: 0.69, messagesInScene: 40 })).toBeNull()
    expect(sceneBreakHint({ contextRatio: 0.1, messagesInScene: 40, locationChanged: '   ' })).toBeNull()
  })
})
