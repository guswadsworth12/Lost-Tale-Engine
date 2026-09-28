import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CAMPAIGN_PRESETS, STARTER_PBTA_CAMPAIGN } from '@/lib/world/campaign'
import { CampaignMovePanel } from './CampaignMovePanel'

const props = {
  campaign: STARTER_PBTA_CAMPAIGN,
  onClose: () => {},
  onSubmit: async () => {},
}

describe('campaign move modifier display', () => {
  it('shows a saved player sheet modifier instead of a manual input', () => {
    const html = renderToStaticMarkup(createElement(CampaignMovePanel, {
      ...props, playerName: 'Wren', sheet: { stats: { nerve: 2 } },
    }))
    expect(html).toContain('Wren’s Nerve: +2 from the character sheet')
    expect(html).not.toContain('No player character sheet is selected')
  })

  it('keeps manual rolls available to older stories without a sheet', () => {
    const html = renderToStaticMarkup(createElement(CampaignMovePanel, props))
    expect(html).toContain('No sheet is saved for this story')
    expect(html).toContain('Nerve modifier')
  })

  it('shows a raw d20 score as a derived bonus and locks a GM-set DC', () => {
    const campaign = CAMPAIGN_PRESETS.find((entry) => entry.id === 'dnd-5-2')!.campaign
    const html = renderToStaticMarkup(createElement(CampaignMovePanel, { ...props, campaign,
      sheet: { stats: { strength: 18 } }, pendingCheck: { messageId: 'gm-1', moveId: campaign.moves[0].id, action: 'Lift the gate', target: 20 } }))
    expect(html).toContain('18 score gives +4')
    expect(html).toContain('Difficulty set by the GM: 20')
    expect(html).not.toContain('Difficulty class')
  })
})
