import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { GmPlayedEditor, playedFromDrafts } from './GmPlayedEditor'
import { StoryScenes } from './StoryScenes'
import type { Chat } from '@/lib/types'

const bind = { id: 'bind-emily', trigger: 'Rend binds the Unbound into Emily\'s form', outcome: 'It holds.' }
const emily = { id: 'emily', name: 'Emily', forms: [{ id: 'cat', label: 'Cat' }] }

describe('GM-played characters', () => {
  it('saves only entries with a character and a description', () => {
    expect(playedFromDrafts([
      { characterId: 'emily', as: '  the Unbound ', until: 'bind-emily', form: 'cat' },
      { characterId: '', as: 'nobody' },
      { characterId: 'emily', as: ' ' },
    ])).toEqual([{ characterId: 'emily', as: 'the Unbound', until: 'bind-emily', form: 'cat' }])
  })

  it('shows who the GM plays, until what, and the form they take', () => {
    const props = { events: [bind], characters: [emily], onSave: async () => {} }
    const held = renderToStaticMarkup(createElement(GmPlayedEditor, { ...props, doneIds: [], played: [{ characterId: 'emily', as: 'the Unbound', until: 'bind-emily', form: 'cat' }] }))
    expect(held).toContain('GM plays them')
    expect(held).toContain('Rend binds the Unbound into Emily&#x27;s form')
    expect(held).toContain('Then appears as')
    const handed = renderToStaticMarkup(createElement(GmPlayedEditor, { ...props, doneIds: ['bind-emily'], played: [{ characterId: 'emily', as: 'the Unbound', until: 'bind-emily' }] }))
    expect(handed).toContain('Handed over')
  })
})

describe('deleting a scene from the list', () => {
  const scene = (id: string, n: number) => ({ id, storyId: 'st', sceneNumber: n, title: 'Low Tide', characterId: 'bea', createdAt: n, updatedAt: n }) as Chat
  const onDeleteScene = async () => {}

  it('offers Delete on each scene while the story has more than one', () => {
    const two = renderToStaticMarkup(createElement(StoryScenes, { scenes: [scene('a', 1), scene('b', 2)], currentSceneId: 'b', onDeleteScene }))
    expect(two.match(/aria-label="Delete Scene/g)).toHaveLength(2)
    const one = renderToStaticMarkup(createElement(StoryScenes, { scenes: [scene('a', 1)], currentSceneId: 'a', onDeleteScene }))
    expect(one).not.toContain('aria-label="Delete')
  })
})
