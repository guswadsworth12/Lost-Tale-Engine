import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { EndSceneDialog } from './EndSceneDialog'

const base = {
  open: true, onClose: () => {}, drafting: false, draft: { text: 'The ferry never came.', openThreads: [], lastingChanges: [] }, onRedraft: () => {},
  sceneLabel: 'Scene 2', cast: [], leadId: 'lead', storylines: [{ id: 'main', name: 'Main story' }], currentStorylineId: 'main', consequences: [],
  onConfirm: async () => {},
}
const chapter = { label: 'Chapter 1 · The Fog', nextNumber: 2, onDraft: async () => ({ text: '', openThreads: [] }) }

describe('ending a chapter from the End scene dialog', () => {
  it('offers to end the chapter along with the scene', () => {
    const html = renderToStaticMarkup(createElement(EndSceneDialog, { ...base, chapter: { ...chapter, canEnd: true } }))
    expect(html).toContain('Also end Chapter 1 · The Fog')
    expect(html).toContain('the next scene opens Chapter 2')
    expect(html).toContain('End scene and continue')
  })

  it('says so when the chapter already ended in another branch, and offers no way to end it again', () => {
    const html = renderToStaticMarkup(createElement(EndSceneDialog, { ...base, chapter: { ...chapter, canEnd: false } }))
    expect(html).toContain('already ended in another branch')
    expect(html).not.toContain('Also end')
  })

  it('shows no chapter controls without a chapter', () => {
    expect(renderToStaticMarkup(createElement(EndSceneDialog, base))).not.toContain('Chapter')
  })
})
