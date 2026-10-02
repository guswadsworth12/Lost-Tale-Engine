/**
 * Permanent deletes, with everything that hangs off each record. Shared by the delete routes and
 * the admin cleanup of what removed accounts left behind (`admin.ts`), so both cascade the same way.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  avatarsDir,
  characterStore,
  chatFactStore,
  chatStore,
  messageStore,
  objectiveStore,
  personaStore,
  relationshipEventStore,
  storyStore,
  worldStore,
} from './db.ts'
import { removeAvatar } from './avatars.ts'
import { purgeChatMemories } from './memories.ts'
import { purgeChatMoments } from './moments.ts'

/** A chat and everything kept per chat: messages, objectives, relationship events, facts, memories, moments. */
export function purgeChat(chatId: string): void {
  for (const msg of messageStore.list({ where: 'chatId = ?', params: [chatId] })) messageStore.remove(msg.id as string)
  for (const o of objectiveStore.list({ where: 'chatId = ?', params: [chatId] })) objectiveStore.remove(o.id as string)
  for (const e of relationshipEventStore.list({ where: 'chatId = ?', params: [chatId] })) relationshipEventStore.remove(e.id as string)
  for (const f of chatFactStore.list({ where: 'chatId = ?', params: [chatId] })) chatFactStore.remove(f.id as string)
  purgeChatMemories(chatId)
  purgeChatMoments(chatId)
  // Un-parent any chat forked from this one (parentChatId isn't indexed, so a full scan).
  for (const chat of chatStore.list()) {
    if (chat.parentChatId !== chatId) continue
    chatStore.update(chat.id as string, { parentChatId: undefined, forkedFromMessageId: undefined })
  }
  chatStore.remove(chatId)
}

/** A character, its chats, its place in group chats, and its art. */
export function deleteCharacter(characterId: string): void {
  // The character is gone for good, so there's no useful "trash" state — purge its chats directly.
  const chats = chatStore.list({ where: 'characterId = ?', params: [characterId] })
  for (const chat of chats) purgeChat(chat.id as string)
  // A character can also appear as a group-chat participant (a full scan — `participants` isn't an
  // indexed column); drop the dangling id and any tracked relationship for it instead of deleting the chat.
  for (const chat of chatStore.list()) {
    const participants = chat.participants as string[] | undefined
    const participantRelationships = chat.participantRelationships as Record<string, unknown> | undefined
    const patch: Record<string, unknown> = {}
    if (participants?.includes(characterId)) patch.participants = participants.filter((id) => id !== characterId)
    if (participantRelationships && characterId in participantRelationships) {
      const { [characterId]: _dropped, ...rest } = participantRelationships
      patch.participantRelationships = rest
    }
    if (Object.keys(patch).length > 0) chatStore.update(chat.id as string, patch)
  }
  // Removes the whole per-character folder in one shot (avatar, sprites, gallery — see avatars.ts).
  removeAvatar('characters', characterId)
  characterStore.remove(characterId)
}

/** A world and its art. Characters living there lose their world, not their existence. */
export function deleteWorld(worldId: string): void {
  for (const c of characterStore.list({ where: 'worldId = ?', params: [worldId] })) {
    characterStore.update(c.id as string, { worldId: undefined })
  }
  removeAvatar('worlds', worldId)
  worldStore.remove(worldId)
}

/** A (legacy) persona and its portrait, clearing chats that still point at it. */
export function deletePersona(personaId: string): void {
  // `Chat.personaId` isn't indexed, so a full scan; clear dangling refs to avoid a silent 404 on load.
  for (const chat of chatStore.list()) {
    // Cleared to '' (not null/undefined) to stay a valid value of its required-string type.
    if (chat.personaId === personaId) chatStore.update(chat.id as string, { personaId: '' })
  }
  removeAvatar('personas', personaId)
  personaStore.remove(personaId)
}

/** A story, every scene in it, and its folder of moment pictures. */
export function deleteStory(storyId: string): void {
  for (const chat of chatStore.list()) {
    if (chat.storyId === storyId) purgeChat(chat.id as string)
  }
  const dir = path.join(avatarsDir, 'stories', storyId)
  if (/^[0-9a-f-]{36}$/i.test(storyId) && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
  storyStore.remove(storyId)
}
