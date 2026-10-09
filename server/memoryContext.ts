import { characterStore, chatStore, memoryStore, storyStore } from './db.ts'
import { sceneChainIds } from './memoryPlan.ts'
import type { CharacterMemory } from '../src/lib/types.ts'
const str = (v: unknown) => typeof v === 'string' ? v : ''
export const worldOf = (chat: Record<string, unknown>) => str(chat.worldId) || str(characterStore.get(str(chat.characterId))?.worldId)
/** Every scene id visible from `chatId`, current first. */
export function chainOf(chatId: string): string[] {
  return sceneChainIds(chatId, (id) => chatStore.get(id), (id) => storyStore.get(id))
}

export function memoriesIn(chatIds: string[]): CharacterMemory[] {
  if (!chatIds.length) return []
  return memoryStore
    .list({ where: `chatId IN (${chatIds.map(() => '?').join(', ')})`, params: chatIds, orderBy: 'createdAt' })
    .map((r) => r as unknown as CharacterMemory)
}
