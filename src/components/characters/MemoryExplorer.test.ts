import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ExplorerLayout, recallWhen } from './MemoryExplorer'
it('uses a full-width phone detail with a separate list, while retaining both desktop columns', () => {
  const html = renderToStaticMarkup(createElement(ExplorerLayout, { data: { deepMemory: false }, picked: true, list: 'People', detail: 'Details' }))
  expect(html).toContain('hidden md:block')
  expect(html).toContain('md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]')
  expect(html).toContain('Connections are recorded when Deep Memory is on.')
})
it('describes elapsed recalls without negative or fractional days', () => {
  expect(recallWhen(5 * 86400_000, 8 * 86400_000)).toBe('3 days ago')
  expect(recallWhen(5 * 86400_000, 4 * 86400_000)).toBe('today')
})
