/**
 * The scribe: a background model call that reads a batch of new roleplay messages and records what
 * the characters in them will remember. Pure prompt building and parsing; the caller supplies the
 * model call. Witnesses come from the engine (who was present); the model may only narrow them.
 */

import { parseLenientJson } from '@/lib/jsonRepair'
import type { MemoryKind } from '@/lib/types'

export interface ScribeInput {
  worldName?: string
  playerName: string
  /** The card the player plays, when there is one. */
  playerId?: string
  /** Every character that may appear, the player's card included. */
  cast: { id: string; name: string }[]
  /** The new messages only, numbered 1..k. `witnessIds` is who perceived each one. */
  messages: { n: number; id: string; name: string; text: string; witnessIds: string[] }[]
  /** Recent memories of the people involved, numbered, for dedupe, telling and retiring. */
  existing: { n: number; id: string; text: string; knownByIds: string[]; unresolved?: boolean }[]
  /** Most new memories to keep from one batch. Default 4. */
  maxNew?: number
}

export type ScribeKind = Exclude<MemoryKind, 'journal'>

export interface ScribeAdd {
  messageId: string
  text: string
  kind: ScribeKind
  importance: number
  aboutIds: string[]
  witnessIds: string[]
  feelings?: Record<string, number>
  unresolved?: boolean
}

export interface ScribeTold {
  memoryId: string
  toIds: string[]
  byId?: string
  messageId?: string
}

export interface ScribeResult {
  add: ScribeAdd[]
  told: ScribeTold[]
  retire: { memoryId: string; reason: string }[]
  /** Memory ids of open threads now closed. */
  resolve: string[]
}

export const DEFAULT_SCRIBE_MAX_NEW = 4
export const MAX_MEMORY_TEXT = 300
const MAX_REASON = 200
const DUPLICATE_JACCARD = 0.8
const SCRIBE_KINDS: readonly ScribeKind[] = ['event', 'learned', 'promise', 'secret', 'impression']

// ---------------------------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------------------------

function namesFor(ids: string[], cast: ScribeInput['cast']): string {
  const byId = new Map(cast.map((c) => [c.id, c.name]))
  const names = [...new Set(ids.map((id) => byId.get(id)).filter((n): n is string => !!n?.trim()))]
  return names.length ? names.join(', ') : 'nobody listed'
}

const EXAMPLE = [
  'Example. Messages:',
  '[1] Ash (witnessed by: Ash, Bea, Cole): Ash hands Bea the key. "Keep it until I come back."',
  '[2] Bea (witnessed by: Ash, Bea, Cole): Bea leans close and whispers so only Ash hears. "My real name is Wren."',
  'Reply:',
  '{"add":[{"from":1,"text":"Ash gave Bea the key and asked her to keep it until he returns.","kind":"promise","importance":0.6,"about":["Ash","Bea"],"unresolved":true},{"from":2,"text":"Bea told Ash her real name is Wren.","kind":"secret","importance":0.8,"about":["Bea"],"witnesses":["Ash","Bea"],"feelings":{"Ash":0.4}}],"told":[],"retire":[],"resolve":[]}',
].join('\n')

