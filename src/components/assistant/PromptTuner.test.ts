import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { GM_STYLE_GUIDANCE } from '@/lib/world/gm'
import { diffWords } from '@/lib/text/diff'

const world = {
  id: 'w1', name: 'Harbor', description: '', lorebook: { entries: [] }, createdAt: 1, updatedAt: 1,
  gmNotes: 'The keeper is gone.',
  promptOverrides: { scribe: 'Only promises.' },
  promptItems: [{ id: 'i1', name: 'Tone', content: 'Keep it grounded.', role: 'system', enabled: true }],
}
const bea = { id: 'bea', worldId: 'w1', card: { name: 'Bea' }, createdAt: 1, updatedAt: 1, promptItems: [{ id: 'c1', name: 'Voice', content: 'Speaks softly.', role: 'system', enabled: true }] }

vi.mock('@/lib/hooks/useApiQuery', () => ({
  useApiQuery: (key: string) => (key === 'worlds' ? [world] : key === 'characters' ? [bea] : undefined),
}))

const { PromptTuner, DiffView } = await import('./PromptTuner')

describe('PromptTuner', () => {
  const html = renderToStaticMarkup(createElement(PromptTuner, { onClose: () => {}, propose: async () => ({ text: '', reasoning: '' }) }))

  it('lists the engine prompts, the world\'s GM notes and items, and its cast\'s items', () => {
    for (const label of ['Game Master style', 'Memory scribe', 'Scene recap', 'Chapter recap', 'Character journal', 'GM notes', 'Tone', 'Voice']) expect(html).toContain(label)
    // A tuned prompt is marked as such.
    expect(html).toMatch(/Memory scribe<\/span><span[^>]*>Tuned/)
  })

  it('opens on the GM style with its guardrails locked and the engine default to edit', () => {
    expect(html).toContain('Always in the prompt')
    expect(html).toContain('Recorded rolls are binding. The GM never invents dice or changes a result.')
    expect(html).toContain('Using the engine default.')
    expect(html).toContain(GM_STYLE_GUIDANCE.split('\n')[0].slice(0, 60))
    expect(html).toContain('Preview on a sample turn')
    expect(html).toContain('No changes yet.')
  })

  it('shows a change as removed and added text', () => {
    const diff = renderToStaticMarkup(createElement(DiffView, { parts: diffWords('Keep it short.', 'Keep it long.') }))
    expect(diff).toContain('<del')
    expect(diff).toContain('>short.</del>')
    expect(diff).toContain('>long.</ins>')
  })
})
