import { nameVariants } from '@/lib/vn/appearances'

/**
 * Who a character hasn't been introduced to yet. A character who enters the story as someone new
 * (handed over by the Game Master after a set event, say: a being just freed or bound) starts out
 * not knowing anyone present. They learn a name when someone says it aloud where they can hear it.
 * Until then their prompt says so, because the narration, the roster and their own card all use the
 * names, and the model would otherwise use them too.
 *
 * Stored on the chat as `strangers`, per character: whose names they don't know, and since when.
 * What they have heard since is read back from the transcript, so nothing else needs updating.
 */

export interface StrangerRecord {
  /** Characters (or the player's character) whose names they don't know. */
  ids: string[]
  /** When they met: only what was said from then on can introduce anyone. */
  since: number
}

export type Strangers = Record<string, StrangerRecord>

interface HeardMessage {
  speakerId?: string
  text?: string
  swipes?: string[]
  activeSwipe?: number
  presentIds?: string[]
  createdAt: number
}

/** Everyone present a newcomer hasn't met: the cast in the room and the player's character, not themselves. */
export function strangersFor(newcomerId: string, presentIds: readonly string[], playerCharacterId: string | undefined, since: number): StrangerRecord {
  const ids = [...new Set([...presentIds, ...(playerCharacterId ? [playerCharacterId] : [])])].filter((id) => id && id !== newcomerId)
  return { ids, since }
}

/** Speech in a message: whatever is inside quotation marks. */
function spokenParts(text: string): string[] {
  return [...text.matchAll(/"([^"]+)"|“([^”]+)”/g)].map((m) => m[1] ?? m[2] ?? '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whether `name` (in full, or a first name of three letters or more) is said aloud in `text`. */
export function nameSpoken(text: string, name: string): boolean {
  const variants = nameVariants(name)
  if (!variants.length) return false
  const pattern = new RegExp(`\\b(?:${variants.map(escapeRegExp).join('|')})\\b`, 'i')
  return spokenParts(text).some((part) => pattern.test(part))
}

/**
 * The people `characterId` still hasn't been introduced to: their record, less anyone whose name has
 * been said aloud since, in a message they could hear (they were present, or presence wasn't
 * recorded). Their own lines don't count: they can't learn a name from saying it.
 */
export function stillStrangers(
  characterId: string,
  record: StrangerRecord | undefined,
  messages: readonly HeardMessage[],
  nameOf: (id: string) => string | undefined,
): string[] {
  if (!record?.ids.length) return []
  const heard = messages.filter((m) =>
    m.createdAt >= record.since
    && m.speakerId !== characterId
    && (!m.presentIds?.length || m.presentIds.includes(characterId)))
  return record.ids.filter((id) => {
    const name = nameOf(id)
    if (!name) return false
    return !heard.some((m) => nameSpoken((m.swipes?.[m.activeSwipe ?? 0] ?? m.text) || '', name))
  })
}

/** The prompt line: whose names the speaker doesn't know, and what to do instead. */
export function strangerNote(speakerName: string, names: readonly string[]): string {
  if (!names.length) return ''
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `${speakerName} has not been introduced to ${list} and does not know ${names.length === 1 ? 'that name' : 'their names'}. `
    + `The narration and other notes use these names, but ${speakerName} cannot: refer to ${names.length === 1 ? 'them' : 'each'} by how they look or what they are doing, `
    + `and do not treat anything about them as known beyond what ${speakerName} has seen and heard here. Someone saying a name aloud is how ${speakerName} learns it.`
}
