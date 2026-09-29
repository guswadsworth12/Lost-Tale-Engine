import { describe, expect, it } from 'vitest'
import { DEFAULT_PACK_SELECTION } from './contract'
import { defaultResolutions, formatBytes, lineFor, mayChangeVisibility, replacesAnything, rowChecked, toggleRow, uploadEntries } from './ui'

const withPath = (name: string, relative: string) => Object.assign(new File(['x'], name), { webkitRelativePath: relative })

describe('pack dialog helpers', () => {
  it('sizes bytes for people', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB')
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB')
  })

  it('toggles top-level and media rows', () => {
    const off = toggleRow(DEFAULT_PACK_SELECTION, 'media:music', false)
    expect(rowChecked(off, 'media:music')).toBe(false)
    expect(rowChecked(off, 'media:sprites')).toBe(true)
    expect(rowChecked(toggleRow(DEFAULT_PACK_SELECTION, 'gmNotes', true), 'gmNotes')).toBe(true)
    expect(DEFAULT_PACK_SELECTION.media.music).toBe(true)
    expect(lineFor([{ label: 'Music', media: 'music', count: 2 }, { label: 'Cast', count: 3 }], 'media:music')).toEqual({ label: 'Music', media: 'music', count: 2 })
    expect(lineFor([{ label: 'Cast', count: 3 }], 'cast')?.count).toBe(3)
  })

  it('sends a zip as itself and a folder file by file, and nothing else', () => {
    const zip = new File(['x'], 'Salt Coast.ltpack.zip')
    expect(uploadEntries([zip])).toEqual([{ path: 'Salt Coast.ltpack.zip', file: zip }])
    const folder = [withPath('manifest.json', 'Salt Coast.ltpack/manifest.json'), withPath('world.json', 'Salt Coast.ltpack/content/world.json')]
    expect(uploadEntries(folder).map((e) => e.path)).toEqual(['Salt Coast.ltpack/manifest.json', 'Salt Coast.ltpack/content/world.json'])
    expect(uploadEntries([new File(['x'], 'notes.txt')])).toEqual([])
  })

  it('starts every conflict as a copy, and knows when a replace needs confirming', () => {
    const resolutions = defaultResolutions([{ key: 'world', kind: 'world', name: 'X', existingId: '1' }])
    expect(resolutions).toEqual({ world: 'copy' })
    expect(replacesAnything(resolutions)).toBe(false)
    expect(replacesAnything({ ...resolutions, 'character-1': 'replace' })).toBe(true)
  })

  it('lets only the owner change visibility, or the site owner for an ownerless row', () => {
    expect(mayChangeVisibility({ ownerUserId: 'a' }, { id: 'a', role: 'member' })).toBe(true)
    expect(mayChangeVisibility({ ownerUserId: 'a' }, { id: 'b', role: 'owner' })).toBe(false)
    expect(mayChangeVisibility({}, { id: 'b', role: 'owner' })).toBe(true)
    expect(mayChangeVisibility({}, { id: 'b', role: 'member' })).toBe(false)
    expect(mayChangeVisibility({}, null)).toBe(false)
  })
})
