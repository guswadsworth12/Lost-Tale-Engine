import { describe, expect, it } from 'vitest'
import type { CharacterMemoryListing } from '@/lib/api/client'
import type { Chat } from '@/lib/types'
import { chatOptionLabel, chatsWithCharacter, countRetired, groupMemories, otherKnowers, tellCandidates } from './memoriesView'

let seq = 0
const mem = (over: Partial<CharacterMemoryListing>): CharacterMemoryListing => ({
  id: `m${++seq}`,
  chatId: 'c1',
  text: 'Something happened.',
  kind: 'event',
  witnesses: ['ash'],
  knownBy: ['ash'],
  importance: 0.5,
  active: true,
  origin: 'scribe',
  createdAt: 0,
  ...over,
})

describe('groupMemories', () => {
  const rows = [
    mem({ id: 'old', chatId: 's1', storyId: 'st1', storyTitle: 'The Road', sceneLabel: 'Gate', createdAt: 1 }),
    mem({ id: 'journal', kind: 'journal', chatId: 's1', storyId: 'st1', storyTitle: 'The Road', sceneLabel: 'Gate', createdAt: 5 }),
    mem({ id: 'new', chatId: 's2', storyId: 'st1', storyTitle: 'The Road', sceneLabel: 'Well', createdAt: 4 }),
    mem({ id: 'loose', chatId: 'x', createdAt: 3 }),
    mem({ id: 'untitled-story', chatId: 'y', storyId: 'st9', sceneLabel: '  ', createdAt: 2 }),
    mem({ id: 'retired', chatId: 's2', storyId: 'st1', storyTitle: 'The Road', active: false, retiredReason: 'Contradicted', createdAt: 6 }),
  ]

  it('groups by story then scene, newest first, journals apart at the top', () => {
    const groups = groupMemories(rows)
    expect(groups.map((g) => g.title)).toEqual(['The Road', 'Unsorted'])
    const [road, unsorted] = groups
    expect(road.journals.map((m) => m.id)).toEqual(['journal'])
    expect(road.scenes.map((s) => [s.label, s.memories.map((m) => m.id)])).toEqual([
      ['Well', ['new']],
      ['Gate', ['old']],
    ])
    // No story title (or no story) lands in Unsorted; a blank scene label reads as untitled.
    expect(unsorted.key).toBe('')
    expect(unsorted.scenes.map((s) => [s.label, s.memories.map((m) => m.id)])).toEqual([
      ['Untitled scene', ['loose']],
      ['Untitled scene', ['untitled-story']],
    ])
  })

  it('hides retired memories unless asked', () => {
    const ids = (g: ReturnType<typeof groupMemories>) => g.flatMap((s) => s.scenes.flatMap((sc) => sc.memories.map((m) => m.id)))
    expect(ids(groupMemories(rows))).not.toContain('retired')
    expect(ids(groupMemories(rows, { showRetired: true }))[0]).toBe('retired')
    expect(countRetired(rows)).toBe(1)
  })

  it('is empty for no memories', () => {
    expect(groupMemories([])).toEqual([])
  })
})

describe('otherKnowers', () => {
  const names: Record<string, string> = { ash: 'Ash', bea: 'Bea', cole: 'Cole' }
  it('names everyone but this character, unknown ids once and last', () => {
    expect(otherKnowers(['ash', 'gone', 'bea', 'lost', 'cole'], 'ash', (id) => names[id])).toEqual(['Bea', 'Cole', 'Someone'])
    expect(otherKnowers(['ash'], 'ash', (id) => names[id])).toEqual([])
  })
})

describe('chatsWithCharacter', () => {
  const chat = (over: Partial<Chat>) => ({ id: 'c', characterId: 'x', title: 'T', createdAt: 0, updatedAt: 0, ...over }) as Chat
  it('keeps scenes where they lead, take part, or are played, newest first, skipping the trash', () => {
    const chats = [
      chat({ id: 'lead', characterId: 'ash', updatedAt: 1 }),
      chat({ id: 'part', participants: ['bea', 'ash'], updatedAt: 3 }),
      chat({ id: 'played', playerCharacterId: 'ash', updatedAt: 2 }),
      chat({ id: 'other', characterId: 'bea', updatedAt: 9 }),
      chat({ id: 'trashed', characterId: 'ash', deletedAt: 5, updatedAt: 10 }),
    ]
    expect(chatsWithCharacter(chats, 'ash').map((c) => c.id)).toEqual(['part', 'played', 'lead'])
  })
})

describe('chatOptionLabel', () => {
  it('adds the scene inside a story', () => {
    expect(chatOptionLabel({ title: 'Night Market' })).toBe('Night Market')
    expect(chatOptionLabel({ title: 'Night Market', storyId: 's', sceneNumber: 2 })).toBe('Night Market · Scene 2')
    expect(chatOptionLabel({ title: 'Night Market', storyId: 's', sceneNumber: 3, sceneTitle: 'The well' })).toBe('Night Market · Scene 3 · The well')
    expect(chatOptionLabel({ title: '  ' })).toBe('Untitled chat')
  })
})

describe('tellCandidates', () => {
  const cast = [
    { id: 'ash', worldId: 'w1' },
    { id: 'bea', worldId: 'w1' },
    { id: 'cole', worldId: 'w1' },
    { id: 'dan', worldId: 'w2' },
    { id: 'eve' },
  ]
  it('offers others in the same world who do not know it yet', () => {
    expect(tellCandidates(cast, { knownBy: ['ash', 'bea'], worldId: 'w1' }, { id: 'ash', worldId: 'w1' }).map((c) => c.id)).toEqual(['cole'])
  })
  it('falls back to the character’s world, and world-less matches world-less', () => {
    expect(tellCandidates(cast, { knownBy: ['ash'] }, { id: 'ash', worldId: 'w2' }).map((c) => c.id)).toEqual(['dan'])
    expect(tellCandidates(cast, { knownBy: ['zed'] }, { id: 'zed' }).map((c) => c.id)).toEqual(['eve'])
  })
})
