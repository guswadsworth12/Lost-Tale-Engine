import { describe, expect, it } from 'vitest'
import { currentScenery, describeScenery, pinnedSceneryGuidance, sceneryIsNight, type SceneryChoice } from './scenery'
import { resolveSceneBackground } from './resolveBackground'
import type { Chat, WorldCard } from '@/lib/types'

const chat = { id: 'c1', characterId: 'ch1', personaId: 'p1', title: 'T' } as Chat
const world = {
  id: 'w1',
  name: 'Emberfall',
  customBackgrounds: [{ id: 'guild-hall', label: 'Guild Hall' }],
  backgrounds: { 'guild-hall': 'hall-day.png', park: 'park-day.png' },
  backgroundsNight: { 'guild-hall': 'hall-night.png' },
} as unknown as WorldCard
const pin = (backgroundId: string | null, variant: SceneryChoice['variant'] = 'auto'): SceneryChoice => ({ backgroundId, variant, setAt: 1 })

describe('in-chat scenery', () => {
  it('a pinned background survives a reply that tags somewhere else', () => {
    const out = resolveSceneBackground({ taggedBackground: 'park', chat, world, affection: 0, scenery: pin('guild-hall') })
    expect(out).toEqual({ id: 'guild-hall', url: 'hall-day.png', source: 'manual' })
  })

  it('"follow the story" hands the stage back to scene tags', () => {
    const out = resolveSceneBackground({ taggedBackground: 'park', chat, world, affection: 0, scenery: pin(null) })
    expect(out).toMatchObject({ id: 'park', source: 'tag' })
  })

  it('a forced variant overrides the world clock either way', () => {
    expect(resolveSceneBackground({ chat, world, affection: 0, scenery: pin('guild-hall', 'night'), night: false }).url).toBe('hall-night.png')
    expect(resolveSceneBackground({ chat, world, affection: 0, scenery: pin('guild-hall', 'day'), night: true }).url).toBe('hall-day.png')
    expect(sceneryIsNight(pin(null, 'auto'), true)).toBe(true)
    expect(sceneryIsNight(undefined, false)).toBe(false)
  })

  it('the current choice is the latest one on the branch, so rewind restores the earlier pick', () => {
    const branch = [{ scenery: pin('park') }, {}, { scenery: pin('guild-hall', 'night') }, {}]
    expect(currentScenery(branch)?.backgroundId).toBe('guild-hall')
    // Rewinding to the third message deletes it and everything after.
    expect(currentScenery(branch.slice(0, 2))?.backgroundId).toBe('park')
    expect(currentScenery([], { scenery: pin('park') })?.backgroundId).toBe('park')
    expect(currentScenery([])).toBeUndefined()
  })

  it('describes the scenery for the GM and steers character replies while pinned', () => {
    expect(describeScenery(pin('guild-hall'), 'guild-hall', world, true)).toBe(
      'Guild Hall (night) — pinned by the player; stay in this location unless the player moves the scene',
    )
    expect(describeScenery(pin(null), 'park', world, false)).toContain("follows the story's scene tags")
    expect(pinnedSceneryGuidance(pin('guild-hall'), world)).toContain('Guild Hall')
    expect(pinnedSceneryGuidance(pin(null), world)).toBe('')
  })
})
