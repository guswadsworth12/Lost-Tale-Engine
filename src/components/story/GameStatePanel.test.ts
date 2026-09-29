import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { STARTER_PBTA_CAMPAIGN } from '@/lib/world/campaign'
import { gameStateFrom, type StateChange } from '@/lib/world/gameState'
import { GameStatePanel, holdersFor } from './GameStatePanel'

const tracks = STARTER_PBTA_CAMPAIGN.tracks!
const people = [{ id: 'wren', name: 'Wren' }, { id: 'bea', name: 'Bea' }]

describe('State tab', () => {
  it('shows each track with its value, whose it is, and what changed it', () => {
    const edits: StateChange[] = [{ trackId: 'supplies', delta: -1, source: 'roll', rollId: 'r1' }, { trackId: 'hurt', set: true, who: 'bea', source: 'gm' }]
    const { state, log } = gameStateFrom(tracks, undefined, [{ id: 'm1', stateEdits: edits }], { playerId: 'wren' })
    const html = renderToStaticMarkup(createElement(GameStatePanel, { tracks, state, log, people, playerId: 'wren', busy: false, onEdit: () => {} }))
    expect(html).toContain('Supplies')
    expect(html).toContain('2/3')
    expect(html).toContain('GM only')
    expect(html).toContain('Each scene')
    expect(html).toContain('Supplies 3 → 2')
    expect(html).toContain('Hurt on (Bea)')
    expect(html).toContain('GM, confirmed')
  })

  it('gives a per-character track a row for the player, the cast, and anyone already holding a value', () => {
    const hurt = tracks.find((t) => t.id === 'hurt')!
    expect(holdersFor(hurt, { 'hurt@cole': true }, people, 'wren').map((h) => h.id)).toEqual(['wren', 'bea', 'cole'])
    expect(holdersFor(hurt, {}, [], undefined)).toEqual([{ id: 'player', name: 'You' }])
  })
})
