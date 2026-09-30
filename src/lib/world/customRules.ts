/**
 * A world's own game system, declared rather than coded: how its dice are rolled and what each
 * result means. The Writer's Room drafts one from a description ("Blades in the Dark: roll a d6
 * pool, take the highest; 6 is a full success, 4–5 partial, 1–3 bad"); the server rolls it and
 * records the result, and the GM is bound by it like any built-in resolver.
 *
 * Every outcome band counts as one of the engine's three tiers (strong, mixed, miss), so everything
 * that already runs on tiers applies unchanged: recorded rolls are binding, move effects on tracked
 * state, and the question and choice holds.
 *
 * Only relative `.ts` imports here: the server loads this file with plain Node.
 */

export type RollTier = 'strong' | 'mixed' | 'miss'

export interface CustomDice {
  /** Dice rolled. With `pool`, the base the sheet value adds to (0 for a pure stat pool). */
  count: number
  sides: number
  /** The sheet value adds that many dice instead of adding to the result. */
  pool?: boolean
  /** A pool of zero dice or fewer rolls this many and keeps the lowest one (Blades: 2). Unset: 1. */
  emptyPool?: number
  keep?: { which: 'highest' | 'lowest'; count: number }
  /** A die showing its highest face is rolled again and added, up to `MAX_EXPLOSIONS` times. */
  explode?: boolean
  /** An extra die of this many sides rolled alongside (Savage Worlds' wild die): the better counts. */
  wildDie?: number
  /** Count dice showing this or more as successes; the result is how many. */
  successOn?: number
}

export interface CustomBand {
  label: string
  tier: RollTier
  /** Lowest result (or margin) in the band. Unset: no lower bound. */
  min?: number
  /** Highest result (or margin) in the band. Unset: no upper bound. */
  max?: number
  /** Only when at least this many dice show their highest face (a Blades critical: 2 sixes). All
   *  the dice rolled count, except when keeping the lowest: then only the kept ones, so a desperate
   *  roll never crits on dice it throws away. Checked before the plain ranges; a band with this is
   *  an extra, not part of the coverage. */
  topFaces?: number
  /** What this outcome means in play, told to the GM with the move's own result text. */
  meaning?: string
}

export interface CustomResolver {
  dice: CustomDice
  /** `result`: bands read the result itself. `margin`: result minus the check's difficulty. */
  compare: 'result' | 'margin'
  bands: CustomBand[]
}

export const MAX_EXPLOSIONS = 10
const MAX_DICE = 20
const MAX_BANDS = 12

// ---- Rolling -----------------------------------------------------------------------------------

export interface CustomRollResult {
  /** Each die's value, explosions added in; the wild die, when rolled, last. */
  dice: number[]
  result: number
  band: CustomBand
  /** Result minus difficulty, for `margin` rulesets. */
  margin?: number
  /** A plain account of the roll, for the GM and the transcript. */
  detail: string
}

/** Rolls a die of `sides`: a whole number from 1 to `sides`. Injected so tests and the server pick the dice. */
export type FaceRoller = (sides: number) => number

function rollDie(sides: number, explode: boolean | undefined, face: FaceRoller): { value: number; top: boolean } {
  const first = face(sides)
  let value = first
  let last = first
  for (let n = 0; explode && last === sides && n < MAX_EXPLOSIONS; n++) {
    last = face(sides)
    value += last
  }
  return { value, top: first === sides }
}

/** How many dice a roll takes, and how many of them count. */
function poolShape(dice: CustomDice, modifier: number): { rolled: number; keep?: CustomDice['keep'] } {
  if (!dice.pool) return { rolled: dice.count, keep: dice.keep }
  const size = dice.count + modifier
  if (size <= 0) return { rolled: dice.emptyPool ?? 1, keep: { which: 'lowest', count: 1 } }
  return { rolled: Math.min(MAX_DICE, size), keep: dice.keep }
}

/**
 * The band a result lands in: a matching top-faces band first, then the range holding it. Assumes
 * a validated resolver, whose ranges cover every whole number.
 */
