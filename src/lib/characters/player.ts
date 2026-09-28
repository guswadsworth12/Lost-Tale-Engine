import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, Persona } from '@/lib/types'

/**
 * The player side of a story, now that there is one kind of card. Any card can be played; a
 * story names its player card in `Chat.playerCharacterId`. Everything downstream (prompts, the VN
 * nameplate, transcripts) still reads the small `Persona` view built here, so none of it needs to
 * know whether the player started life as a persona or a character.
 */

/** The public view of a played card: name, portrait, and only what others may know. */
export function playerViewOf(character: Character): Persona {
  const own = character.playerDescription?.trim()
  return {
    id: character.id,
    characterId: character.id,
    name: character.card.name,
    // Never the card's private prompts or memory; those would reach every other character's
    // prompt as `{{user}}` context.
    description: own || character.card.description || '',
    avatarDataUrl: character.avatarDataUrl,
    createdAt: character.createdAt,
  }
}

/** Cards the AI may voice: everything except "you only" cards. */
export function isAiPlayable(character: Pick<Character, 'playerOnly'>): boolean {
  return !character.playerOnly
}

export type PlayerSwitch =
  | { ok: true; patch: Pick<Chat, 'playerCharacterId' | 'participants'> }
  | { ok: false; reason: string }

/**
 * Switch who you play mid-story. The card you take over stops being voiced by the AI; the card you
 * leave goes back to the AI unless it's a "you only" card. The story's lead can't be taken over:
 * the relationship stats, sprites, and greeting all key on it, so it has to stay AI-played.
 */
export function switchPlayer(
  chat: Pick<Chat, 'characterId' | 'participants' | 'playerCharacterId'>,
  nextId: string,
  cardsById: (id: string) => Pick<Character, 'id' | 'playerOnly'> | undefined,
): PlayerSwitch {
  if (nextId === chat.characterId) {
    return { ok: false, reason: "The story's lead is always voiced by the AI. Pick someone else, or start a new story led by another character." }
  }
  if (!cardsById(nextId)) return { ok: false, reason: 'That card no longer exists.' }
  const previous = chat.playerCharacterId ? cardsById(chat.playerCharacterId) : undefined
  let participants = (chat.participants ?? []).filter((id) => id !== nextId)
  if (previous && previous.id !== nextId && !previous.playerOnly && previous.id !== chat.characterId && !participants.includes(previous.id)) {
    participants = [...participants, previous.id]
  }
  return { ok: true, patch: { playerCharacterId: nextId, participants: participants.length ? participants : undefined } }
}
