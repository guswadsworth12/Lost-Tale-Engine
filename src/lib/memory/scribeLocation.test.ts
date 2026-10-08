import { expect, it } from 'vitest'
import { scribeMemoryRows, type ScribeAdd } from './scribe'

it('stamps replayed places at source messages, independently of the module switch', () => {
  const additions: ScribeAdd[] = ['before', 'after'].map((messageId) => ({
    messageId, text: 'Brisa crossed the quay.', kind: 'event', certainty: 'firsthand',
    importance: 0.5, witnessIds: ['brisa'], aboutIds: [],
  }))
  const branch = [
    { id: 'before', role: 'char' },
    { id: 'move', role: 'gm', gm: { setting: { location: 'Ferry Landing' } } },
    { id: 'after', role: 'char' },
    { id: 'later', role: 'user', sceneSetting: { location: 'Orchard' } },
  ]
  const rows = scribeMemoryRows(additions, 'scene', branch, { location: 'Opening court' }, () => '')
  expect(rows.map((r) => r.location)).toEqual(['Opening court', 'Ferry Landing'])
  expect(rows[1]).toMatchObject({ sourceMessageId: 'after', origin: 'scribe', chatId: 'scene' })
  expect(scribeMemoryRows(additions.slice(0, 1), 'scene', [], undefined, () => '')[0].location).toBeUndefined()
})
