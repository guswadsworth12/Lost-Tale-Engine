import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StoredMessage } from '@/lib/types'
import type { GmTurn } from '@/lib/world/gm'
import { STARTER_PBTA_CAMPAIGN } from '@/lib/world/campaign'
import { CampaignRollBadge, GmActionsContext, GmTurnCard } from './GmTurnCard'

const turn = (adjudication: GmTurn['adjudication']): GmTurn => ({
  mode: 'mechanical', ruleset: 'Test', narration: '', pacing: 'linger', speakerIds: [],
  adjudication, proposals: [], scenery: 'Hall',
})

describe('GM check controls', () => {
  it('offers the required roll only for the active unresolved check', () => {
    const message = { id: 'gm-1', gm: turn({ action: 'I force the door.', source: 'roll_needed', moveId: 'risk', moveName: 'Take a Risk', outcome: 'Roll.' }) } as StoredMessage
    const active = renderToStaticMarkup(createElement(GmActionsContext.Provider, {
      value: { pendingCheckMessageId: 'gm-1', rollForCheck: () => {} },
      children: createElement(GmTurnCard, { message }),
    }))
    const old = renderToStaticMarkup(createElement(GmActionsContext.Provider, {
      value: { pendingCheckMessageId: 'other', rollForCheck: () => {} },
      children: createElement(GmTurnCard, { message }),
    }))
    expect(active).toContain('Roll Take a Risk')
    expect(old).not.toContain('Roll Take a Risk')
  })

  it('makes a recorded miss visibly a failed check', () => {
    const message = { id: 'user-1', campaignRoll: { moveName: 'Take a Risk', dice: [1, 2], modifier: 0, stat: 'Nerve', total: 3, tier: 'miss' } } as StoredMessage
    expect(renderToStaticMarkup(createElement(CampaignRollBadge, { message }))).toContain('Failed check')
  })
})

describe('GM tracked state', () => {
  const tracks = STARTER_PBTA_CAMPAIGN.tracks!
  const people = [{ id: 'wren', name: 'Wren' }, { id: 'bea', name: 'Bea' }]
  const render = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(GmActionsContext.Provider, {
    value: { tracks, people, decideProposal: () => {} },
    children: element,
  }))

  it('shows what a roll and a GM turn changed', () => {
    const roll = { id: 'user-1', campaignRoll: { moveName: 'Push Through', dice: [1, 2], modifier: 0, stat: 'Grit', total: 3, tier: 'miss',
      stateChanges: [{ trackId: 'hurt', set: true, who: 'wren', source: 'roll', rollId: 'r1' }] } } as StoredMessage
    expect(render(createElement(CampaignRollBadge, { message: roll }))).toContain('Hurt on for Wren')
    const chosen = { id: 'gm-2', gm: { ...turn(undefined), stateChanges: [{ trackId: 'supplies', delta: -1, source: 'choice', rollId: 'r1' }] } } as StoredMessage
    expect(render(createElement(GmTurnCard, { message: chosen }))).toContain('State: Supplies -1')
  })

  it('offers a pending proposed change for correction, and shows a decided one as it stands', () => {
    const proposal = (status: 'pending' | 'confirmed') => ({ id: 'p1', scope: 'branch' as const, text: 'Bea turns an ankle.', status, changes: [{ trackId: 'hurt', set: true, who: 'bea' }] })
    const pending = render(createElement(GmTurnCard, { message: { id: 'gm-3', gm: { ...turn(undefined), proposals: [proposal('pending')] } } as StoredMessage }))
    expect(pending).toContain('aria-label="State change for: Bea turns an ankle."')
    expect(pending).toContain('value="Hurt on for Bea"')
    const confirmed = render(createElement(GmTurnCard, { message: { id: 'gm-4', gm: { ...turn(undefined), proposals: [proposal('confirmed')] } } as StoredMessage }))
    expect(confirmed).toContain('State: Hurt on for Bea')
    expect(confirmed).not.toContain('<input')
  })
})