export function buildScribePrompt(input: ScribeInput): string {
  const maxNew = Math.max(0, input.maxNew ?? DEFAULT_SCRIBE_MAX_NEW)
  const castNames = [...new Set(input.cast.map((c) => c.name.trim()).filter(Boolean))]
  const player = input.playerName.trim()

  const messageLines = input.messages.map(
    (m) => `[${m.n}] ${m.name} (witnessed by: ${namesFor(m.witnessIds, input.cast)}): ${m.text.trim()}`,
  )
  const memoryLines = input.existing.map(
    (m) =>
      `(${m.n}) ${m.text.trim()} — known by: ${namesFor(m.knownByIds, input.cast)}${m.unresolved ? ' [open thread]' : ''}`,
  )

  const sections = [
    `Task: you are the scribe for a roleplay${input.worldName?.trim() ? ` set in ${input.worldName.trim()}` : ''}. Read the new messages below and record what the characters in them will remember.`,
    [
      'Most batches add nothing, or one memory. Only record concrete, durable things: a promise, a revelation, a name or secret learned, a changed relationship, an injury, a decision, a moment that landed hard.',
      'Skip small talk, greetings, and narration flavour. If nothing here will matter later, add nothing.',
      `${player || 'The player'} is the player's character. Speech or action presented as theirs counts the same as anyone else's.`,
    ].join('\n'),
    castNames.length ? `Characters: ${castNames.join(', ')}.` : '',
    input.existing.length
      ? `What these people already remember (numbered, for reference):\n${memoryLines.join('\n')}`
      : '',
    `New messages:\n${messageLines.join('\n')}`,
    [
      'Rules:',
      `- "add": new memories, at most ${maxNew}. Each is one plain sentence in third person that uses character names, never "I" or "you". "from" is the message number it comes from.`,
      input.existing.length ? '- Do not repeat something already remembered above.' : '',
      '- "kind" is one of: event, learned, promise, secret, impression. "importance" is 0 to 1 (0.3 minor, 0.6 matters, 0.9 life changing). "about" lists who it concerns.',
      '- "witnesses": only when fewer people perceived it than that message lists (a whisper, a private thought, a note read alone). Never add anyone not listed for that message. Leave it out otherwise.',
      '- "feelings": only when it clearly landed differently on different witnesses. A number per witness name from -1 (hurt, hostile) to 1 (warm, glad).',
      '- "unresolved": true for an open thread such as a promise, a debt, or an unanswered question.',
      '- "told": when a message shows a character telling another something from a remembered memory above, give that memory number, who learned it ("to"), who told it ("by"), and the message number ("from"). If something from these new messages is passed on in a later new message, record it with "add" instead.',
      '- "retire": remembered memories that these messages contradict or supersede, with a short reason.',
      '- "resolve": numbers of remembered open threads that these messages close.',
      '- Write plain sentences. Never invent anything that is not in the messages.',
    ]
      .filter(Boolean)
      .join('\n'),
    EXAMPLE,
    'Reply with only a JSON object: {"add":[{"from":1,"text":"...","kind":"event","importance":0.5,"about":["Name"],"witnesses":["Name"],"feelings":{"Name":0.5},"unresolved":false}],"told":[{"memory":1,"to":["Name"],"by":"Name","from":1}],"retire":[{"memory":1,"reason":"..."}],"resolve":[1]}',
    'If nothing is worth remembering, reply {"add":[],"told":[],"retire":[],"resolve":[]}',
  ]
  return sections.filter(Boolean).join('\n\n')
}

// ---------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------

const emptyResult = (): ScribeResult => ({ add: [], told: [], retire: [], resolve: [] })

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value))
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value.trim())
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** A message or memory number: 3, "3", "[3]", "(3)", "m3". */
function toIndex(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isInteger(value) ? value : undefined
  if (typeof value === 'string') {
    const match = value.match(/^\s*[[(]?\s*m?\s*(\d+)\s*[\])]?\s*$/i)
    return match ? Number(match[1]) : undefined
  }
  return undefined
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value == null || value === '') return []
  return [value]
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [])
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 1
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

