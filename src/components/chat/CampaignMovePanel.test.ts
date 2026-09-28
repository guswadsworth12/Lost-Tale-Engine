import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { STARTER_PBTA_CAMPAIGN } from '@/lib/world/campaign'
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
    expect(html).toContain('No player character sheet is selected')
    expect(html).toContain('Nerve modifier')
  })
})
