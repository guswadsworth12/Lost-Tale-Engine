import { describe, expect, it } from 'vitest'
import { parseLorebookImport } from './importBook'

const entry = (id: number, keys: string[], content: string, extra: Record<string, unknown> = {}) => ({
  id,
  keys,
  content,
  enabled: true,
  insertion_order: 100,
  ...extra,
})

describe('parseLorebookImport', () => {
  it('reads a bare lorebook and keeps its settings', () => {
    const { name, book } = parseLorebookImport(
      {
        name: 'Harbor town',
        token_budget: 900,
        scan_depth: 6,
        entries: [entry(0, ['/\\bDock\\b/'], 'The docks close at dusk.', { insertion_order: 200, sticky: 2 })],
      },
      'file.json',
    )
    expect(name).toBe('Harbor town')
    expect(book.token_budget).toBe(900)
    expect(book.scan_depth).toBe(6)
    expect(book.entries[0].keys).toEqual(['/\\bDock\\b/'])
    expect(book.entries[0].insertion_order).toBe(200)
    expect(book.entries[0].sticky).toBe(2)
  })

  it('keeps an always-on entry always on', () => {
    const { book } = parseLorebookImport(
      { entries: [entry(0, [], 'It is winter.', { constant: true })] },
      'file.json',
    )
    expect(book.entries[0].constant).toBe(true)
    expect(book.entries[0].activationMode).toBe('always')
  })

  it('reads a World Info book row', () => {
    const { name, book } = parseLorebookImport(
      { name: 'Row name', book: { name: '', entries: [entry(0, ['inn'], 'The inn has three rooms.')] } },
      'file.json',
    )
    expect(name).toBe('Row name')
    expect(book.name).toBe('Row name')
    expect(book.entries).toHaveLength(1)
  })

  it('takes the lorebook out of a character card', () => {
    const { name, book } = parseLorebookImport(
      {
        spec: 'chara_card_v2',
        data: { name: 'Pip', character_book: { entries: [entry(0, ['kettle'], 'Pip hates the kettle.')] } },
      },
      'file.json',
    )
    expect(name).toBe('Pip lore')
    expect(book.entries[0].content).toBe('Pip hates the kettle.')
  })

  it('defaults scan depth to 8 when the file has none', () => {
    const { book } = parseLorebookImport({ entries: [entry(0, ['a'], 'b')] }, 'file.json')
    expect(book.scan_depth).toBe(8)
  })

  it('falls back to the file name when nothing is named', () => {
    const { name } = parseLorebookImport({ entries: [entry(0, ['a'], 'b')] }, 'my-lore.json')
    expect(name).toBe('my-lore.json')
  })

  it('refuses files with no lorebook or no entries', () => {
    expect(() => parseLorebookImport({ spec: 'chara_card_v2', data: { name: 'Pip' } }, 'f')).toThrow(/no lorebook/)
    expect(() => parseLorebookImport({ entries: [] }, 'f')).toThrow(/no entries/)
    expect(() => parseLorebookImport('nope', 'f')).toThrow()
  })
})