export function bandFor(resolver: CustomResolver, value: number, topFaces = 0): CustomBand {
  const inRange = (b: CustomBand) => (b.min === undefined || value >= b.min) && (b.max === undefined || value <= b.max)
  return resolver.bands.find((b) => b.topFaces !== undefined && topFaces >= b.topFaces && inRange(b))
    ?? resolver.bands.find((b) => b.topFaces === undefined && inRange(b))
    ?? resolver.bands[resolver.bands.length - 1]
}

/** Rolls a check under `resolver`. Pure given `face`; the server passes a secure random roller. */
export function rollCustom(resolver: CustomResolver, modifier: number, target: number | undefined, face: FaceRoller): CustomRollResult {
  const { dice } = resolver
  const shape = poolShape(dice, modifier)
  const rolled = Array.from({ length: shape.rolled }, () => rollDie(dice.sides, dice.explode, face))
  const order = rolled.map((die, index) => ({ ...die, index })).sort((a, b) => b.value - a.value)
  const keptCount = shape.keep ? Math.min(shape.keep.count, rolled.length) : rolled.length
  const kept = shape.keep?.which === 'lowest' ? order.slice(-keptCount) : order.slice(0, keptCount)
  const addModifier = !dice.pool
  let result = dice.successOn !== undefined
    ? kept.filter((die) => die.value >= dice.successOn!).length
    : kept.reduce((sum, die) => sum + die.value, 0)
  if (addModifier) result += modifier
  let wild: { value: number; top: boolean } | undefined
  if (dice.wildDie) {
    wild = rollDie(dice.wildDie, dice.explode, face)
    result = Math.max(result, wild.value + (addModifier ? modifier : 0))
  }
  const margin = resolver.compare === 'margin' && target !== undefined ? result - target : undefined
  const topFaces = (shape.keep?.which === 'lowest' ? kept : rolled).filter((die) => die.top).length
  const band = bandFor(resolver, margin ?? result, topFaces)
  const values = rolled.map((die) => die.value)
  const keptNote = shape.keep && keptCount < rolled.length ? `, keeping the ${shape.keep.which} ${keptCount === 1 ? '' : `${keptCount} `}(${kept.map((d) => d.value).join(', ')})` : ''
  const detail = [
    `${rolled.length}d${dice.sides}${dice.explode ? ' (exploding)' : ''}: ${values.join(', ')}${keptNote}`,
    wild ? `; wild d${dice.wildDie}: ${wild.value}` : '',
    dice.successOn !== undefined ? `; ${result} success${result === 1 ? '' : 'es'} on ${dice.successOn}+` : '',
    addModifier && modifier ? `; ${modifier > 0 ? '+' : '-'}${Math.abs(modifier)}` : '',
    dice.successOn === undefined ? `; result ${result}` : '',
    margin !== undefined ? ` vs difficulty ${target} (margin ${margin >= 0 ? '+' : ''}${margin})` : '',
  ].join('')
  return { dice: wild ? [...values, wild.value] : values, result, band, ...(margin !== undefined ? { margin } : {}), detail }
}

/** A secure die for the server and the test bench. */
export function randomFace(sides: number): number {
  const limit = Math.floor(0x100000000 / sides) * sides
  const buf = new Uint32Array(1)
  do { globalThis.crypto.getRandomValues(buf) } while (buf[0] >= limit)
  return 1 + (buf[0] % sides)
}

// ---- Describing ----------------------------------------------------------------------------------

/** The dice in words, for the GM, the editor and the Writer's Room. */
export function describeDice(dice: CustomDice): string {
  const base = dice.pool
    ? `a pool of d${dice.sides} equal to ${dice.count ? `${dice.count} + ` : ''}the sheet value (none: roll ${dice.emptyPool ?? 1}, keep the lowest)`
    : `${dice.count}d${dice.sides}${dice.successOn === undefined && !dice.wildDie ? ' plus the sheet value' : ''}`
  return [
    `Roll ${base}`,
    dice.keep ? `, keep the ${dice.keep.which} ${dice.keep.count}` : '',
    dice.explode ? ', a die on its highest face rolls again and adds' : '',
    dice.wildDie ? `, with a wild d${dice.wildDie} beside it; the better of the two, plus the sheet value, counts` : '',
    dice.successOn !== undefined ? `, and count dice showing ${dice.successOn}+ as successes` : '',
    '.',
  ].join('')
}

