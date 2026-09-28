import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StoredMessage } from '@/lib/types'
import type { GmTurn } from '@/lib/world/gm'
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
