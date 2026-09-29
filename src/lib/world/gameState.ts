import type { PbtaMove, PbtaRoll } from './campaign'

/**
 * Tracked game state: the resources, conditions, clocks, and item lists a world's rules define
 * (`CampaignConfig.tracks`), and what play has done to them.
 *
 * Values are never stored as a running total the model can overwrite. Each change is an event on
 * the message that caused it, replayed in order over the scene's starting values (`Chat.gameState`):
 * - a recorded roll's effects for its tier, written by the server with the dice (`campaignRoll.stateChanges`),
 * - a choice the player made for a roll, or a set event carried out (`gm.stateChanges`),
 * - a GM proposal carrying changes, once the player confirms it (`gm.proposals[].changes`),
 * - the player's own corrections from the Story panel (`StoredMessage.stateEdits`).
 * Rewinding deletes the events after the cut and forking copies the ones before it, so both land on
 * the state at that point with no bookkeeping. Ending a scene folds the branch into the next
 * scene's starting values (`carryGameState`).
 */

export type TrackKind = 'resource' | 'condition' | 'clock' | 'items'

export interface CampaignTrack {
  id: string
  name: string
  kind: TrackKind
  description?: string
  /** Resource and clock: the top of the scale (a clock's segments). */
  max?: number
  /** Resource: where it starts. Defaults to `max`, or 0 without one. */
  start?: number
  /** Kept for each character (harm, strain, their own pack) rather than once for the story. */
  perCharacter?: boolean
  /** Starts again from empty in each new scene. For threat clocks. */
  perScene?: boolean
  /** Only the Game Master sees it. */
  gmOnly?: boolean
}

export interface TrackEffect {
  trackId: string
  /** Resource or clock: added (negative spends). */
  delta?: number
  /** Resource or clock: an exact value. Condition: applied (true) or cleared (false). */
  set?: number | boolean
  /** Items: gained. */
  gain?: string
  /** Items: lost. */
  lose?: string
  /** Whose value, for a per-character track (a character id). Unset: the player's character. */
  who?: string
}

/** A move's state effects for each result, and for each option its result lets the player choose. */
export interface MoveEffects {
  effects?: Partial<Record<PbtaRoll['tier'], TrackEffect[]>>
  choiceEffects?: { option: string; effects: TrackEffect[] }[]
}

export type StateChangeSource = 'roll' | 'choice' | 'set_event' | 'gm' | 'player'

/** An effect as it was applied in play, with what caused it. */
export interface StateChange extends TrackEffect {
  source: StateChangeSource
  rollId?: string
  setEventId?: string
}

export type TrackValue = number | boolean | string[]
/** Values by `stateKey`. Tracks never touched are at their default and absent. */
export type GameState = Record<string, TrackValue>

/** What a player's character is called in keys when the story has no player card. */
export const PLAYER_HOLDER = 'player'

export const MAX_TRACKS = 20
const MAX_VALUE = 999
const MAX_ITEMS = 50

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const firstName = (s: string) => s.trim().toLowerCase().split(/[\s,]+/)[0] ?? ''

export function stateKey(track: CampaignTrack, holder: string | undefined): string {
  return track.perCharacter ? `${track.id}@${holder ?? PLAYER_HOLDER}` : track.id
}

export function trackDefault(track: CampaignTrack): TrackValue {
  if (track.kind === 'condition') return false
  if (track.kind === 'items') return []
  if (track.kind === 'clock') return 0
  return track.start ?? track.max ?? 0
}

export function trackValue(state: GameState | undefined, track: CampaignTrack, holder?: string): TrackValue {
  return state?.[stateKey(track, holder)] ?? trackDefault(track)
}

function clamp(track: CampaignTrack, value: number): number {
  return Math.max(0, Math.min(track.max ?? MAX_VALUE, Math.round(value)))
}

