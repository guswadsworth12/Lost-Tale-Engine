import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { VNDialogueBox } from './VNDialogueBox'

const base = {
  speakerName: 'Game Master',
  speakerAvatarUrl: '/gm.png',
  initials: 'GM',
  plate: { name: 'white', chip: 'black' },
  writing: false,
  composer: null,
  personaLabel: 'Player',
  children: 'The gate opens.',
}

describe('VNDialogueBox', () => {
  it('renders GM narration as prose without a portrait or nameplate', () => {
    const html = renderToStaticMarkup(createElement(VNDialogueBox, { ...base, narration: true }))
    expect(html).toContain('The gate opens.')
    expect(html).toContain('font-serif italic')
    expect(html).not.toContain('Game Master')
    expect(html).not.toContain('/gm.png')
  })

  it('keeps ordinary speaker identity', () => {
    const html = renderToStaticMarkup(createElement(VNDialogueBox, base))
    expect(html).toContain('Game Master')
    expect(html).toContain('/gm.png')
  })
})