/** Case-insensitive name to id, then first name alone when only one character has it. Ids pass through. */
function makeResolver(cast: ScribeInput['cast']): (name: unknown) => string | undefined {
  const ids = new Set(cast.map((c) => c.id))
  const full = new Map<string, string[]>()
  const first = new Map<string, string[]>()
  const add = (map: Map<string, string[]>, key: string, id: string) => {
    if (!key) return
    const list = map.get(key) ?? []
    if (!list.includes(id)) list.push(id)
    map.set(key, list)
  }
  for (const c of cast) {
    const name = c.name.trim().toLowerCase()
    add(full, name, c.id)
    add(first, name.split(/\s+/)[0] ?? '', c.id)
  }
  return (value) => {
    if (typeof value !== 'string') return undefined
    const raw = value.trim()
    if (ids.has(raw)) return raw
    const key = raw.replace(/^[@"'\s]+|["'.,:;!?\s]+$/g, '').toLowerCase()
    if (!key) return undefined
    const exact = full.get(key)
    if (exact?.length === 1) return exact[0]
    if (exact && exact.length > 1) return undefined
    const byFirst = first.get(key)
    return byFirst?.length === 1 ? byFirst[0] : undefined
  }
}

function resolveIds(value: unknown, resolve: (name: unknown) => string | undefined): string[] {
  const out: string[] = []
  for (const item of asArray(value)) {
    const id = resolve(item)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseKind(value: unknown): ScribeKind {
  const kind = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return (SCRIBE_KINDS as readonly string[]).includes(kind) ? (kind as ScribeKind) : 'event'
}

function parseBool(value: unknown): boolean {
  return value === true || (typeof value === 'string' && value.trim().toLowerCase() === 'true')
}

/** Narrow `base` to `requested`, preserving `base` order; never widens. */
function narrow(base: string[], requested: string[]): string[] {
  if (!requested.length) return base
  const kept = base.filter((id) => requested.includes(id))
  return kept.length ? kept : base
}

/** Tolerant: code fences, leading prose, slightly broken JSON. Garbage gives an empty result; never throws. */
export function parseScribeResponse(raw: string, input: ScribeInput): ScribeResult {
  let parsed: unknown
  try {
    const text = (raw ?? '').trim()
    if (!text.includes('{')) return emptyResult()
    parsed = parseLenientJson(text)
  } catch {
    return emptyResult()
  }
  if (!isObject(parsed)) return emptyResult()

  try {
    return interpret(parsed, input)
  } catch {
    return emptyResult()
  }
}

function interpret(obj: Record<string, unknown>, input: ScribeInput): ScribeResult {
  const resolve = makeResolver(input.cast)
  const messages = new Map(input.messages.map((m) => [m.n, m]))
  const memories = new Map(input.existing.map((m) => [m.n, m]))
  const maxNew = Math.max(0, Math.floor(input.maxNew ?? DEFAULT_SCRIBE_MAX_NEW))

  // --- add ---
  const candidates: (ScribeAdd & { order: number })[] = []
  asArray(obj.add ?? obj.adds ?? obj.memories).forEach((item, order) => {
    if (!isObject(item)) return
    const from = toIndex(item.from ?? item.message)
    const message = from === undefined ? undefined : messages.get(from)
    if (!message) return
    const text = cleanText(item.text ?? item.memory, MAX_MEMORY_TEXT)
    if (!text) return

    const witnessIds = narrow(message.witnessIds, resolveIds(item.witnesses, resolve))
    let feelings: Record<string, number> | undefined
    if (isObject(item.feelings)) {
      for (const [name, value] of Object.entries(item.feelings)) {
        const id = resolve(name)
        const n = toNumber(value)
        if (!id || n === undefined || !witnessIds.includes(id)) continue
        feelings = { ...feelings, [id]: clamp(n, -1, 1) }
      }
    }
    const importance = toNumber(item.importance)
    candidates.push({
      order,
      messageId: message.id,
      text,
      kind: parseKind(item.kind),
      importance: importance === undefined ? 0.5 : clamp(importance, 0, 1),
      aboutIds: resolveIds(item.about, resolve),
      witnessIds,
      ...(feelings ? { feelings } : {}),
      ...(parseBool(item.unresolved) ? { unresolved: true } : {}),
    })
  })

  // Highest importance first so a near-duplicate keeps its stronger copy, then cap.
  const existingTokens = input.existing.map((m) => tokens(m.text))
  const keptTokens: Set<string>[] = []
  const kept: (ScribeAdd & { order: number })[] = []
  for (const add of [...candidates].sort((a, b) => b.importance - a.importance || a.order - b.order)) {
    if (kept.length >= maxNew) break
    const t = tokens(add.text)
    const dup = [...existingTokens, ...keptTokens].some((other) => jaccard(t, other) >= DUPLICATE_JACCARD)
    if (dup) continue
    keptTokens.push(t)
    kept.push(add)
  }
  const add = kept.sort((a, b) => a.order - b.order).map(({ order: _order, ...rest }) => rest)

  // --- told ---
  const told: ScribeTold[] = []
  for (const item of asArray(obj.told)) {
    if (!isObject(item)) continue
    const index = toIndex(item.memory)
    const memory = index === undefined ? undefined : memories.get(index)
    if (!memory) continue
    const from = toIndex(item.from ?? item.message)
    const message = from === undefined ? undefined : messages.get(from)
    const byId = resolve(item.by)
    let toIds = resolveIds(item.to, resolve).filter((id) => !memory.knownByIds.includes(id) && id !== byId)
    // A listener has to have been there to hear it.
    if (message) toIds = toIds.filter((id) => message.witnessIds.includes(id))
    if (!toIds.length) continue
    told.push({
      memoryId: memory.id,
      toIds,
      ...(byId ? { byId } : {}),
      ...(message ? { messageId: message.id } : {}),
    })
  }

  // --- retire ---
  const retire: ScribeResult['retire'] = []
  for (const item of asArray(obj.retire)) {
    const index = isObject(item) ? toIndex(item.memory) : toIndex(item)
    const memory = index === undefined ? undefined : memories.get(index)
    if (!memory || retire.some((r) => r.memoryId === memory.id)) continue
    const reason = isObject(item) ? cleanText(item.reason, MAX_REASON) : ''
    retire.push({ memoryId: memory.id, reason: reason || 'superseded' })
  }

  // --- resolve ---
  const resolved: string[] = []
  for (const item of asArray(obj.resolve)) {
    const index = isObject(item) ? toIndex(item.memory) : toIndex(item)
    const memory = index === undefined ? undefined : memories.get(index)
    if (!memory?.unresolved || resolved.includes(memory.id)) continue
    resolved.push(memory.id)
  }

  return { add, told, retire, resolve: resolved }
}