/** One effect applied to a value. Returns the value unchanged when the effect doesn't fit the track. */
function applyTo(track: CampaignTrack, before: TrackValue, effect: TrackEffect): TrackValue {
  if (track.kind === 'condition') {
    if (typeof effect.set === 'boolean') return effect.set
    if (typeof effect.delta === 'number' && effect.delta !== 0) return effect.delta > 0
    return before
  }
  if (track.kind === 'items') {
    const items = Array.isArray(before) ? before : []
    let next = items
    if (effect.lose) next = next.filter((item) => item.toLowerCase() !== effect.lose!.toLowerCase())
    if (effect.gain && !next.some((item) => item.toLowerCase() === effect.gain!.toLowerCase())) next = [...next, effect.gain].slice(-MAX_ITEMS)
    return next
  }
  const current = typeof before === 'number' ? before : 0
  if (typeof effect.set === 'number') return clamp(track, effect.set)
  if (typeof effect.delta === 'number') return clamp(track, current + effect.delta)
  return before
}

export interface AppliedChange {
  change: StateChange
  track: CampaignTrack
  /** Whose value changed, for a per-character track. */
  holder?: string
  before: TrackValue
  after: TrackValue
  /** The message the change rides on. */
  messageId?: string
}

interface StateMessage {
  id?: string
  campaignRoll?: { id?: string; stateChanges?: StateChange[] }
  gm?: { stateChanges?: StateChange[]; proposals?: { id?: string; status: string; changes?: TrackEffect[] }[] }
  stateEdits?: StateChange[]
}

/**
 * The state after `messages`, replayed over `baseline` (the scene's starting values). A roll's,
 * choice's, or set event's changes apply once however many messages carry them, so a replayed
 * request or a duplicated GM turn can't spend the same cost twice. Changes to tracks the world no
 * longer defines are skipped.
 */
export function gameStateFrom(
  tracks: readonly CampaignTrack[] | undefined,
  baseline: GameState | undefined,
  messages: readonly StateMessage[],
  opts: { playerId?: string } = {},
): { state: GameState; log: AppliedChange[] } {
  const state: GameState = { ...(baseline ?? {}) }
  const log: AppliedChange[] = []
  if (!tracks?.length) return { state, log }
  const byId = new Map(tracks.map((track) => [track.id, track]))
  const seen = new Set<string>()
  const apply = (change: StateChange, messageId?: string) => {
    const track = byId.get(change.trackId)
    if (!track) return
    const holder = track.perCharacter ? change.who ?? opts.playerId ?? PLAYER_HOLDER : undefined
    const key = stateKey(track, holder)
    const before = state[key] ?? trackDefault(track)
    const after = applyTo(track, before, change)
    state[key] = after
    log.push({ change, track, holder, before, after, messageId })
  }
  const applyGroup = (changes: readonly StateChange[] | undefined, messageId?: string) => {
    if (!changes?.length) return
    // One cause, one application: a roll's cost or a set event's consequence is paid once per branch.
    const groups = new Set(changes.map(causeOf).filter((cause): cause is string => !!cause))
    if ([...groups].some((cause) => seen.has(cause))) return
    for (const change of changes) apply(change, messageId)
    for (const cause of groups) seen.add(cause)
  }
  for (const message of messages) {
    applyGroup(message.campaignRoll?.stateChanges, message.id)
    applyGroup(message.gm?.stateChanges, message.id)
    for (const proposal of message.gm?.proposals ?? []) {
      if (proposal.status === 'confirmed') for (const change of proposal.changes ?? []) apply({ ...change, source: 'gm' }, message.id)
    }
    for (const edit of message.stateEdits ?? []) apply(edit, message.id)
  }
  return { state, log }
}

function causeOf(change: StateChange): string | undefined {
  if (change.source === 'roll' && change.rollId) return `roll:${change.rollId}`
  if (change.source === 'choice' && change.rollId) return `choice:${change.rollId}`
  if (change.source === 'set_event' && change.setEventId) return `event:${change.setEventId}`
  return undefined
}

/**
 * What the next scene starts with: every value the scene ended on, except per-scene clocks (they
 * start empty again) and tracks the world no longer defines.
 */
export function carryGameState(state: GameState, tracks: readonly CampaignTrack[] | undefined): GameState | undefined {
  const byId = new Map((tracks ?? []).map((track) => [track.id, track]))
  const kept = Object.entries(state).filter(([key]) => {
    const track = byId.get(key.split('@')[0])
    return !!track && !track.perScene
  })
  return kept.length ? Object.fromEntries(kept) : undefined
}

// ---- Effects from play -------------------------------------------------------------------------

const playerChange = (effect: TrackEffect, source: StateChangeSource, playerId: string | undefined, extra: Partial<StateChange>): StateChange => ({
  ...effect,
  ...(effect.who || !playerId ? {} : { who: playerId }),
  source,
  ...extra,
})

