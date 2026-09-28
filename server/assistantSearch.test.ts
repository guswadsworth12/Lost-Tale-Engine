import { describe, expect, it } from 'vitest'
import { searchLocalLibrary } from './assistantSearch'
import type { Character } from '../src/lib/characters/cardSpec'
import type { Chat, StoredMessage, WorldCard } from '../src/lib/types'

const world = { id: 'amber', name: 'Amber Gate', description: 'A guild above Harrowmere.', lorebook: { entries: [
  { id: 1, keys: ['North Road'], comment: 'North Road', content: 'The road climbs toward the guild hall.', enabled: true },
] } } as WorldCard
const character = { id: 'ilse', worldId: 'amber', card: { name: 'Ilse Varn', description: 'Archivist at the guild.', personality: 'Careful' } } as Character
const chat = { id: 'home', characterId: 'ilse', title: 'Amber Gate — Return', scene: { location: 'North Road' }, updatedAt: 10 } as Chat
const message = { id: 'arrival', chatId: 'home', role: 'char', name: 'Game Master', text: 'Harrowmere comes back into view. Home is waiting at the top of the road.', createdAt: 11 } as StoredMessage
const library = { worlds: [world], characters: [character], books: [], chats: [chat], messages: [message], objectives: [], facts: [] }

describe('Writer’s Room local search', () => {
  it('finds a named world and its associated cast and lore without repeating the name in each record', () => {
    const hits = searchLocalLibrary('What is in Amber Gate?', library)
    expect(hits.map((hit) => hit.kind)).toContain('world')
    expect(hits.some((hit) => hit.title === 'Ilse Varn')).toBe(true)
    expect(hits.some((hit) => hit.title.includes('North Road'))).toBe(true)
  })

  it('searches story text and excludes trashed stories and their messages', () => {
    expect(searchLocalLibrary('Return', library).some((hit) => hit.id === 'arrival')).toBe(true)
    expect(searchLocalLibrary('Return', { ...library, chats: [{ ...chat, deletedAt: 12 }] }).some((hit) => hit.id === 'arrival')).toBe(false)
  })

  it('can list the current setup without requiring an exact title', () => {
    expect(searchLocalLibrary('Show my current setup', library).map((hit) => hit.kind)).toContain('world')
    expect(searchLocalLibrary('What worlds do I have?', library).some((hit) => hit.id === 'amber')).toBe(true)
  })

  it('shows a forked story\'s copied messages only once', () => {
    const fork = { ...chat, id: 'fork', title: `${chat.title} (fork)` } as Chat
    const copy = { ...message, id: 'arrival-copy', chatId: 'fork' } as StoredMessage
    const hits = searchLocalLibrary('Return', { ...library, chats: [chat, fork], messages: [message, copy] })
    expect(hits.filter((hit) => hit.kind === 'message')).toHaveLength(1)
  })

  it('finds imported character sections when the ordinary card fields are blank', () => {
    const imported = { ...character, card: { ...character.card, description: '', personality: '' }, promptItems: [
      { id: 'general', name: 'General', content: 'Ilse keeps the guild archive and guards the northern ledgers.', enabled: true, role: 'system' as const },
    ] }
    const hits = searchLocalLibrary('Ilse Varn', { ...library, characters: [imported] })
    expect(hits[0]).toMatchObject({ kind: 'cast', title: 'Ilse Varn' })
    expect(hits[0].excerpt).toContain('guild archive')
  })
})
