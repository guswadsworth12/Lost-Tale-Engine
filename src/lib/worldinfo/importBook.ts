import { normalizeLorebook, type Lorebook } from '@/lib/characters/cardSpec'

/**
 * Reads a lorebook out of an imported JSON file for World Info. Accepts the three shapes Lost Tales
 * itself produces: a bare lorebook (`{ entries: [...] }`), a World Info book row (`{ name, book }`),
 * or a character card whose `character_book` should become a standalone book. Throws a readable
 * message when the file holds no usable entries.
 */
export function parseLorebookImport(raw: unknown, fallbackName: string): { name: string; book: Lorebook } {
  if (!raw || typeof raw !== 'object') throw new Error('That file isn\'t a lorebook.')
  const obj = raw as Record<string, unknown>
  const card = (obj.data && typeof obj.data === 'object' ? obj.data : obj) as Record<string, unknown>

  let source: unknown
  let name = ''
  if (obj.book && typeof obj.book === 'object') {
    source = obj.book
    name = typeof obj.name === 'string' ? obj.name : ''
  } else if (card.character_book && typeof card.character_book === 'object') {
    source = card.character_book
    name = typeof card.name === 'string' && card.name.trim() ? `${card.name.trim()} lore` : ''
  } else if ('entries' in obj) {
    source = obj
  } else {
    throw new Error('That file has no lorebook in it.')
  }

  const book = normalizeLorebook(source)
  if (!book || book.entries.length === 0) throw new Error('That lorebook has no entries.')
  // New books made on the page scan the last 8 messages; keep that unless the file says otherwise.
  if (typeof (source as Record<string, unknown>).scan_depth !== 'number') book.scan_depth = 8
  const finalName = (book.name ?? '').trim() || name.trim() || fallbackName
  return { name: finalName, book: { ...book, name: finalName } }
}