/** A recorded roll's own effects: what its move says happens on that result, to whoever rolled. */
export function effectsForRoll(move: PbtaMove & MoveEffects, tier: PbtaRoll['tier'], rollId: string, playerId?: string): StateChange[] {
  return (move.effects?.[tier] ?? []).map((effect) => playerChange(effect, 'roll', playerId, { rollId }))
}

const optionKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** The effects of the options the player picked for a roll whose result asked them to choose. */
export function effectsForChoice(move: (PbtaMove & MoveEffects) | undefined, picked: readonly string[], rollId: string, playerId?: string): StateChange[] {
  if (!move?.choiceEffects?.length) return []
  const keys = picked.map(optionKey).filter(Boolean)
  return move.choiceEffects
    .filter((entry) => {
      const option = optionKey(entry.option)
      return !!option && keys.some((key) => key === option || key.startsWith(`${option} `) || option.startsWith(`${key} `))
    })
    .flatMap((entry) => entry.effects.map((effect) => playerChange(effect, 'choice', playerId, { rollId })))
}

/** Words that turn "is strained" into its opposite. A consequence saying so applies nothing. */
const CLEARING = /\b(?:no longer|not|isn['’]t|aren['’]t|recover(?:s|ed)?|cured|free of|without)\b/i

/**
 * Conditions a consequence names in plain words ("Bea is strained" applies Strained to Bea), for set
 * events written before they had effects of their own. Only conditions, and only to put them on:
 * an amount is never guessed from prose.
 */
export function inferConditionEffects(consequence: string, tracks: readonly CampaignTrack[] | undefined, roster: readonly { id: string; name: string }[] = []): TrackEffect[] {
  if (!consequence.trim() || CLEARING.test(consequence)) return []
  const who = roster
    .map((member) => ({ member, at: consequence.search(new RegExp(`\\b(?:${escapeRe(member.name)}|${escapeRe(firstName(member.name))})\\b`, 'i')) }))
    .filter((hit) => hit.at >= 0 && firstName(hit.member.name))
    .sort((a, b) => a.at - b.at)[0]?.member.id
  return (tracks ?? []).flatMap((track) => {
    if (track.kind !== 'condition') return []
    const name = track.name.trim().toLowerCase()
    const stem = name.replace(/(?:ed|d|s)$/, '')
    const named = [name, stem].filter((s) => s.length >= 3).some((s) => new RegExp(`\\b${escapeRe(s)}`, 'i').test(consequence))
    if (!named) return []
    return [{ trackId: track.id, set: true, ...(track.perCharacter && who ? { who } : {}) }]
  })
}

/** A set event's effects as they happen: its own, or those its consequence names. */
export function effectsForSetEvent(
  event: { id: string; consequence?: string; effects?: TrackEffect[] },
  tracks: readonly CampaignTrack[] | undefined,
  roster: readonly { id: string; name: string }[],
  playerId?: string,
): StateChange[] {
  const effects = event.effects?.length ? event.effects : inferConditionEffects(event.consequence ?? '', tracks, roster)
  return effects.map((effect) => playerChange(effect, 'set_event', playerId, { setEventId: event.id }))
}

// ---- Effect text: "Supplies -1, Hurt on for Bea, Gear + rope" ----------------------------------

export interface NamedCharacter {
  id: string
  name: string
}

function findCharacter(name: string, characters: readonly NamedCharacter[]): NamedCharacter | undefined {
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  return characters.find((c) => c.name.trim().toLowerCase() === n) ?? characters.find((c) => firstName(c.name) === firstName(n))
}

