import { describe, expect, it } from 'vitest'
import { historySinceJoined, historyWitnessedBy, joinedAtIndex, messageWitnesses, narrowWitnesses, witnessedMessage } from './witnesses'
import type { Chat, StoredMessage } from '@/lib/types'

function chat(overrides: Partial<Chat> = {}): Chat {
  return { id: 'c1', characterId: 'ash', title: 't', createdAt: 0, updatedAt: 0, ...overrides } as Chat
}

let n = 0
function msg(overrides: Partial<StoredMessage> = {}): StoredMessage {
  n++
  return { id: `m${n}`, chatId: 'c1', role: 'char', name: 'x', text: `line ${n}`, createdAt: n, ...overrides }
}

describe('messageWitnesses', () => {
  it('uses recorded presentIds, plus speaker and player card', () => {
    const c = chat({ participants: ['bea', 'cole'], playerCharacterId: 'dara' })
    expect(messageWitnesses(msg({ presentIds: ['bea'], speakerId: 'cole' }), c)).toEqual(['bea', 'cole', 'dara'])
  })

  it('falls back to the scene present cast when the message has no presentIds', () => {
    const c = chat({ participants: ['bea', 'cole'], scene: { turnPolicy: 'manual', presentCharacterIds: ['bea'] } })
    expect(messageWitnesses(msg({ role: 'user' }), c)).toEqual(['bea'])
  })

  it('falls back to the chat roster when there is no scene presence either', () => {
    const c = chat({ participants: ['bea', 'cole'], playerCharacterId: 'dara' })
    expect(messageWitnesses(msg({ role: 'user' }), c)).toEqual(['ash', 'bea', 'cole', 'dara'])
  })

  it('counts the primary as speaker of a char message without speakerId', () => {
    const c = chat({ scene: { turnPolicy: 'manual', presentCharacterIds: ['bea'] } })
    expect(messageWitnesses(msg({ role: 'char' }), c)).toEqual(['bea', 'ash'])
  })

  it('dedupes while keeping first-seen order', () => {
    const c = chat({ playerCharacterId: 'bea' })
    expect(messageWitnesses(msg({ presentIds: ['bea', 'ash', 'bea'], speakerId: 'ash' }), c)).toEqual(['bea', 'ash'])
  })
})

describe('narrowWitnesses', () => {
  const base = ['ash', 'bea', 'cole']
  it('narrows to the requested subset in base order', () => {
    expect(narrowWitnesses(base, ['cole', 'ash'])).toEqual(['ash', 'cole'])
  })
  it('never widens: ids outside base are dropped', () => {
    expect(narrowWitnesses(base, ['bea', 'dara'])).toEqual(['bea'])
  })
  it('returns base for an empty, missing, or disjoint request', () => {
    expect(narrowWitnesses(base, [])).toEqual(base)
    expect(narrowWitnesses(base, undefined)).toEqual(base)
    expect(narrowWitnesses(base, ['dara'])).toEqual(base)
  })
})

describe('joinedAtIndex / historySinceJoined', () => {
  it('treats a legacy chat with no presence data as always present', () => {
    const msgs = [msg(), msg(), msg()]
    expect(joinedAtIndex(msgs, 'dara')).toBe(0)
    expect(historySinceJoined(msgs, 'dara')).toHaveLength(3)
  })

  it('slices off what happened before a mid-scene arrival', () => {
    const msgs = [
      msg({ presentIds: ['ash', 'bea'] }),
      msg({ presentIds: ['ash', 'bea'] }),
      msg({ presentIds: ['ash', 'bea', 'cole'] }),
      msg({ presentIds: ['ash', 'bea', 'cole'] }),
    ]
    expect(joinedAtIndex(msgs, 'cole')).toBe(2)
    expect(historySinceJoined(msgs, 'cole').map((m) => m.id)).toEqual([msgs[2].id, msgs[3].id])
    expect(joinedAtIndex(msgs, 'ash')).toBe(0)
  })

  it('counts speaking as having joined', () => {
    const msgs = [msg({ presentIds: ['ash'] }), msg({ presentIds: ['ash'], speakerId: 'bea' })]
    expect(joinedAtIndex(msgs, 'bea')).toBe(1)
  })

  it('returns an empty history for someone who has not arrived yet', () => {
    const msgs = [msg({ presentIds: ['ash'] }), msg({ presentIds: ['ash', 'bea'] })]
    expect(joinedAtIndex(msgs, 'dara')).toBe(msgs.length)
    expect(historySinceJoined(msgs, 'dara')).toEqual([])
  })

  it('treats pre-tracking messages at the start of an upgraded chat as seen by everyone', () => {
    const msgs = [msg(), msg({ presentIds: ['ash'] })]
    expect(joinedAtIndex(msgs, 'bea')).toBe(0)
  })
})

describe('historyWitnessedBy', () => {
  it('keeps older unstamped messages and leaves out what happened while away', () => {
    const msgs = [
      { id: '1', role: 'char' as const },
      { id: '2', role: 'user' as const, presentIds: ['ash', 'bea'] },
      { id: '3', role: 'user' as const, presentIds: ['ash'] },
      { id: '4', role: 'char' as const, speakerId: 'bea', presentIds: ['ash'] },
      { id: '5', role: 'user' as const, presentIds: ['ash', 'bea'] },
    ]
    expect(historyWitnessedBy(msgs, 'bea').map((m) => m.id)).toEqual(['1', '2', '4', '5'])
    expect(witnessedMessage(msgs[2], 'bea')).toBe(false)
  })
})
