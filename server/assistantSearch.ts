import type { Character } from '../src/lib/characters/cardSpec.ts'
import type { Chat, ChatFact, Objective, StoredMessage, WorldCard, WorldInfoBook } from '../src/lib/types.ts'
import type { LocalSource } from '../src/lib/assistant/localSources.ts'

type Library = {
  worlds: WorldCard[]
  characters: Character[]
  books: WorldInfoBook[]
  chats: Chat[]
  messages: StoredMessage[]
  objectives: Objective[]
  facts: ChatFact[]
}

type Document = { source: LocalSource; body: string; worldId?: string; chatId?: string; date?: number }
const STOP = new Set('a all an and are as at be by can check could do does find for from have how i identify in is it issues list me my of on or our please review search show summarize tell the this to what when where who why with would you your about current setup saved local continuity dangling threads'.split(' '))
const words = (text: string) => [...new Set((text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((word) => word.length > 2 && !STOP.has(word)))]
const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const str = (value: unknown) => typeof value === 'string' ? value : ''

/** Search only saved text records. Art, credentials, and arbitrary local files never enter results. */
export function searchLocalLibrary(query: string, library: Library, limit = 12): LocalSource[] {
  // ponytail: linear scan is fine for a personal library; add SQLite FTS if message history makes this slow.
  const q = plain(query.slice(0, 300))
  if (!q) return []
  const terms = words(q)
  const worlds = new Map(library.worlds.map((world) => [world.id, world]))
  const characters = new Map(library.characters.map((character) => [character.id, character]))
  const liveChats = library.chats.filter((chat) => !chat.deletedAt)
  const chats = new Map(liveChats.map((chat) => [chat.id, chat]))
  const worldOf = (chat: Chat) => characters.get(chat.characterId)?.worldId
  const anchoredWorlds = new Set(library.worlds.filter((world) => q.includes(plain(world.name))).map((world) => world.id))
  const anchoredChats = new Set(liveChats.filter((chat) => {
    const titleWords = words(chat.title)
    return titleWords.length > 0 && titleWords.every((word) => terms.includes(word))
  }).map((chat) => chat.id))
  const focusChats = liveChats.filter((chat) => anchoredChats.size ? anchoredChats.has(chat.id) : !!worldOf(chat) && anchoredWorlds.has(worldOf(chat)!))
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 2)
  const focusCharacters = new Set(focusChats.flatMap((chat) => [chat.characterId, chat.playerCharacterId, ...(chat.participants ?? [])].filter((id): id is string => !!id)))
  const categories = new Set(['world', 'worlds', 'character', 'characters', 'cast', 'story', 'stories', 'scene', 'scenes', 'lore', 'library'])
  const inventory = terms.every((term) => categories.has(term)) && /\b(list|show|what|which|current|setup|saved|summarize|search)\b/.test(q)
  const categoryWanted = (kind: LocalSource['kind']) => {
    if (!terms.length || terms.includes('library')) return kind === 'world' || kind === 'story' || kind === 'cast'
    if (terms.some((term) => ['world', 'worlds'].includes(term))) return kind === 'world'
    if (terms.some((term) => ['character', 'characters', 'cast'].includes(term))) return kind === 'cast'
    if (terms.includes('lore')) return kind === 'lore'
    return kind === 'story' || kind === 'message' || kind === 'goal' || kind === 'fact'
  }
  const docs: Document[] = []
  const add = (kind: LocalSource['kind'], id: string, title: string, body: string, worldId?: string, chatId?: string, date?: number) => {
    if (body.trim()) docs.push({ source: { kind, id, title, excerpt: '' }, body: body.trim(), worldId, chatId, date })
  }

  for (const world of library.worlds) {
    add('world', world.id, world.name, [world.description, world.rules && `Rules: ${world.rules}`, world.gmNotes && `GM notes: ${world.gmNotes}`,
      world.campaign && `Checks: ${world.campaign.ruleset}; ${world.campaign.moves.map((move) => move.name).join(', ')}`,
      world.canonFacts?.map((fact) => fact.text).join('\n')].filter(Boolean).join('\n'), world.id)
    for (const item of world.promptItems ?? []) if (item.enabled && !item.importWarning && item.content.trim().length >= 50) {
      add('world', `${world.id}:${item.id}`, `${world.name} · ${item.name}`, item.content, world.id)
    }
    for (const entry of world.lorebook?.entries ?? []) if (entry.enabled !== false) {
      add('lore', `${world.id}:${entry.id ?? entry.comment ?? entry.keys.join(',')}`, `${world.name} · ${entry.comment || entry.keys.join(', ')}`, entry.content, world.id)
    }
  }
  for (const book of library.books) {
    const boundWorlds = new Set(book.boundWorldIds ?? [])
    for (const id of book.boundCharacterIds ?? []) {
      const worldId = characters.get(id)?.worldId
      if (worldId) boundWorlds.add(worldId)
    }
    for (const id of book.boundChatIds ?? []) {
      const chat = chats.get(id)
      const worldId = chat && worldOf(chat)
      if (worldId) boundWorlds.add(worldId)
    }
    for (const entry of book.book?.entries ?? []) if (entry.enabled !== false) {
      const id = `${book.id}:${entry.id ?? entry.comment ?? entry.keys.join(',')}`
      const title = `${book.name} · ${entry.comment || entry.keys.join(', ')}`
      for (const worldId of boundWorlds.size ? boundWorlds : [undefined]) add('lore', id, title, entry.content, worldId)
    }
  }
  for (const character of library.characters) {
    const card = character.card
    const authored = (character.promptItems ?? []).filter((item) => item.enabled && !item.importWarning && item.content.trim().length >= 50)
    add('cast', character.id, card.name, [card.description, card.personality && `Personality: ${card.personality}`, card.scenario && `Scenario: ${card.scenario}`,
      character.goals?.length && `Goals: ${character.goals.join(', ')}`, character.sheet && `Sheet: ${JSON.stringify(character.sheet.stats)}`,
      character.privateMemory && `Private memory: ${character.privateMemory}`, authored.length && `Saved sections: ${authored.map((item) => item.name).join(', ')}`,
      authored[0]?.content, !card.description && !authored.length && `Character in ${worlds.get(character.worldId ?? '')?.name ?? 'the library'}.`].filter(Boolean).join('\n'), character.worldId)
    for (const item of authored) add('cast', `${character.id}:${item.id}`, `${card.name} · ${item.name}`, item.content, character.worldId)
    for (const entry of card.character_book?.entries ?? []) if (entry.enabled !== false) {
      add('lore', `${character.id}:${entry.id ?? entry.comment ?? entry.keys.join(',')}`, `${card.name} · ${entry.comment || entry.keys.join(', ')}`, entry.content, character.worldId)
    }
  }
  for (const chat of liveChats) {
    const worldId = worldOf(chat)
    const storyBody = [chat.summary, chat.recap?.text && `Scene recap: ${chat.recap.text}`, chat.scene?.location && `Location: ${chat.scene.location}`,
      chat.carriedConsequences?.length && `Consequences: ${chat.carriedConsequences.join('; ')}`, chat.gmNotes && `GM notes: ${chat.gmNotes}`].filter(Boolean).join('\n')
    add('story', chat.id, `${worlds.get(worldId ?? '')?.name ?? 'Unbound'} · ${chat.title}`, storyBody || `Scene with ${characters.get(chat.characterId)?.card.name ?? 'unknown cast'}.`, worldId, chat.id, chat.updatedAt)
  }
  for (const message of library.messages) {
    const chat = chats.get(message.chatId)
    if (!chat || !message.text?.trim()) continue
    add('message', message.id, `${chat.title} · ${message.name || message.role}`, message.text, worldOf(chat), chat.id, message.createdAt)
  }
  for (const objective of library.objectives) {
    const chat = chats.get(objective.chatId)
    if (!chat) continue
    add('goal', objective.id, `${chat.title} · ${objective.title}`, [objective.description, objective.tasks?.map((task) => `${task.status}: ${task.description}`).join('; ')].filter(Boolean).join('\n') || objective.title,
      worldOf(chat), chat.id)
  }
  for (const fact of library.facts) {
    const chat = chats.get(fact.chatId)
    if (chat && fact.active) add('fact', fact.id, `${chat.title} · confirmed fact`, str(fact.text), worldOf(chat), chat.id)
  }

  const ranked = docs.map((doc) => {
    const title = plain(doc.source.title)
    const body = plain(doc.body)
    const titleMatches = terms.filter((term) => title.includes(term)).length
    const bodyMatches = terms.filter((term) => body.includes(term)).length
    const anchoredChat = !!doc.chatId && anchoredChats.has(doc.chatId)
    const anchoredWorld = !!doc.worldId && anchoredWorlds.has(doc.worldId)
    const score = titleMatches * 12 + bodyMatches * 2 + (anchoredChat ? 40 : anchoredWorld ? 16 : 0)
      + (title.includes(q) ? 20 : 0) + (title === q ? 60 : 0)
      + (doc.source.kind === 'cast' && focusCharacters.has(doc.source.id) ? 75 : 0)
      + (inventory && categoryWanted(doc.source.kind) ? 20 : 0)
    return { doc, score }
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.doc.date ?? 0) - (a.doc.date ?? 0))

  const counts = new Map<LocalSource['kind'], number>()
  const caps: Partial<Record<LocalSource['kind'], number>> = { world: 2, cast: 4, lore: 5, story: 3, message: 4, goal: 2, fact: 3 }
  const inventoryCaps: Partial<Record<LocalSource['kind'], number>> = { world: 4, cast: 4, story: 4, message: 4, goal: 2, fact: 2 }
  const results: LocalSource[] = []
  const seen = new Set<string>()
  // A forked story repeats its source's messages and summary word for word; one copy is enough.
  const seenBodies = new Set<string>()
  for (const { doc } of ranked) {
    if (results.length >= limit) break
    const key = `${doc.source.kind}:${doc.source.id}`
    if (seen.has(key)) continue
    const bodyKey = `${doc.source.kind}:${plain(doc.body).slice(0, 400)}`
    if (seenBodies.has(bodyKey)) continue
    const count = counts.get(doc.source.kind) ?? 0
    const cap = !anchoredChats.size && doc.source.kind === 'message' ? 2
      : !anchoredChats.size && doc.source.kind === 'story' ? 2
      : caps[doc.source.kind] ?? limit
    if (count >= (inventory ? inventoryCaps[doc.source.kind] ?? limit : cap)) continue
    counts.set(doc.source.kind, count + 1)
    const found = terms.map((term) => doc.body.toLowerCase().indexOf(term)).filter((index) => index >= 0).sort((a, b) => a - b)[0]
    const start = found && found > 150 ? found - 100 : 0
    const excerpt = doc.body.slice(start, start + 650)
    results.push({ ...doc.source, excerpt: `${start ? '…' : ''}${excerpt}${start + 650 < doc.body.length ? '…' : ''}` })
    seen.add(key)
    seenBodies.add(bodyKey)
  }
  return results
}