/** One effect in the editors' short form, e.g. "Supplies -1", "Hurt on for Bea", "Gear + rope". */
export function effectText(effect: TrackEffect, tracks: readonly CampaignTrack[] | undefined, characters: readonly NamedCharacter[] = []): string {
  const track = tracks?.find((t) => t.id === effect.trackId)
  const name = track?.name ?? effect.trackId
  let op = ''
  if (typeof effect.set === 'boolean') op = effect.set ? 'on' : 'off'
  else if (typeof effect.set === 'number') op = `= ${effect.set}`
  else if (typeof effect.delta === 'number') op = track?.kind === 'condition' ? (effect.delta > 0 ? 'on' : 'off') : `${effect.delta >= 0 ? '+' : '-'}${Math.abs(effect.delta)}`
  const items = [effect.gain ? `+ ${effect.gain}` : '', effect.lose ? `- ${effect.lose}` : ''].filter(Boolean)
  const who = effect.who && track?.perCharacter ? characters.find((c) => c.id === effect.who)?.name ?? effect.who : ''
  const parts = items.length ? items.map((item) => `${name} ${item}`) : [`${name} ${op}`.trim()]
  return parts.map((part) => (who ? `${part} for ${who}` : part)).join(', ')
}

export function effectsText(effects: readonly TrackEffect[] | undefined, tracks: readonly CampaignTrack[] | undefined, characters: readonly NamedCharacter[] = []): string {
  return (effects ?? []).map((effect) => effectText(effect, tracks, characters)).join(', ')
}

/**
 * Reads the short form back. Each comma-separated part is a track name, then `+N`, `-N`, `= N`,
 * `on`, `off`, `+ item`, or `- item`, then optionally `for Name`. Parts that don't read are errors,
 * never guesses.
 */
export function parseEffects(input: string, tracks: readonly CampaignTrack[] | undefined, characters: readonly NamedCharacter[] = []): { effects: TrackEffect[]; errors: string[] } {
  const effects: TrackEffect[] = []
  const errors: string[] = []
  const byLength = [...(tracks ?? [])].sort((a, b) => b.name.length - a.name.length)
  for (const raw of input.split(',')) {
    const part = raw.trim()
    if (!part) continue
    let body = part
    let who: string | undefined
    const forAt = /\s+for\s+([^+\-=]+)$/i.exec(part)
    if (forAt) {
      const hit = findCharacter(forAt[1], characters)
      if (!hit) {
        errors.push(`"${part}": nobody here is called ${forAt[1].trim()}.`)
        continue
      }
      who = hit.id
      body = part.slice(0, forAt.index)
    }
    const track = byLength.find((t) => {
      const name = t.name.trim().toLowerCase()
      return !!name && body.toLowerCase().startsWith(name) && /^(?:$|[\s+\-=])/.test(body.slice(name.length))
    })
    if (!track) {
      errors.push(`"${part}": no tracked state by that name.`)
      continue
    }
    if (who && !track.perCharacter) {
      errors.push(`"${part}": ${track.name} is kept for the whole story, not per character.`)
      continue
    }
    const rest = body.slice(track.name.trim().length).trim()
    const base = { trackId: track.id, ...(who ? { who } : {}) }
    let m: RegExpExecArray | null
    if (track.kind === 'condition') {
      if (/^on$/i.test(rest)) effects.push({ ...base, set: true })
      else if (/^off$/i.test(rest)) effects.push({ ...base, set: false })
      else errors.push(`"${part}": write ${track.name} on or ${track.name} off.`)
    } else if (track.kind === 'items') {
      if ((m = /^([+-])\s*(.+)$/.exec(rest)) && m[2].trim()) effects.push({ ...base, [m[1] === '+' ? 'gain' : 'lose']: m[2].trim().slice(0, 60) })
      else errors.push(`"${part}": write ${track.name} + item or ${track.name} - item.`)
    } else if ((m = /^([+-])\s*(\d{1,3})$/.exec(rest))) {
      effects.push({ ...base, delta: (m[1] === '-' ? -1 : 1) * Number(m[2]) })
    } else if ((m = /^=\s*(\d{1,3})$/.exec(rest))) {
      effects.push({ ...base, set: Number(m[1]) })
    } else {
      errors.push(`"${part}": write ${track.name} +1, ${track.name} -1, or ${track.name} = 2.`)
    }
  }
  return { effects, errors }
}

/** A move's choice effects in the short form: "hurt: Hurt on; spent: Supplies -1". */
export function choiceEffectsText(entries: MoveEffects['choiceEffects'], tracks: readonly CampaignTrack[] | undefined): string {
  return (entries ?? []).map((entry) => `${entry.option}: ${effectsText(entry.effects, tracks)}`).join('; ')
}