function rangeText(band: CustomBand): string {
  if (band.min !== undefined && band.max !== undefined) return band.min === band.max ? `${band.min}` : `${band.min} to ${band.max}`
  if (band.min !== undefined) return `${band.min} or more`
  if (band.max !== undefined) return `${band.max} or less`
  return 'any'
}

/** Each band on one line: what lands there, what it's called, which tier it counts as, what it means. */
export function describeBands(resolver: CustomResolver): string[] {
  const of = resolver.compare === 'margin' ? 'Margin over the difficulty' : 'Result'
  return resolver.bands.map((b) => `${b.topFaces ? `${b.topFaces}+ dice on their highest face${b.min !== undefined || b.max !== undefined ? `, ${of.toLowerCase()} ${rangeText(b)}` : ''}` : `${of} ${rangeText(b)}`}: ${b.label} (${b.tier})${b.meaning ? `. ${b.meaning}` : ''}`)
}

/** How each tier reads under this ruleset, from its bands: "Partial", "Success or Raise". */
export function tierLabels(resolver: CustomResolver): Record<RollTier, string> {
  const label = (tier: RollTier) => resolver.bands.filter((b) => b.tier === tier).map((b) => b.label).join(' or ')
  return { strong: label('strong') || 'Strong', mixed: label('mixed') || 'Mixed', miss: label('miss') || 'Miss' }
}

// ---- Validating ----------------------------------------------------------------------------------

const int = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const isTier = (v: unknown): v is RollTier => v === 'strong' || v === 'mixed' || v === 'miss'

/**
 * A ruleset from a draft or a request, checked. `errors` says, in plain words, everything that has
 * to change before it can be saved; `resolver` is set only when there are none.
 */
