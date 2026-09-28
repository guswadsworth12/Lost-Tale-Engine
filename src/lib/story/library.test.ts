import { describe, expect, it } from 'vitest'
import type { Chat, Story } from '@/lib/types'
import {
  groupStories, latestSceneFor, messageDisplayText, nextSceneOf, scenesOfStory, storyLanes, transcriptAsText, transcriptScenes,
} from './library'

const chat = (id: string, extra: Partial<Chat> = {}) =>
  ({ id, title: id, characterId: 'c', createdAt: 0, updatedAt: 0, ...extra }) as Chat

// Story "st": 1 → 2 → 3 on the main line; 2 → 4 splits off onto "docks".
const s1 = chat('s1', { storyId: 'st', sceneNumber: 1, endedAt: 10, createdAt: 1, updatedAt: 10, title: 'Opening' })
const s2 = chat('s2', { storyId: 'st', sceneNumber: 2, previousSceneId: 's1', endedAt: 20, createdAt: 11, updatedAt: 20 })
const s3 = chat('s3', { storyId: 'st', sceneNumber: 3, previousSceneId: 's2', createdAt: 21, updatedAt: 30 })
const s4 = chat('s4', { storyId: 'st', sceneNumber: 4, previousSceneId: 's2', storylineId: 'docks', createdAt: 22, updatedAt: 40 })
const story: Story = { id: 'st', title: 'The Long Night', storylines: [{ id: 'docks', name: 'At the docks' }], createdAt: 1, updatedAt: 20 }

describe('groupStories', () => {
  it('makes a legacy chat without storyId its own one-scene story', () => {
    const legacy = chat('old', { title: 'Old chat', updatedAt: 5 })
    const [group] = groupStories([legacy], [])
    expect(group).toMatchObject({ storyId: 'old', title: 'Old chat', sceneCount: 1, storylineCount: 1, updatedAt: 5 })
    expect(group.current).toBe(legacy)
  })

  it('groups scenes by storyId in scene order, titled by the story', () => {
    const [group] = groupStories([s3, s1, s4, s2], [story])
    expect(group.storyId).toBe('st')
    expect(group.title).toBe('The Long Night')
    expect(group.scenes.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4'])
    expect(group.sceneCount).toBe(4)
    expect(group.storylineCount).toBe(2)
    expect(group.updatedAt).toBe(40)
  })

  it('opens the most recently updated scene that has not ended', () => {
    expect(groupStories([s1, s2, s3, s4], [story])[0].current.id).toBe('s4')
    expect(groupStories([s1, s2, { ...s3, updatedAt: 50 }, s4], [story])[0].current.id).toBe('s3')
  })

  it('falls back to the latest scene when every scene has ended', () => {
    const [group] = groupStories([s1, s2], [])
    expect(group.current.id).toBe('s2')
    expect(group.title).toBe('s2') // no Story record: the current scene's title
  })

  it('sorts stories by most recent activity', () => {
    const a = chat('a', { updatedAt: 100 })
    const b = chat('b', { updatedAt: 1 })
    expect(groupStories([b, s1, s2, s3, s4, a], [story]).map((g) => g.storyId)).toEqual(['a', 'st', 'b'])
  })
})

describe('scene navigation', () => {
  const all = [s1, s2, s3, s4]

  it('nextSceneOf prefers the same storyline over a split', () => {
    expect(nextSceneOf(all, 's2')?.id).toBe('s3')
    expect(nextSceneOf(all, 's1')?.id).toBe('s2')
    expect(nextSceneOf(all, 's3')).toBeUndefined()
  })

  it('nextSceneOf follows the split when it is the only continuation', () => {
    const splitOnly = [s1, s2, s4]
    expect(nextSceneOf(splitOnly, 's2')?.id).toBe('s4')
    // From a scene on the side line, its own line wins.
    const s5 = chat('s5', { storyId: 'st', sceneNumber: 5, previousSceneId: 's4', storylineId: 'docks' })
    const s6 = chat('s6', { storyId: 'st', sceneNumber: 6, previousSceneId: 's4' })
    expect(nextSceneOf([...all, s6, s5], 's4')?.id).toBe('s5')
  })

  it('latestSceneFor picks the highest scene, optionally per storyline', () => {
    expect(latestSceneFor(all)?.id).toBe('s4')
    expect(latestSceneFor(all, 'main')?.id).toBe('s3')
    expect(latestSceneFor(all, 'docks')?.id).toBe('s4')
    expect(latestSceneFor(all, 'nowhere')).toBeUndefined()
  })

  it('scenesOfStory returns the story scenes, or just the chat', () => {
    expect(scenesOfStory([s4, chat('x'), s1], s1).map((s) => s.id)).toEqual(['s1', 's4'])
    expect(scenesOfStory([s1, chat('x')], chat('x')).map((s) => s.id)).toEqual(['x'])
  })
})

describe('storyLanes', () => {
  it('puts the main line first and marks where a lane split off', () => {
    const lanes = storyLanes(story, [s4, s3, s2, s1])
    expect(lanes.map((l) => [l.name, l.scenes.map((s) => s.id)])).toEqual([
      ['Main story', ['s1', 's2', 's3']],
      ['At the docks', ['s4']],
    ])
    expect(lanes[0].splitFrom).toBeUndefined()
    expect(lanes[1].splitFrom?.id).toBe('s2')
  })

  it('still lists scenes on a storyline the story no longer names', () => {
    const lanes = storyLanes(undefined, [s1, s4])
    expect(lanes.map((l) => l.name)).toEqual(['Main story', 'Side storyline'])
  })
})

describe('transcript', () => {
  it('covers the chain leading to the scene, then the scene', () => {
    expect(transcriptScenes([s1, s2, s3, s4], 's4').map((s) => s.id)).toEqual(['s1', 's2', 's4'])
    expect(transcriptScenes([s1, s2, s3, s4], 's3').map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('shows the active swipe and skips failed turns', () => {
    expect(messageDisplayText({ text: 'a', swipes: ['a', 'b'], activeSwipe: 1 })).toBe('b')
    expect(messageDisplayText({ text: 'plain' })).toBe('plain')
    expect(messageDisplayText({ text: '', failed: true })).toBe('')
    const text = transcriptAsText('T', [{
      scene: { ...s1, recap: { text: 'They met.', presentIds: [], location: 'Inn', writtenAt: 1 } },
      messages: [{ name: 'Ann', text: 'Hi' }, { name: 'Bo', text: '', failed: true }],
    }])
    expect(text).toBe('# T\n\n## Scene 1 · Inn\n\nRecap: They met.\n\nAnn: Hi')
  })
})
