import { describe, expect, it } from 'vitest'
import type { Lorebook, LorebookEntry } from '@/lib/characters/cardSpec'
import type { ChatFact, StoredMessage } from '@/lib/types'
import { activateWorldInfo } from '@/lib/worldinfo/activation'
import { factsWitnessedBy } from '@/lib/worldinfo/facts'
import { GM_SPEAKER_ID, branchConsequenceAudience, consequencesKnownBy } from './gm'

// Only those who were there know it: consequences, scene facts and private lore (#86).
const chat = { characterId: 'ash', participants: ['bea', 'cole'], playerCharacterId: 'hero', scene: { presentCharacterIds: ['ash', 'bea', 'cole'] } } as never
const message = (id: string, presentIds: string[], extra: Partial<StoredMessage> = {}) =>
  ({ id, role: 'char', speakerId: 'ash', presentIds, text: '', ...extra }) as StoredMessage

describe('branch consequences', () => {
  const gmTurn = (id: string, presentIds: string[], text: string) => message(id, presentIds, {
    speakerId: GM_SPEAKER_ID, gm: { proposals: [{ id, scope: 'branch', status: 'confirmed', text }] } as never,
  })

  it('records who was present when each was confirmed, never the Game Master', () => {
    const audience = branchConsequenceAudience([gmTurn('m1', ['ash', 'bea'], 'The ferry is late.'), gmTurn('m2', ['cole'], 'Cole hid the key.')], chat)
    expect(audience['The ferry is late.']).toEqual(expect.arrayContaining(['ash', 'bea', 'hero']))
    expect(audience['The ferry is late.']).not.toContain('cole')
    expect(audience['Cole hid the key.']).not.toContain(GM_SPEAKER_ID)
  })

  it('tells a speaker only what they saw, and older consequences with no record to everyone', () => {
    const audience = { 'Cole hid the key.': ['cole', 'hero'], 'The ferry is late.': ['ash', 'bea'] }
    const texts = ['The gate is sealed.', 'Cole hid the key.', 'The ferry is late.']
    expect(consequencesKnownBy(texts, audience, 'bea')).toEqual(['The gate is sealed.', 'The ferry is late.'])
    expect(consequencesKnownBy(texts, audience, 'cole')).toEqual(['The gate is sealed.', 'Cole hid the key.'])
    expect(consequencesKnownBy(texts, undefined, 'bea')).toEqual(texts)
  })
})

describe('scene facts and open threads', () => {
  const fact = (id: string, sourceMessageId?: string) => ({ id, chatId: 'scene', text: id, active: true, createdAt: 1, ...(sourceMessageId ? { sourceMessageId } : {}) }) as ChatFact
  const messages = [message('m1', ['ash', 'bea']), message('m2', ['ash', 'cole'])]
  const facts = [fact('from-m1', 'm1'), fact('from-m2', 'm2'), fact('typed'), fact('lost-source', 'gone')]

  it('keeps a fact for those present when it came up', () => {
    expect(factsWitnessedBy(facts, messages, chat, 'bea').map((f) => f.id)).toEqual(['from-m1', 'typed', 'lost-source'])
    expect(factsWitnessedBy(facts, messages, chat, 'cole').map((f) => f.id)).toEqual(['from-m2', 'typed', 'lost-source'])
    expect(factsWitnessedBy(facts, messages, chat, 'ash').map((f) => f.id)).toEqual(facts.map((f) => f.id))
  })
})

describe('private lore unlocks on its own character\'s closeness (#86)', () => {
  const debt: LorebookEntry = { id: 1, keys: [], constant: true, activationMode: 'always', selective: false, insertion_order: 100, enabled: true, content: "Odo's sworn debt.", extensions: { affectionMin: 40 } }
  const own: Lorebook = { entries: [debt], sourceKey: 'char:odo' }
  const shared: Lorebook = { entries: [{ ...debt, id: 2, content: 'A world secret.' }], sourceKey: 'world:w' }
  const shown = (lead: number, odo?: number) => activateWorldInfo([own, shared], '', lead, undefined, odo === undefined ? undefined : { 'char:odo': odo }).activated.map((e) => e.content)

  it('uses the speaker\'s own affection for their own book, in both directions', () => {
    expect(shown(70, 10)).toEqual(['A world secret.'])
    expect(shown(10, 60)).toEqual(["Odo's sworn debt."])
  })

  it('falls back to the lead\'s value when the speaker has none, and keeps shared books on it', () => {
    expect(shown(70)).toEqual(["Odo's sworn debt.", 'A world secret.'])
    expect(shown(10)).toEqual([])
  })
})