export function validateCustomResolver(raw: unknown): { resolver?: CustomResolver; errors: string[] } {
  const errors: string[] = []
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const d = v.dice && typeof v.dice === 'object' && !Array.isArray(v.dice) ? v.dice as Record<string, unknown> : undefined
  if (!d) errors.push('Say which dice are rolled.')
  const pool = d?.pool === true
  const count = int(d?.count)
  const sides = int(d?.sides)
  if (count === undefined || count < (pool ? 0 : 1) || count > MAX_DICE) errors.push(pool ? `A pool's base dice must be 0 to ${MAX_DICE}.` : `The number of dice must be 1 to ${MAX_DICE}.`)
  if (sides === undefined || sides < 2 || sides > 100) errors.push('Dice need 2 to 100 sides.')
  const dice: CustomDice = { count: count ?? 1, sides: sides ?? 6, ...(pool ? { pool } : {}) }
  if (d?.emptyPool !== undefined) {
    const empty = int(d.emptyPool)
    if (!pool) errors.push('Only a pool can say what an empty pool rolls.')
    else if (empty === undefined || empty < 1 || empty > 5) errors.push('An empty pool rolls 1 to 5 dice.')
    else dice.emptyPool = empty
  }
  if (d?.keep !== undefined) {
    const k = d.keep && typeof d.keep === 'object' ? d.keep as Record<string, unknown> : {}
    const keepCount = int(k.count)
    if (k.which !== 'highest' && k.which !== 'lowest') errors.push('Keep the highest or the lowest dice.')
    else if (keepCount === undefined || keepCount < 1 || (!pool && keepCount > dice.count)) errors.push(`Keep 1 to ${pool ? MAX_DICE : dice.count} dice.`)
    else dice.keep = { which: k.which, count: keepCount }
  }
  if (d?.explode === true) dice.explode = true
  if (d?.wildDie !== undefined) {
    const wild = int(d.wildDie)
    if (wild === undefined || wild < 2 || wild > 100) errors.push('A wild die needs 2 to 100 sides.')
    else if (pool || d.successOn !== undefined) errors.push('A wild die works with a plain total, not a pool or successes.')
    else dice.wildDie = wild
  }
  if (d?.successOn !== undefined) {
    const on = int(d.successOn)
    if (on === undefined || on < 2 || on > dice.sides) errors.push(`Successes need a target number from 2 to ${dice.sides}.`)
    else dice.successOn = on
  }
  if (v.compare !== 'result' && v.compare !== 'margin') errors.push('Say whether outcomes read the result itself or its margin over a difficulty.')
  const compare = v.compare === 'margin' ? 'margin' : 'result'

  const rawBands = Array.isArray(v.bands) ? v.bands : []
  if (rawBands.length < 2 || rawBands.length > MAX_BANDS) errors.push(`Give 2 to ${MAX_BANDS} outcomes.`)
  const bands: CustomBand[] = []
  rawBands.slice(0, MAX_BANDS).forEach((entry: unknown, i) => {
    const b = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {}
    const label = text(b.label, 40)
    const name = label || `Outcome ${i + 1}`
    if (!label) errors.push(`Outcome ${i + 1} needs a name.`)
    if (!isTier(b.tier)) errors.push(`${name} must count as strong, mixed, or miss.`)
    const min = b.min === undefined || b.min === null ? undefined : int(b.min)
    const max = b.max === undefined || b.max === null ? undefined : int(b.max)
    if ((b.min !== undefined && b.min !== null && min === undefined) || (b.max !== undefined && b.max !== null && max === undefined)) errors.push(`${name}'s range must be whole numbers.`)
    if (min !== undefined && max !== undefined && min > max) errors.push(`${name} starts above where it ends.`)
    const top = b.topFaces === undefined || b.topFaces === null ? undefined : int(b.topFaces)
    if (b.topFaces !== undefined && b.topFaces !== null && (top === undefined || top < 1 || top > MAX_DICE)) errors.push(`${name} needs 1 to ${MAX_DICE} dice on their highest face.`)
    const meaning = text(b.meaning, 500)
    bands.push({ label: name, tier: isTier(b.tier) ? b.tier : 'miss', ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(top !== undefined ? { topFaces: top } : {}), ...(meaning ? { meaning } : {}) })
  })
  const labels = new Set<string>()
  for (const b of bands) {
    if (labels.has(b.label.toLowerCase())) errors.push(`Two outcomes are both called ${b.label}.`)
    labels.add(b.label.toLowerCase())
  }

  // The plain ranges must give every possible number exactly one outcome.
  const ranges = bands.filter((b) => b.topFaces === undefined).sort((a, b) => (a.min ?? -Infinity) - (b.min ?? -Infinity))
  if (bands.length >= 2 && !ranges.length) errors.push('Give at least one outcome that isn\'t only for top faces.')
  if (ranges.length) {
    if (ranges[0].min !== undefined) errors.push(`Nothing covers results below ${ranges[0].min}: leave the lowest outcome open at the bottom.`)
    if (ranges[ranges.length - 1].max !== undefined) errors.push(`Nothing covers results above ${ranges[ranges.length - 1].max}: leave the highest outcome open at the top.`)
    for (let i = 1; i < ranges.length; i++) {
      const before = ranges[i - 1]
      const after = ranges[i]
      if (before.max === undefined || after.min === undefined || after.min <= before.max) errors.push(`${before.label} and ${after.label} overlap.`)
      else if (after.min > before.max + 1) errors.push(`Nothing covers ${after.min - 1 === before.max + 1 ? before.max + 1 : `${before.max + 1} to ${after.min - 1}`}, between ${before.label} and ${after.label}.`)
    }
  }
  return errors.length ? { errors: [...new Set(errors)] } : { resolver: { dice, compare, bands }, errors: [] }
}

/** Whether a check under this ruleset needs a difficulty set before it's rolled. */
export function customNeedsTarget(resolver: CustomResolver | undefined): boolean {
  return resolver?.compare === 'margin'
}
