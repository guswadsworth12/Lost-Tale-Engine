/**
 * Planning half of per-character memory (`memories.ts` has the routes). Kept free of any database
 * import so it can be tested without opening one.
 *
 * A memory lives in the scene (chat) it happened in. It is visible from that scene and every scene
 * that follows on from it: the `previousSceneId` chain, then a sequel story's `continuesFrom`.
 */
import type { CharacterMemory, MemoryKind } from '../src/lib/types.ts'

type Row = Record<string, unknown>
type ToldVia = NonNullable<CharacterMemory['toldVia']>[number]

export const MEMORY_KINDS: readonly MemoryKind[] = ['event', 'learned', 'promise', 'secret', 'impression', 'journal']
export const MEMORY_ORIGINS: readonly CharacterMemory['origin'][] = ['scribe', 'manual', 'journal']
export const MEMORY_TEXT_MAX = 600
const RETIRED_REASON_MAX = 300
/** Longest scene chain followed, as a backstop beyond the cycle guard. */
const MAX_CHAIN = 10_000

export interface ChatLike {
  previousSceneId?: unknown
  storyId?: unknown
}
export interface StoryLike {
  continuesFrom?: unknown
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const isObj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Unique, trimmed, non-empty strings; anything else in the array is dropped. */
export function uniqueIds(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out = new Set<string>()
  for (const x of v) if (typeof x === 'string' && x.trim()) out.add(x.trim())
  return [...out]
}

function continuesFromScene(chat: ChatLike, getStory: (id: string) => StoryLike | undefined): string {
  const storyId = str(chat.storyId)
  if (!storyId) return ''
  const cf = getStory(storyId)?.continuesFrom
  return isObj(cf) ? str(cf.sceneId) : ''
}

/**
 * The scene `chatId` and everything before it, current first. Follows `previousSceneId`; where a
 * scene has none (or it points at a chat that no longer exists) the walk continues from its story's
 * `continuesFrom.sceneId`. Missing chats end the walk; a cycle is cut at the first repeat. Soft-
 * deleted chats count: their memories are part of the past.
 */
export function sceneChainIds(
  chatId: string,
  getChat: (id: string) => ChatLike | undefined,
  getStory: (id: string) => StoryLike | undefined,
): string[] {
  const chain: string[] = []
  const seen = new Set<string>()
  let current = chatId
  while (current && !seen.has(current) && chain.length < MAX_CHAIN) {
    const chat = getChat(current)
    if (!chat) break
    seen.add(current)
    chain.push(current)
    const prev = str(chat.previousSceneId)
    current = prev && getChat(prev) ? prev : continuesFromScene(chat, getStory)
  }
  return chain
}

/** `witnesses` plus everyone in `toldVia`, witnesses first, no repeats. */
export function computeKnownBy(witnesses: string[], toldVia: ToldVia[] | undefined): string[] {
  return [...new Set([...witnesses, ...(toldVia ?? []).flatMap((t) => t.to)])]
}

/** Keeps only the feelings of ids that know the memory. Undefined when none are left. */
function feelingsFor(feelings: unknown, knownBy: string[]): Record<string, number> | undefined {
  if (!isObj(feelings)) return undefined
  const known = new Set(knownBy)
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(feelings)) {
    if (known.has(k) && finite(v)) out[k] = clamp(v, -1, 1)
  }
  return Object.keys(out).length ? out : undefined
}

/** Keeps only the `consolidatedFor` ids that still know the memory. Undefined when none are left. */
function consolidatedAmong(ids: string[] | undefined, knownBy: string[]): string[] | undefined {
  const kept = (ids ?? []).filter((id) => knownBy.includes(id))
  return kept.length ? kept : undefined
}

function normalizeToldVia(v: unknown, now: number): ToldVia[] {
  if (!Array.isArray(v)) return []
  const out: ToldVia[] = []
  for (const t of v) {
    if (!isObj(t)) continue
    const to = uniqueIds(t.to)
    if (!to.length) continue
    out.push({
      to,
      ...(str(t.by).trim() ? { by: str(t.by).trim() } : {}),
      ...(str(t.messageId) ? { messageId: str(t.messageId) } : {}),
      ...(str(t.chatId) ? { chatId: str(t.chatId) } : {}),
      at: finite(t.at) ? t.at : now,
    })
  }
  return out
}