export function parseChoiceEffects(input: string, tracks: readonly CampaignTrack[] | undefined): { choiceEffects: NonNullable<MoveEffects['choiceEffects']>; errors: string[] } {
  const choiceEffects: NonNullable<MoveEffects['choiceEffects']> = []
  const errors: string[] = []
  for (const raw of input.split(';')) {
    const part = raw.trim()
    if (!part) continue
    const colon = part.indexOf(':')
    const option = colon > 0 ? part.slice(0, colon).trim() : ''
    if (!option) {
      errors.push(`"${part}": start with the option, then a colon, e.g. "spent: Supplies -1".`)
      continue
    }
    const parsed = parseEffects(part.slice(colon + 1), tracks)
    errors.push(...parsed.errors)
    if (parsed.effects.length) choiceEffects.push({ option: option.slice(0, 40), effects: parsed.effects })
  }
  return { choiceEffects, errors }
}

// ---- Reading state ------------------------------------------------------------------------------

function valueText(track: CampaignTrack, value: TrackValue): string {
  if (track.kind === 'condition') return value ? 'on' : 'off'
  if (track.kind === 'items') return Array.isArray(value) && value.length ? value.join(', ') : 'nothing'
  return track.max !== undefined ? `${value}/${track.max}` : String(value)
}

/** A change as it happened: "Supplies 3 → 2", "Hurt on (Bea)", "Gear + rope". */
export function appliedText(applied: AppliedChange, nameOf: (id: string) => string | undefined = () => undefined): string {
  const { track, change, holder } = applied
  const whose = holder && holder !== PLAYER_HOLDER ? ` (${nameOf(holder) ?? holder})` : ''
  if (track.kind === 'condition') return `${track.name} ${applied.after ? 'on' : 'off'}${whose}`
  if (track.kind === 'items') return [change.gain ? `${track.name} + ${change.gain}` : '', change.lose ? `${track.name} - ${change.lose}` : ''].filter(Boolean).join(', ') + whose
  return `${track.name} ${applied.before} → ${applied.after}${whose}`
}

/**
 * The state as prompt lines. The Game Master sees every track; a character sees the story-wide
 * tracks that aren't the GM's alone, and only their own per-character values.
 */
export function stateLines(
  state: GameState | undefined,
  tracks: readonly CampaignTrack[] | undefined,
  opts: { audience: 'gm' | { characterId: string }; playerId?: string; nameOf?: (id: string) => string | undefined },
): string[] {
  const gm = opts.audience === 'gm'
  const self = opts.audience === 'gm' ? undefined : opts.audience.characterId
  const player = opts.playerId ?? PLAYER_HOLDER
  const nameOf = (id: string) => (id === PLAYER_HOLDER ? 'the player' : opts.nameOf?.(id) ?? id)
  const lines: string[] = []
  for (const track of tracks ?? []) {
    if (track.gmOnly && !gm) continue
    const full = track.kind === 'clock' && track.max !== undefined ? (value: TrackValue) => value === track.max : () => false
    const describe = (value: TrackValue) => `${valueText(track, value)}${full(value) ? ' (full: what it counts toward happens now)' : ''}`
    if (!track.perCharacter) {
      const value = trackValue(state, track)
      if (track.kind === 'condition' && !value) continue
      lines.push(track.kind === 'condition' ? `${track.name}` : `${track.name}${track.kind === 'clock' ? ' clock' : ''}: ${describe(value)}`)
      continue
    }
    const holders = new Set(Object.keys(state ?? {}).filter((key) => key.startsWith(`${track.id}@`)).map((key) => key.slice(track.id.length + 1)))
    // A resource has a value for the player even untouched; conditions and items only once set.
    if (track.kind === 'resource' || track.kind === 'clock') holders.add(player)
    const shown = [...holders].filter((holder) => gm || holder === self)
    const entries = shown.map((holder) => ({ holder, value: trackValue(state, track, holder) }))
      .filter(({ value }) => (track.kind === 'condition' ? !!value : track.kind === 'items' ? Array.isArray(value) && value.length > 0 : true))
    if (!entries.length) continue
    if (track.kind === 'condition') lines.push(`${track.name}: ${entries.map(({ holder }) => nameOf(holder)).join(', ')}`)
    else lines.push(`${track.name}: ${entries.map(({ holder, value }) => `${nameOf(holder)} ${describe(value)}`).join('; ')}`)
  }
  return lines
}

