import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, StoredMessage, WorldCard } from '@/lib/types'
import { PictureThisDialog, appearanceOf } from './PictureThisDialog'

const bea = { id: 'bea', card: { name: 'Bea', description: 'A ferry pilot with short grey hair. She rarely smiles.' }, outfits: [{ id: 'coat', label: 'oilskin coat' }, { id: 'seal', label: 'seal', kind: 'form' }], createdAt: 1, updatedAt: 1 } as unknown as Character
const chat = { id: 'c1', characterId: 'bea', title: 'Night', createdAt: 1, updatedAt: 1, scene: { turnPolicy: 'manual', appearanceOverrides: { bea: 'coat' } } } as unknown as Chat
const world = { id: 'w1', name: 'Harbor', description: '', lorebook: { entries: [] }, artStyle: 'Watercolor, muted colors', createdAt: 1, updatedAt: 1 } as unknown as WorldCard
const message = { id: 'm1', chatId: 'c1', role: 'char', name: 'Bea', text: 'She cuts the engine and listens.', createdAt: 1 } as unknown as StoredMessage

describe('Picture this', () => {
  it('describes how someone looks now, outfit or form included', () => {
    expect(appearanceOf(bea, chat)).toBe('A ferry pilot with short grey hair, wearing oilskin coat')
    expect(appearanceOf(bea, { scene: { turnPolicy: 'manual', appearanceOverrides: { bea: 'seal' } } } as never)).toBe('A ferry pilot with short grey hair, in seal form')
  })

  it('opens with the three kinds and a prompt drafted from the scene, for free', () => {
    const html = renderToStaticMarkup(createElement(PictureThisDialog, { chat, world, cast: [bea], message, location: 'the pier', timeOfDay: 'night', improve: async (p) => p, onClose: () => {} }))
    for (const kind of ['Moment', 'Background for this location', 'Portrait']) expect(html).toContain(kind)
    expect(html).toContain('Bea (A ferry pilot with short grey hair, wearing oilskin coat) at the pier, night. The moment: Bea: She cuts the engine and listens. Watercolor, muted colors.')
    expect(html).toContain('Improve with the story model')
    expect(html).toContain('value="She cuts the engine and listens."')
  })

  it('offers no background without a world, and no portrait without anyone present', () => {
    const html = renderToStaticMarkup(createElement(PictureThisDialog, { chat, cast: [], improve: async (p) => p, onClose: () => {} }))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Background for this location/)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Portrait/)
  })
})
