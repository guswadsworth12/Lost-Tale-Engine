import { describe, expect, it } from 'vitest'
import { draftOf, eventsFromDrafts, setEventId, wordsToMatch } from './setEvents'

describe('set event drafts', () => {
  it('reads required words and alternatives from one line', () => {
    expect(wordsToMatch('bind, Lyra | sleeper ,, ')).toEqual(['bind', 'Lyra|sleeper'])
    expect(wordsToMatch('')).toEqual([])
  })

  it('makes a readable, unique id from the trigger', () => {
    expect(setEventId("Wren binds Lyra's form", [])).toBe('wren-binds-lyras-form')
    expect(setEventId("Wren binds Lyra's form", ['wren-binds-lyras-form'])).toBe('wren-binds-lyras-form-2')
    expect(setEventId('!!!', [])).toBe('event')
  })

  it('round-trips a saved event and drops drafts that cannot happen', () => {
    const saved = { id: 'bind-lyra', trigger: 'Wren binds Lyra', outcome: 'It holds.', consequence: 'Wren is strained.', match: ['bind', 'Lyra|sleeper'] }
    expect(eventsFromDrafts([draftOf(saved)])).toEqual([saved])
    expect(eventsFromDrafts([{ id: '', trigger: 'Only a trigger', outcome: ' ', consequence: '', words: '' }])).toEqual([])
    expect(eventsFromDrafts([{ id: '', trigger: 'Wren wakes the bell', outcome: 'It rings.', consequence: '', words: '' }]))
      .toEqual([{ id: 'wren-wakes-the-bell', trigger: 'Wren wakes the bell', outcome: 'It rings.' }])
  })
})
