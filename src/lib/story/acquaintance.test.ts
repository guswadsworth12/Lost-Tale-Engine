import { describe, expect, it } from 'vitest'
import { nameSpoken, stillStrangers, strangerNote, strangersFor } from './acquaintance'

const names: Record<string, string> = { kell: 'Kell Ashby', mira: 'Mira Dace', wren: 'Wren', player: 'Tam Holloway' }
const nameOf = (id: string) => names[id]

describe('who a newcomer has met', () => {
  it('starts out knowing no one present, the player included, and not counting themselves', () => {
    expect(strangersFor('wren', ['kell', 'mira', 'wren'], 'player', 100)).toEqual({ ids: ['kell', 'mira', 'player'], since: 100 })
    expect(strangersFor('wren', ['kell', 'kell'], undefined, 5)).toEqual({ ids: ['kell'], since: 5 })
  })

  it('counts a name as heard only when it is said aloud, in full or by first name', () => {
    expect(nameSpoken('"Kell, get back!"', 'Kell Ashby')).toBe(true)
    expect(nameSpoken('“I’m Mira Dace,” she says.', 'Mira Dace')).toBe(true)
    // Narration names people; nobody said it.
    expect(nameSpoken('Kell steps forward. "Stay down."', 'Kell Ashby')).toBe(false)
    // A word that merely contains the name is not the name.
    expect(nameSpoken('"Kellerman sent us."', 'Kell Ashby')).toBe(false)
  })

  it('learns a name from speech they could hear after meeting, never from their own lines', () => {
    const record = { ids: ['kell', 'mira', 'player'], since: 100 }
    const messages = [
      { speakerId: 'kell', text: '"Mira, hold the door."', createdAt: 50 },
      { speakerId: 'wren', text: '"Kell? Is that you?"', createdAt: 120 },
      { speakerId: 'mira', text: '"Tam, sit down before you fall."', createdAt: 130, presentIds: ['mira', 'kell'] },
      { speakerId: 'kell', text: '"Thanks, Mira."', createdAt: 140, presentIds: ['kell', 'mira', 'wren'] },
    ]
    // Mira was named before Wren arrived and again after; Kell only by Wren; Tam where Wren wasn't.
    expect(stillStrangers('wren', record, messages, nameOf)).toEqual(['kell', 'player'])
  })

  it('reads the chosen swipe, and has nothing to say without a record', () => {
    const swiped = [{ speakerId: 'kell', text: '"Hello."', swipes: ['"Hello."', '"Hello, Tam."'], activeSwipe: 1, createdAt: 200 }]
    expect(stillStrangers('wren', { ids: ['player'], since: 100 }, swiped, nameOf)).toEqual([])
    expect(stillStrangers('wren', undefined, swiped, nameOf)).toEqual([])
  })

  it('tells the speaker whose names they do not know, and nothing when they know everyone', () => {
    expect(strangerNote('Wren', ['Kell Ashby'])).toContain('Wren has not been introduced to Kell Ashby and does not know that name.')
    expect(strangerNote('Wren', ['Kell Ashby', 'Mira Dace', 'Tam Holloway'])).toContain('Kell Ashby, Mira Dace and Tam Holloway and does not know their names')
    expect(strangerNote('Wren', [])).toBe('')
  })
})