function normalizeText(v: unknown): string | { error: string } {
  const text = str(v).trim()
  if (!text) return { error: 'A memory needs text.' }
  if (text.length > MEMORY_TEXT_MAX) return { error: `A memory's text must be at most ${MEMORY_TEXT_MAX} characters.` }
  return text
}

const isKind = (v: unknown): v is MemoryKind => MEMORY_KINDS.includes(v as MemoryKind)

export type NewMemory = Omit<CharacterMemory, 'id'>

/**
 * Validates a POST body into a memory ready to insert (the route adds `id`, and fills
 * `storyId`/`worldId` from the chat when missing). Unknown fields are dropped.
 */
export function normalizeMemoryInput(raw: unknown, now: number): NewMemory | { error: string } {
  if (!isObj(raw)) return { error: 'A memory must be an object.' }
  const chatId = str(raw.chatId).trim()
  if (!chatId) return { error: 'A memory needs the chatId of the scene it happened in.' }
  const text = normalizeText(raw.text)
  if (typeof text !== 'string') return text
  if (raw.kind !== undefined && !isKind(raw.kind)) return { error: `Unknown memory kind "${String(raw.kind)}".` }
  const witnesses = uniqueIds(raw.witnesses)
  if (!witnesses.length) return { error: 'A memory needs at least one witness.' }
  if (raw.origin !== undefined && !MEMORY_ORIGINS.includes(raw.origin as CharacterMemory['origin'])) {
    return { error: `Unknown memory origin "${String(raw.origin)}".` }
  }
  const toldVia = normalizeToldVia(raw.toldVia, now)
  const knownBy = computeKnownBy(witnesses, toldVia)
  const about = uniqueIds(raw.about)
  const feelings = feelingsFor(raw.feelings, knownBy)
  const memory: NewMemory = {
    chatId,
    text,
    kind: isKind(raw.kind) ? raw.kind : 'event',
    witnesses,
    knownBy,
    importance: finite(raw.importance) ? clamp(raw.importance, 0, 1) : 0.5,
    active: true,
    origin: (raw.origin as CharacterMemory['origin'] | undefined) ?? 'manual',
    createdAt: finite(raw.createdAt) ? raw.createdAt : now,
  }
  if (str(raw.storyId)) memory.storyId = str(raw.storyId)
  if (str(raw.worldId)) memory.worldId = str(raw.worldId)
  if (toldVia.length) memory.toldVia = toldVia
  if (about.length) memory.about = about
  if (feelings) memory.feelings = feelings
  if (raw.unresolved === true) memory.unresolved = true
  if (raw.pinned === true) memory.pinned = true
  if (str(raw.sourceMessageId)) memory.sourceMessageId = str(raw.sourceMessageId)
  return memory
}

export type MemoryPatch = Partial<
  Pick<
    CharacterMemory,
    'text' | 'kind' | 'about' | 'importance' | 'feelings' | 'unresolved' | 'pinned' | 'active' | 'retiredReason' | 'consolidatedFor' | 'updatedAt'
  >
>

/**
 * Validates a PUT body. Who knows a memory (`witnesses`, `knownBy`, `toldVia`) and where it lives
 * (`chatId`) are not editable here: they change only through share / message retraction.
 * `feelings` keys and `consolidatedFor` ids are limited to `existing.knownBy`. A `null` (or empty) `retiredReason`, `about`,
 * `feelings` or `consolidatedFor` clears it.
 */
export function normalizeMemoryPatch(raw: unknown, existing: Pick<CharacterMemory, 'knownBy'>, now: number): MemoryPatch | { error: string } {
  if (!isObj(raw)) return { error: 'A memory update must be an object.' }
  const patch: MemoryPatch = { updatedAt: now }
  if ('text' in raw) {
    const text = normalizeText(raw.text)
    if (typeof text !== 'string') return text
    patch.text = text
  }
  if ('kind' in raw) {
    if (!isKind(raw.kind)) return { error: `Unknown memory kind "${String(raw.kind)}".` }
    patch.kind = raw.kind
  }
  if ('about' in raw) {
    const about = uniqueIds(raw.about)
    patch.about = about.length ? about : undefined
  }
  if ('importance' in raw) {
    if (!finite(raw.importance)) return { error: 'importance must be a number from 0 to 1.' }
    patch.importance = clamp(raw.importance, 0, 1)
  }
  if ('feelings' in raw) patch.feelings = feelingsFor(raw.feelings, existing.knownBy ?? [])
  if ('consolidatedFor' in raw) {
    patch.consolidatedFor = consolidatedAmong(uniqueIds(raw.consolidatedFor), existing.knownBy ?? [])
  }
  for (const key of ['unresolved', 'pinned', 'active'] as const) {
    if (!(key in raw)) continue
    if (typeof raw[key] !== 'boolean') return { error: `${key} must be true or false.` }
    patch[key] = raw[key] as boolean
  }
  if ('retiredReason' in raw) {
    const reason = str(raw.retiredReason).trim().slice(0, RETIRED_REASON_MAX)
    patch.retiredReason = reason || undefined
  }
  return patch
}