// ---- Normalizing saved rules --------------------------------------------------------------------

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

/** Sanitize a world's tracks: named, unique, at most `MAX_TRACKS`. */
export function normalizeTracks(raw: unknown): CampaignTrack[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const ids = new Set<string>()
  const names = new Set<string>()
  return raw.slice(0, MAX_TRACKS).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const value = entry as Record<string, unknown>
    const name = text(value.name, 60)
    const id = text(value.id, 100) || slug(name)
    if (!name || !id || ids.has(id) || names.has(name.toLowerCase())) return []
    ids.add(id)
    names.add(name.toLowerCase())
    const kind: TrackKind = value.kind === 'condition' || value.kind === 'clock' || value.kind === 'items' ? value.kind : 'resource'
    const int = (v: unknown, min: number, max: number) => (Number.isInteger(v) && (v as number) >= min && (v as number) <= max ? v as number : undefined)
    const max = kind === 'clock' ? int(value.max, 1, 20) ?? 4 : kind === 'resource' ? int(value.max, 1, MAX_VALUE) : undefined
    const start = kind === 'resource' ? int(value.start, 0, max ?? MAX_VALUE) : undefined
    const description = text(value.description, 300)
    return [{
      id,
      name,
      kind,
      ...(description ? { description } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(start !== undefined ? { start } : {}),
      ...(value.perCharacter === true ? { perCharacter: true } : {}),
      ...(value.perScene === true && kind === 'clock' ? { perScene: true } : {}),
      ...(value.gmOnly === true ? { gmOnly: true } : {}),
    }]
  })
}

/** Sanitize a list of effects. Each needs a track and one thing to do to it. */
export function normalizeEffects(raw: unknown): TrackEffect[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const effects = raw.slice(0, 10).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const value = entry as Record<string, unknown>
    const trackId = text(value.trackId, 100)
    if (!trackId) return []
    const effect: TrackEffect = { trackId }
    if (Number.isInteger(value.delta) && Math.abs(value.delta as number) <= MAX_VALUE && value.delta !== 0) effect.delta = value.delta as number
    if (typeof value.set === 'boolean' || Number.isInteger(value.set) && (value.set as number) >= 0 && (value.set as number) <= MAX_VALUE) effect.set = value.set as number | boolean
    const gain = text(value.gain, 60)
    const lose = text(value.lose, 60)
    if (gain) effect.gain = gain
    if (lose) effect.lose = lose
    const who = text(value.who, 100)
    if (who) effect.who = who
    return effect.delta !== undefined || effect.set !== undefined || gain || lose ? [effect] : []
  })
  return effects
}

/** Sanitize a move's effects (`MoveEffects`). Absent fields stay absent. */
export function normalizeMoveEffects(move: Record<string, unknown>): MoveEffects {
  const out: MoveEffects = {}
  if (move.effects && typeof move.effects === 'object' && !Array.isArray(move.effects)) {
    const raw = move.effects as Record<string, unknown>
    const effects: NonNullable<MoveEffects['effects']> = {}
    for (const tier of ['strong', 'mixed', 'miss'] as const) {
      const list = normalizeEffects(raw[tier])
      if (list?.length) effects[tier] = list
    }
    if (Object.keys(effects).length) out.effects = effects
  }
  if (Array.isArray(move.choiceEffects)) {
    const choiceEffects = move.choiceEffects.slice(0, 6).flatMap((entry: unknown) => {
      if (!entry || typeof entry !== 'object') return []
      const option = text((entry as Record<string, unknown>).option, 40)
      const effects = normalizeEffects((entry as Record<string, unknown>).effects)
      return option && effects?.length ? [{ option, effects }] : []
    })
    if (choiceEffects.length) out.choiceEffects = choiceEffects
  }
  return out
}

/** Sanitize a chat's stored starting values: known shapes only. */
export function normalizeGameState(raw: unknown): GameState | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, 200).flatMap(([key, value]): [string, TrackValue][] => {
    if (!key || key.length > 201) return []
    if (typeof value === 'boolean') return [[key, value]]
    if (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_VALUE) return [[key, value as number]]
    if (Array.isArray(value)) return [[key, value.filter((item): item is string => typeof item === 'string' && !!item.trim()).map((item) => item.trim().slice(0, 60)).slice(0, MAX_ITEMS)]]
    return []
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}
