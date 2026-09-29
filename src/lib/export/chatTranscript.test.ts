import { describe, expect, it } from 'vitest'
import { buildChatTranscriptHtml } from './chatTranscript'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, StoredMessage } from '@/lib/types'

const card = (id: string, name: string) => ({ id, card: { name } }) as unknown as Character
const msg = (id: string, role: 'user' | 'char', name: string, text: string, speakerId?: string) =>
  ({ id, chatId: 'c', role, name, text, createdAt: 1, ...(speakerId ? { speakerId } : {}) }) as StoredMessage

describe('buildChatTranscriptHtml', () => {
  it('labels each reply with whoever said it, not the lead', async () => {
    const html = await buildChatTranscriptHtml({
      chat: { id: 'c', title: 'Test' } as Chat,
      character: card('lead', 'Ash Vale'),
      persona: { id: 'p', name: 'Wren', description: '' } as never,
      cast: [card('bea', 'Bea Moss')],
      messages: [
        msg('1', 'user', 'Wren', 'Hello.'),
        msg('2', 'char', 'Game Master', 'The hall is quiet.', 'game-master'),
        msg('3', 'char', 'Bea Moss', 'Evening.', 'bea'),
        msg('4', 'char', 'Ash Vale', 'Sit down.'),
      ],
    })
    const names = [...html.matchAll(/<span class="name">([^<]*)<\/span>/g)].map((m) => m[1])
    expect(names).toEqual(['Wren', 'Game Master', 'Bea Moss', 'Ash Vale'])
  })
})