/**
 * Records that `to` were told the memory. Ids that already know it are skipped; when none are new
 * the memory is returned unchanged (same reference), so callers can skip the write.
 */
export function shareMemory(
  memory: CharacterMemory,
  share: { to: unknown; by?: unknown; messageId?: unknown; chatId?: unknown },
  now: number,
): CharacterMemory {
  const known = new Set(memory.knownBy ?? [])
  const fresh = uniqueIds(share.to).filter((id) => !known.has(id))
  if (!fresh.length) return memory
  const entry: ToldVia = {
    to: fresh,
    ...(str(share.by).trim() ? { by: str(share.by).trim() } : {}),
    ...(str(share.messageId) ? { messageId: str(share.messageId) } : {}),
    ...(str(share.chatId) ? { chatId: str(share.chatId) } : {}),
    at: now,
  }
  const toldVia = [...(memory.toldVia ?? []), entry]
  return { ...memory, toldVia, knownBy: computeKnownBy(memory.witnesses ?? [], toldVia), updatedAt: now }
}

/**
 * The patch that marks `memory` as folded into `characterId`'s journal, or null when that character
 * does not know it or it is already folded in for them.
 */
export function consolidateFor(memory: CharacterMemory, characterId: string, now: number): Pick<CharacterMemory, 'consolidatedFor' | 'updatedAt'> | null {
  if (!characterId || !(memory.knownBy ?? []).includes(characterId)) return null
  const current = memory.consolidatedFor ?? []
  if (current.includes(characterId)) return null
  return { consolidatedFor: [...current, characterId], updatedAt: now }
}

export interface PresenceChat {
  characterId?: unknown
  participants?: unknown
  playerCharacterId?: unknown
  scene?: unknown
}

/**
 * Who is in the scene right now, stamped on a message as `presentIds` when it is written: the
 * scene's present cast (or, without one, the lead and participants) plus the card the player plays.
 */
export function presenceOf(chat: PresenceChat): string[] {
  const scene = isObj(chat.scene) ? chat.scene : undefined
  const cast = Array.isArray(scene?.presentCharacterIds)
    ? scene.presentCharacterIds
    : [chat.characterId, ...(Array.isArray(chat.participants) ? chat.participants : [])]
  return uniqueIds([...cast, chat.playerCharacterId])
}

export interface MemoryRetraction {
  /** Memories that came from the message: they go with it. */
  remove: string[]
  /** Memories that were told in the message: the telling is undone. */
  update: { id: string; patch: Pick<CharacterMemory, 'toldVia' | 'knownBy' | 'feelings' | 'consolidatedFor'> }[]
}

/** What deleting (or rewriting) `messageId` does to `memories`. */
export function retractMessage(memories: CharacterMemory[], messageId: string): MemoryRetraction {
  const out: MemoryRetraction = { remove: [], update: [] }
  if (!messageId) return out
  for (const m of memories) {
    if (m.sourceMessageId === messageId) {
      out.remove.push(m.id)
      continue
    }
    const told = m.toldVia ?? []
    if (!told.some((t) => t.messageId === messageId)) continue
    const toldVia = told.filter((t) => t.messageId !== messageId)
    const knownBy = computeKnownBy(m.witnesses ?? [], toldVia)
    out.update.push({
      id: m.id,
      patch: {
        toldVia: toldVia.length ? toldVia : undefined,
        knownBy,
        feelings: feelingsFor(m.feelings, knownBy),
        consolidatedFor: consolidatedAmong(m.consolidatedFor, knownBy),
      },
    })
  }
  return out
}

