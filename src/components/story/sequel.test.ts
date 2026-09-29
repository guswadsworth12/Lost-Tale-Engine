import { describe, expect, it } from 'vitest'
import type { Chat, Story } from '@/lib/types'
import { lastScene, sequelCandidates } from './sequel'

const story = (over: Partial<Story>): Story => ({ id: 's', title: 'T', createdAt: 0, updatedAt: 0, ...over })
const scene = (over: Partial<Chat>): Chat => ({ id: 'c', characterId: 'ash', title: 'T', createdAt: 0, updatedAt: 0, ...over }) as Chat

describe('sequelCandidates', () => {
  it('lists other stories in the same world, newest first, never one that already continues from this', () => {
    const current = story({ id: 'now', worldId: 'w1' })
    const stories = [
      current,
      story({ id: 'older', worldId: 'w1', updatedAt: 1 }),
      story({ id: 'newer', worldId: 'w1', updatedAt: 2 }),
      story({ id: 'elsewhere', worldId: 'w2', updatedAt: 3 }),
      story({ id: 'loop', worldId: 'w1', continuesFrom: { storyId: 'now', sceneId: 'x' } }),
      story({ id: 'worldless' }),
    ]
    expect(sequelCandidates(stories, current).map((s) => s.id)).toEqual(['newer', 'older'])
    expect(sequelCandidates(stories, story({ id: 'free' })).map((s) => s.id)).toEqual(['worldless'])
  })
})

describe('lastScene', () => {
  it('picks the highest scene number, the later one on a tie', () => {
    expect(lastScene([])).toBeUndefined()
    const scenes = [
      scene({ id: 'one', sceneNumber: 1 }),
      scene({ id: 'three-a', sceneNumber: 3, createdAt: 5 }),
      scene({ id: 'two', sceneNumber: 2 }),
      scene({ id: 'three-b', sceneNumber: 3, createdAt: 9 }),
    ]
    expect(lastScene(scenes)?.id).toBe('three-b')
  })
})

describe('StoryScenes sequel link', () => {
  it('shows "Continues from" only when asked, with its explanation', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { StoryScenes } = await import('./StoryScenes')
    const props = { story: story({ id: 'now' }), scenes: [scene({ id: 'c1', storyId: 'now', sceneNumber: 1 })] }
    expect(renderToStaticMarkup(createElement(StoryScenes, props))).not.toContain('Continues from')
    const html = renderToStaticMarkup(createElement(StoryScenes, { ...props, showSequelLink: true }))
    expect(html).toContain('Continues from')
    expect(html).toContain('Characters keep what they remembered by the end of that story. Leave empty for a fresh start.')
    expect(html).toMatch(/<option value=""[^>]*>None<\/option>/)
  })
})
