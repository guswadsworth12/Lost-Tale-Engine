import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { Chat, Story } from '@/lib/types'
import { StoryScenes } from './StoryScenes'
import { EndedSceneBanner } from './EndedSceneBanner'

const chat = (id: string, extra: Partial<Chat> = {}) =>
  ({ id, title: id, characterId: 'c', createdAt: 0, updatedAt: 0, storyId: 'st', ...extra }) as Chat

const s1 = chat('s1', { sceneNumber: 1, endedAt: 1, recap: { text: 'They met at the inn.', presentIds: [], location: 'The inn', writtenAt: 1 } })
const s2 = chat('s2', { sceneNumber: 2, previousSceneId: 's1', sceneTitle: 'The cistern' })
const s3 = chat('s3', { sceneNumber: 3, previousSceneId: 's1', storylineId: 'docks' })
const story: Story = { id: 'st', title: 'Night', storylines: [{ id: 'docks', name: 'At the docks' }], createdAt: 0, updatedAt: 0 }

describe('StoryScenes', () => {
  it('lists lanes in order, marks the current scene and where a lane split off', () => {
    const html = renderToStaticMarkup(createElement(StoryScenes, { story, scenes: [s3, s2, s1], currentSceneId: 's2', onOpenScene: () => {} }))
    expect(html.indexOf('Main story')).toBeLessThan(html.indexOf('At the docks'))
    expect(html).toContain('Split from Scene 1')
    expect(html).toContain('Scene 2 · The cistern')
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('They met at the inn.')
    expect(html).toContain('The inn')
    expect(html.match(/<ol/g)?.length).toBe(2)
  })

  it('omits lane headings for a single storyline', () => {
    const html = renderToStaticMarkup(createElement(StoryScenes, { scenes: [s1, s2], currentSceneId: 's2' }))
    expect(html).not.toContain('Main story')
  })
})

describe('EndedSceneBanner', () => {
  it('says the scene ended, offers the recap and the next scene', () => {
    const html = renderToStaticMarkup(createElement(EndedSceneBanner, { scene: s1, nextScene: s2, onOpenScene: () => {} }))
    expect(html).toContain('This scene has ended.')
    expect(html).toContain('<details')
    expect(html).toContain('Continue in Scene 2 · The cistern')
  })

  it('has no continue button without a next scene', () => {
    expect(renderToStaticMarkup(createElement(EndedSceneBanner, { scene: s1 }))).not.toContain('Continue in')
  })
})
