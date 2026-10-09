import { characterStore, chatStore, messageStore } from './db.ts'
import { introductionsFrom, type Introduction, type Strangers } from '../src/lib/story/acquaintance.ts'

export function recordIntroductions(chatId: string): void {
  const chat = chatStore.get(chatId)
  if (!chat) return
  const messages = messageStore.list({ where: 'chatId = ?', params: [chatId], orderBy: 'createdAt' })
  const fresh = introductionsFrom(chat.strangers as Strangers | undefined, messages as unknown as Parameters<typeof introductionsFrom>[1],
    (id) => (characterStore.get(id)?.card as { name?: string } | undefined)?.name, String(chat.characterId), typeof chat.playerCharacterId === 'string' ? chat.playerCharacterId : undefined)
  const ids = new Set(messages.map((m) => m.id))
  const kept = ((chat.introductions ?? []) as Introduction[]).filter((i) => ids.has(i.messageId))
  const first = new Map<string, Introduction>()
  for (const intro of [...fresh, ...kept].sort((a, b) => a.at - b.at)) {
    const key = `${intro.newcomerId}|${intro.personId}`
    if (!first.has(key)) first.set(key, intro)
  }
  const introductions = [...first.values()]
  if (JSON.stringify(chat.introductions ?? []) !== JSON.stringify(introductions)) chatStore.update(chatId, { introductions })
}
export function retractIntroductions(chatId: string, messageId: string): void {
  const chat = chatStore.get(chatId)
  const introductions = (chat?.introductions ?? []) as Introduction[]
  if (introductions.some((i) => i.messageId === messageId)) chatStore.update(chatId, { introductions: introductions.filter((i) => i.messageId !== messageId) })
}
export function forkIntroductions(sourceChatId: string, newChatId: string, idMap: Map<string, string>): void {
  const introductions = (chatStore.get(sourceChatId)?.introductions ?? []) as Introduction[]
  chatStore.update(newChatId, { introductions: introductions.filter((i) => idMap.has(i.messageId)).map((i) => ({ ...i, messageId: idMap.get(i.messageId)! })) })
}