/**
 * The memories a fork of a chat starts with. Kept: memories from a copied message (their
 * `sourceMessageId` remapped through `idMap`), and memories without a source message made at or
 * before `cutoffCreatedAt` (all of them when it is undefined). A telling (`toldVia`) survives only
 * if its message was copied too (or, with no message, it happened by the cutoff).
 */
export function forkMemories(
  sourceMemories: CharacterMemory[],
  idMap: Map<string, string>,
  cutoffCreatedAt: number | undefined,
  newChatId: string,
  newId: () => string,
): CharacterMemory[] {
  const byCutoff = (at: unknown) => cutoffCreatedAt === undefined || (finite(at) && at <= cutoffCreatedAt)
  const rows: CharacterMemory[] = []
  for (const m of sourceMemories) {
    let sourceMessageId: string | undefined
    if (m.sourceMessageId) {
      sourceMessageId = idMap.get(m.sourceMessageId)
      if (!sourceMessageId) continue
    } else if (!byCutoff(m.createdAt)) {
      continue
    }
    const toldVia: ToldVia[] = []
    for (const t of m.toldVia ?? []) {
      if (t.messageId) {
        const mapped = idMap.get(t.messageId)
        if (mapped) toldVia.push({ ...t, messageId: mapped, ...(t.chatId === m.chatId ? { chatId: newChatId } : {}) })
      } else if (byCutoff(t.at)) {
        toldVia.push({ ...t, ...(t.chatId === m.chatId ? { chatId: newChatId } : {}) })
      }
    }
    const knownBy = computeKnownBy(m.witnesses ?? [], toldVia)
    const { toldVia: _tv, feelings: _f, sourceMessageId: _s, consolidatedFor: _cf, ...rest } = m
    const row: CharacterMemory = { ...rest, id: newId(), chatId: newChatId, knownBy }
    if (sourceMessageId) row.sourceMessageId = sourceMessageId
    if (toldVia.length) row.toldVia = toldVia
    const feelings = feelingsFor(m.feelings, knownBy)
    if (feelings) row.feelings = feelings
    const consolidatedFor = consolidatedAmong(m.consolidatedFor, knownBy)
    if (consolidatedFor) row.consolidatedFor = consolidatedFor
    rows.push(row)
  }
  return rows
}

/**
 * A memory as seen from one scene: tellings recorded in a scene outside `chain` (another branch,
 * a parallel storyline) are left out, and `knownBy` is recomputed without them. Tellings with no
 * scene (made from the character card) count everywhere.
 */
export function memoryAsSeenFrom(memory: CharacterMemory, chain: ReadonlySet<string>): CharacterMemory {
  const told = memory.toldVia ?? []
  const seen = told.filter((t) => !t.chatId || chain.has(t.chatId))
  if (seen.length === told.length) return memory
  const knownBy = computeKnownBy(memory.witnesses ?? [], seen)
  const { toldVia: _tv, ...rest } = memory
  return { ...rest, ...(seen.length ? { toldVia: seen } : {}), knownBy }
}

/**
 * Tellings made in a forked chat of memories from earlier scenes (which the fork does not copy):
 * each one kept by the fork is recorded again for the fork, its message remapped.
 */
export function forkTellings(
  chainMemories: CharacterMemory[],
  sourceChatId: string,
  idMap: Map<string, string>,
  newChatId: string,
): { id: string; toldVia: ToldVia[] }[] {
  const out: { id: string; toldVia: ToldVia[] }[] = []
  for (const m of chainMemories) {
    if (m.chatId === sourceChatId) continue
    const extra = (m.toldVia ?? [])
      .filter((t) => t.chatId === sourceChatId && t.messageId && idMap.has(t.messageId))
      .map((t) => ({ ...t, chatId: newChatId, messageId: idMap.get(t.messageId!)! }))
    if (extra.length) out.push({ id: m.id, toldVia: [...(m.toldVia ?? []), ...extra] })
  }
  return out
}

/**
 * The scribe's new watermark. `from` is what it read before its run; if the watermark moved back
 * since (a scribed message was edited), the earlier value wins so that message is read again.
 */
export function nextWatermark(current: number | undefined, upTo: number, from: number | null | undefined): number {
  if (from === undefined) return upTo
  const readFrom = from ?? undefined
  if (current === readFrom) return upTo
  return current === undefined ? upTo : Math.min(current, upTo)
}
