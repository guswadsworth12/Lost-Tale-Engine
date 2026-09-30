import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { RulesetDraft } from '@/lib/assistant/thread'
import { RulesetCard } from './RulesetCard'

const draft: RulesetDraft = {
  name: 'Harbor Rules',
  summary: 'A d6 pool.',
  custom: {
    dice: { count: 0, sides: 6, pool: true, keep: { which: 'highest', count: 1 } },
    compare: 'result',
    bands: [{ label: 'Success', tier: 'strong', min: 6 }, { label: 'Partial', tier: 'mixed', min: 4, max: 5 }, { label: 'Bad', tier: 'miss', max: 3 }],
  },
  errors: [],
  stats: [{ name: 'Prowl' }],
  moves: [{ name: 'Sneak', trigger: 'you move unseen', stat: 'Prowl', strong: 'Unseen.', mixed: 'Seen.', miss: 'Caught.' }],
}
const noop = async () => {}
const render = (d: RulesetDraft, worlds = [{ id: 'w1', name: 'Docks' }]) =>
  renderToStaticMarkup(createElement(RulesetCard, { draft: d, worlds, onEdit: noop, onApply: noop, onUndo: noop, onTryGm: async () => ({}) as never }))

describe('RulesetCard', () => {
  it('shows a ready draft\'s dice and outcomes, a test bench, and where to apply it', () => {
    const html = render(draft)
    expect(html).toContain('Roll a pool of d6 equal to the sheet value')
    expect(html).toContain('Result 4 to 5: Partial (mixed)')
    expect(html).toContain('Test bench')
    expect(html).toContain('Stat (dice)')
    expect(html).toContain('Apply to world')
    expect(html).not.toContain('Fix these before')
  })

  it('lists what to fix and hides the bench and apply until it is fixed', () => {
    const html = render({ ...draft, errors: ['Nothing covers 4 to 5, between Bad and Success.'] })
    expect(html).toContain('Fix these before testing or applying')
    expect(html).toContain('Nothing covers 4 to 5, between Bad and Success.')
    expect(html).not.toContain('Test bench')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply to world/)
  })

  it('offers undo once applied, and says so after an undo', () => {
    expect(render({ ...draft, appliedAt: 1, appliedWorldId: 'w1', appliedWorldName: 'Docks', appliedRevisionIds: ['r1'] })).toContain('Applied to Docks.')
    expect(render({ ...draft, appliedAt: 1, appliedWorldName: 'Docks', undoneAt: 2 })).toContain('Undone. Docks&#x27;s earlier rules are back.')
  })
})
