import type { Chat, StoredMessage } from '@/lib/types'

/**
 * Who witnessed what. The engine decides this from recorded presence, never a model: a model may
 * narrow a memory's witnesses (a whisper), but can never add someone who was not there.
 */

type PresenceChat = Pick<Chat, 'characterId' | 'participants' | 'playerCharacterId' | 'scene'>
type PresenceMessage = Pick<StoredMessage, 'role' | 'speakerId' | 'presentIds'>

function uniq(ids: (string | undefined | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of ids) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** Character ids who witnessed `message`: its recorded `presentIds`, else the scene's present cast
 *  (else the chat's roster), plus the speaker and the card the player plays. Unique, stable order. */
export function messageWitnesses(message: PresenceMessage, chat: PresenceChat): string[] {
  const present = message.presentIds
    ?? chat.scene?.presentCharacterIds
    ?? [chat.characterId, ...(chat.participants ?? [])]
  const speaker = message.speakerId ?? (message.role === 'char' ? chat.characterId : undefined)
  return uniq([...present, speaker, chat.playerCharacterId])
}

/** Narrow `base` to `requested` (a model's whisper), preserving `base` order. Never widens: an
 *  empty/missing request or an empty intersection returns `base` unchanged. */
export function narrowWitnesses(base: string[], requested?: string[] | null): string[] {
  if (!requested?.length) return base
  const want = new Set(requested)
  const kept = base.filter((id) => want.has(id))
  return kept.length ? kept : base
}

/** Index of the first message `characterId` witnessed (listed in `presentIds`, or spoke it). A
 *  message with no `presentIds` predates presence tracking and counts as witnessed by everyone, so
 *  a legacy chat returns 0. Returns `messages.length` when they have witnessed nothing yet. */
/**
 * Whether a character was there for a message: in its `presentIds`, or its speaker. A message from
 * before presence was recorded counts as heard by everyone, so older chats read as they always did.
 */
export function witnessedMessage(message: PresenceMessage, characterId: string): boolean {
  return !message.presentIds || message.presentIds.includes(characterId) || message.speakerId === characterId
}

/**
 * The messages a character was there for. Unlike `historySinceJoined` this also leaves out what
 * happened while they were away and came back, and it works in a chat that began before presence
 * was recorded.
 */
export function historyWitnessedBy<T extends PresenceMessage>(messages: T[], characterId: string): T[] {
  return messages.filter((m) => witnessedMessage(m, characterId))
}

export function joinedAtIndex(messages: PresenceMessage[], characterId: string): number {
  const i = messages.findIndex((m) => witnessedMessage(m, characterId))
  return i === -1 ? messages.length : i
}

/** The history a character may read: everything from when they joined the scene onward, so a
 *  mid-scene arrival does not know what was said before they came. */
export function historySinceJoined<T extends PresenceMessage>(messages: T[], characterId: string): T[] {
  return messages.slice(joinedAtIndex(messages, characterId))
}
