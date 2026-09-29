import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PACK_SELECTION, type PackPreview } from '@/lib/packs/contract'
import type { PackExportPreview } from '@/lib/api/client'
import { ImportPreviewView } from './ImportPackDialog'
import { ExportChecklist } from './ExportPackDialog'

const preview: PackPreview = {
  previewId: 'p1',
  manifest: {
    kind: 'lost-tales-world-pack', formatVersion: 1, appVersion: '0.1.0', exportedAt: 1,
    title: 'Salt Coast', author: 'Ash', licence: 'CC-BY-4.0', description: 'A foggy coast.',
    credits: [{ title: 'Fog theme', author: 'Bea', licence: 'CC0-1.0' }],
    selection: DEFAULT_PACK_SELECTION, included: [], excluded: ['GM notes', 'Player cards (1)'], media: [],
  },
  creates: { world: 'Salt Coast', characters: ['Cole Marsh', 'Wren'], lorebooks: ['Coast lore'] },
  mediaBytes: 3 * 1024 * 1024,
  mediaCount: 4,
  conflicts: [{ key: 'world', kind: 'world', name: 'Salt Coast', existingId: 'w1' }, { key: 'character-1', kind: 'character', name: 'Cole Marsh', existingId: 'c1' }],
  droppedReferences: ['"Coast lore" was bound to something outside the pack; that binding was left out.'],
  warnings: ['abc.png is not the kind of file its name says. It was left out.'],
  expiresAt: 2,
}

const renderPreview = (resolutions: Record<string, 'copy' | 'skip' | 'replace'>, confirmReplace = false) =>
  renderToStaticMarkup(createElement(ImportPreviewView, { preview, resolutions, onResolve: () => {}, confirmReplace, onConfirmReplace: () => {} }))

describe('import preview', () => {
  it('shows what the pack creates, its credits, and what was left out, before anything is written', () => {
    const html = renderPreview({ world: 'copy', 'character-1': 'copy' })
    for (const text of ['Salt Coast', 'By Ash', 'Licence: CC-BY-4.0', 'Cole Marsh, Wren', 'Coast lore', '4 files, 3.0 MB', 'Fog theme by Bea', 'GM notes', 'Player cards (1)', 'binding was left out', 'not the kind of file', 'imported as yours alone']) {
      expect(html, text).toContain(text)
    }
  })

  it('offers a choice for each conflict, and asks to confirm only when replacing', () => {
    const copying = renderPreview({ world: 'copy', 'character-1': 'copy' })
    expect(copying).toContain('aria-label="What to do with Salt Coast"')
    expect(copying).toContain('aria-label="What to do with Cole Marsh"')
    expect(copying).toContain('Import as a copy')
    expect(copying).not.toContain('Replace overwrites')
    const replacing = renderPreview({ world: 'replace', 'character-1': 'copy' })
    expect(replacing).toContain('Replace overwrites what you have')
  })
})

describe('export checklist', () => {
  const exportPreview: PackExportPreview = {
    included: [{ label: 'Cast', count: 2 }, { label: 'World-info books', count: 1 }, { label: 'Music', media: 'music', count: 1, bytes: 2048 }],
    excluded: ['Stories, scenes, chats, and messages', 'GM notes'],
    droppedReferences: ['"Coast lore" is also bound to chats; chats never travel.'],
    characters: [{ id: 'c1', name: 'Cole Marsh', playerOnly: false, included: true }, { id: 'w', name: 'Wren', playerOnly: true, included: false }],
    media: [],
    mediaBytes: 2048,
    missingMedia: 1,
  }

  it('lists each choice with its count and size, private options off, and what stays behind', () => {
    const html = renderToStaticMarkup(createElement(ExportChecklist, { selection: DEFAULT_PACK_SELECTION, preview: exportPreview, onChange: () => {} }))
    expect(html).toContain('Music')
    expect(html).toContain('1 · 2.0 KB')
    expect(html).toContain('Off by default')
    expect(html).toContain('Cole Marsh')
    expect(html).not.toContain('>Wren<')
    expect(html).toContain('Stories, scenes, chats, and messages')
    expect(html).toContain('chats never travel')
    expect(html).toContain('1 media file is missing')
    // GM notes, off by default, renders unchecked; Lore renders checked.
    expect(html).toMatch(/<input type="checkbox" class="mt-1"\/><span class="flex-1">GM notes/)
    expect(html).toMatch(/<input type="checkbox" class="mt-1" checked=""\/><span class="flex-1">Lore/)
  })
})
