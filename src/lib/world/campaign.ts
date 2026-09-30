import type { RomanceEmphasis } from './worldTemplates'
// The server loads this file with plain Node, which needs the extension on a runtime import.
import { normalizeMoveEffects, normalizeTracks, type CampaignTrack, type MoveEffects } from './gameState.ts'
import { rollCustom, validateCustomResolver, type CustomResolver, type FaceRoller } from './customRules.ts'

export interface CampaignConfig {
  ruleset: string
  edition?: string
  mode: 'guided' | 'mechanical'
  /** An adapter handles resolution rolls, not an entire published rulebook. `custom` rolls the
   *  world's own declared dice and outcomes (`custom`, see `customRules.ts`). */
  resolver: 'pbta' | 'd20' | 'd20-degree' | 'fate' | 'roll-under' | 'custom'
  /** The world's own game system, when `resolver` is `custom`. */
  custom?: CustomResolver
  relationships: boolean
  dating: boolean
  /** World-authored fields for each character's sheet. Older campaigns derive these from moves. */
  stats?: CampaignStat[]
  /** The world's standing ladder, lowest first (e.g. apprentice → master). The GM scales what
   *  counts as routine, risky, or out of reach by it. A note can mark a rank that sits outside the
   *  ladder's order, such as an exceptional status. */
  ranks?: CampaignRank[]
  /** Resources, conditions, clocks, and item lists play keeps track of (`gameState.ts`). */
  tracks?: CampaignTrack[]
  moves: PbtaMove[]
}

export interface CampaignRank {
  name: string
  note?: string
}

export interface CampaignStat {
  id: string
  name: string
  description?: string
  /** A raw d20 ability score derives its modifier; other values are used directly. */
  valueMode?: 'modifier' | 'ability' | 'target'
}

export interface CharacterSheet {
  /** The world whose stat ids these values were assigned against. */
  worldId?: string
  /** World-defined ratings, keyed by stable stat id. */
  stats: Record<string, number>
  /** The character's standing on that world's rank ladder (`CampaignConfig.ranks`), by name. */
  rank?: string
}

/** A move, with the state effects of each result (`MoveEffects`). */
export interface PbtaMove extends MoveEffects {
  id: string
  name: string
  trigger: string
  stat: string
  /** Stable reference to a sheet field; old moves still resolve by their stat label. */
  statId?: string
  /** Fixed difficulty or opposition; omitted when it varies by scene. */
  target?: number
  strong: string
  mixed: string
  miss: string
}

export interface PbtaRoll {
  id: string
  moveId: string
  moveName: string
  stat: string
  modifier: number
  dice: number[]
  total: number
  tier: 'strong' | 'mixed' | 'miss'
  outcome: string
  resolver?: CampaignConfig['resolver']
  target?: number
  /** The player-supplied target, kept separate from a fixed world-authored target for retry checks. */
  requestedTarget?: number
  pendingGmMessageId?: string
  degree?: string
  rollMode?: 'normal' | 'advantage' | 'disadvantage'
  natural?: number
  /** A plain account of the dice, for a custom ruleset (`customRules.ts` `rollCustom`). */
  detail?: string
  createdAt: number
}

/**
 * A neutral starting move set for a new PbtA campaign, written for this engine rather than taken
 * from a published game. A campaign's own moves live with its world (or in a campaign file — see
 * `parseCampaignFile`), not in code.
 */
export const STARTER_PBTA_CAMPAIGN: CampaignConfig = {
  ruleset: 'Starter PbtA',
  edition: '1',
  mode: 'guided',
  resolver: 'pbta',
  relationships: false,
  dating: false,
  stats: [
    { id: 'nerve', name: 'Nerve', description: 'Courage under pressure.' },
    { id: 'wits', name: 'Wits', description: 'Observation and quick thinking.' },
    { id: 'heart', name: 'Heart', description: 'Empathy and connection.' },
    { id: 'grit', name: 'Grit', description: 'Endurance and persistence.' },
  ],
  // A small sample of tracked state: a condition, a resource, and a threat clock the moves feed.
  tracks: [
    { id: 'hurt', name: 'Hurt', kind: 'condition', perCharacter: true, description: 'Injured badly enough that it shows.' },
    { id: 'supplies', name: 'Supplies', kind: 'resource', max: 3, description: 'Food, light, and odds and ends for the road.' },
    { id: 'trouble', name: 'Trouble', kind: 'clock', max: 4, perScene: true, gmOnly: true, description: 'Fills as the scene turns against you. When it is full, the trouble arrives.' },
  ],
  moves: [
    { id: 'take-a-risk', name: 'Take a Risk', trigger: 'you act despite real danger or pressure', stat: 'Nerve', statId: 'nerve', strong: 'You do it cleanly.', mixed: 'You do it, but the GM names a cost, a complication, or a worse position.', miss: 'Things go wrong; the GM says how and asks what you do.',
      effects: { miss: [{ trackId: 'trouble', delta: 1 }] } },
    { id: 'look-closer', name: 'Look Closer', trigger: 'you study a person, place, or situation for what matters', stat: 'Wits', statId: 'wits', strong: 'Ask two questions; the GM answers honestly.', mixed: 'Ask one question; the GM answers honestly.', miss: 'You learn something, but at a bad moment or with a wrong assumption.',
      effects: { miss: [{ trackId: 'trouble', delta: 1 }] } },
    { id: 'lend-a-hand', name: 'Lend a Hand', trigger: 'you help someone who is already acting', stat: 'Heart', statId: 'heart', strong: 'They take +1 to their roll.', mixed: 'They take +1, and you share whatever it costs them.', miss: 'Your help makes things harder for both of you.' },
    { id: 'push-through', name: 'Push Through', trigger: 'you force your way past something by effort alone', stat: 'Grit', statId: 'grit', strong: 'You get through with nothing lost.', mixed: 'You get through, but choose: hurt, spent, or noticed.', miss: 'You are stopped, and the GM makes it hurt.',
      effects: { miss: [{ trackId: 'hurt', set: true }] },
      choiceEffects: [
        { option: 'hurt', effects: [{ trackId: 'hurt', set: true }] },
        { option: 'spent', effects: [{ trackId: 'supplies', delta: -1 }] },
        { option: 'noticed', effects: [{ trackId: 'trouble', delta: 1 }] },
      ] },
  ],
}

export function isCampaignResolver(value: unknown): value is CampaignConfig['resolver'] {
  return value === 'pbta' || value === 'd20' || value === 'd20-degree' || value === 'fate' || value === 'roll-under' || value === 'custom'
}

const checkMove = (id: string, name: string, statId: string, resolver: CampaignConfig['resolver']): PbtaMove => ({
  id, name, trigger: `you face a meaningful risk and use ${name.toLowerCase()}`, stat: name.replace(/ check$/, ''), statId,
  strong: 'The check succeeds. Describe the established effect.',
  mixed: resolver === 'fate' ? 'The check ties. The GM names a minor cost or reduced effect.' : 'The check succeeds with a complication.',
  miss: 'The check fails. The GM describes the consequence without granting the intended result.',
})

/**
 * Core check templates only; worlds can add their own fields, moves, and outcomes.
 * Mechanics references: D&D SRD 5.2.1 (https://www.dndbeyond.com/srd),
 * Fate Core (https://fate-srd.com/fate-core/actions-outcomes), and Paizo's
 * Starfinder 2e / Pathfinder 2e check rules (https://paizo.com/starfinder).
 * The 3d6 preset is generic roll-under, not a bundled GURPS rulebook.
 */
export const CAMPAIGN_PRESETS: { id: string; label: string; campaign: CampaignConfig }[] = [
  { id: 'pbta', label: 'Starter 2d6 moves', campaign: STARTER_PBTA_CAMPAIGN },
  { id: 'dnd-5-2', label: 'D&D 5e SRD 5.2.1 · core checks', campaign: {
    ruleset: 'D&D 5e SRD', edition: '5.2.1', mode: 'mechanical', resolver: 'd20', relationships: false, dating: false,
    stats: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'].map((name) => ({ id: name.toLowerCase(), name, valueMode: 'ability' })),
    moves: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'].map((name) => checkMove(`${name.toLowerCase()}-check`, `${name} check`, name.toLowerCase(), 'd20')),
  } },
  { id: 'starfinder-2', label: 'Starfinder 2e · core checks', campaign: {
    ruleset: 'Starfinder', edition: '2e', mode: 'mechanical', resolver: 'd20-degree', relationships: false, dating: false,
    stats: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'].map((name) => ({ id: name.toLowerCase(), name, valueMode: 'modifier' })),
    moves: ['Strength', 'Dexterity', 'Constitution', 'Intelligence', 'Wisdom', 'Charisma'].map((name) => checkMove(`${name.toLowerCase()}-check`, `${name} check`, name.toLowerCase(), 'd20-degree')),
  } },
  { id: 'fate-core', label: 'Fate Core · skill checks', campaign: {
    ruleset: 'Fate Core', mode: 'mechanical', resolver: 'fate', relationships: false, dating: false,
    stats: ['Athletics', 'Empathy', 'Investigate', 'Notice', 'Rapport', 'Will'].map((name) => ({ id: name.toLowerCase(), name, valueMode: 'modifier' })),
    moves: ['Athletics', 'Empathy', 'Investigate', 'Notice', 'Rapport', 'Will'].map((name) => checkMove(`${name.toLowerCase()}-check`, `${name} check`, name.toLowerCase(), 'fate')),
  } },
  { id: 'roll-under', label: '3d6 roll-under · custom skills', campaign: {
    ruleset: '3d6 Roll-under', mode: 'mechanical', resolver: 'roll-under', relationships: false, dating: false,
    stats: ['Might', 'Agility', 'Reason', 'Vitality'].map((name) => ({ id: name.toLowerCase(), name, valueMode: 'target' })),
    moves: ['Might', 'Agility', 'Reason', 'Vitality'].map((name) => checkMove(`${name.toLowerCase()}-check`, `${name} check`, name.toLowerCase(), 'roll-under')),
  } },
]

/** Old worlds had only free-text move stats. Give them stable derived fields until edited. */
export function campaignStats(campaign: CampaignConfig): CampaignStat[] {
  if (campaign.stats) return campaign.stats
  const names = new Map<string, string>()
  for (const move of campaign.moves) {
    const name = move.stat.trim()
    if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name)
  }
  return [...names].map(([key, name]) => ({ id: `legacy:${key}`, name }))
}

export function statForMove(campaign: CampaignConfig, move: PbtaMove): CampaignStat | undefined {
  const stats = campaignStats(campaign)
  if (move.statId) return stats.find((stat) => stat.id === move.statId)
  return stats.find((stat) => stat.name.toLowerCase() === move.stat.trim().toLowerCase())
}

export function sheetModifier(campaign: CampaignConfig, move: PbtaMove, sheet: CharacterSheet | undefined): number | undefined {
  const stat = statForMove(campaign, move)
  const value = stat && sheet?.stats[stat.id]
  if (typeof value !== 'number' || !Number.isInteger(value) || value < -100 || value > 100) return undefined
  if (stat?.valueMode === 'ability') return value >= 1 && value <= 30 ? Math.floor((value - 10) / 2) : undefined
  if (stat?.valueMode === 'target') return value >= 0 ? value : undefined
  return campaign.resolver === 'pbta' && (value < -5 || value > 5) ? undefined : value
}

/** A character can carry sheets for several worlds without changing their home world. */
export function sheetForWorld(character: { worldId?: string; sheet?: CharacterSheet; sheets?: Record<string, CharacterSheet> } | undefined, worldId: string): CharacterSheet | undefined {
  return character?.sheets?.[worldId] ?? (character?.sheet && (character.sheet.worldId === worldId || !character.sheet.worldId && character.worldId === worldId) ? character.sheet : undefined)
}

export function normalizeCharacterSheets(raw: unknown): Record<string, CharacterSheet> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const entries = Object.entries(raw).slice(0, 30).flatMap(([worldId, value]) => {
    if (!worldId || worldId.length > 100) return []
    const sheet = normalizeCharacterSheet(value)
    return sheet ? [[worldId, { ...sheet, worldId }] as const] : []
  })
  return Object.fromEntries(entries)
}

/** Sanitize imported sheet fields; absent legacy sheets remain absent. */
export function normalizeCharacterSheet(raw: unknown): CharacterSheet | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const stats = (raw as { stats?: unknown }).stats
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return undefined
  const worldId = (raw as { worldId?: unknown }).worldId
  const rank = text((raw as { rank?: unknown }).rank, 60)
  return { ...(typeof worldId === 'string' && worldId.trim() ? { worldId: worldId.slice(0, 100) } : {}), ...(rank ? { rank } : {}), stats: Object.fromEntries(Object.entries(stats).slice(0, 50).filter(([id, value]) =>
    id.length > 0 && id.length <= 100 && Number.isInteger(value) && (value as number) >= -100 && (value as number) <= 100)) }
}

/** Sanitize a rank ladder: named, unique, lowest first, at most 20 rungs. */
export function normalizeCampaignRanks(raw: unknown): CampaignRank[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  return raw.slice(0, 20).flatMap((entry: unknown) => {
    const value = typeof entry === 'string' ? { name: entry } : entry && typeof entry === 'object' ? entry as Record<string, unknown> : undefined
    const name = text(value?.name, 60)
    if (!name || seen.has(name.toLowerCase())) return []
    seen.add(name.toLowerCase())
    const note = text(value?.note, 200)
    return [{ name, ...(note ? { note } : {}) }]
  })
}

/**
 * The GM's scale rule for a world with a rank ladder. Rank decides what an action even is: routine
 * work for someone's standing needs no roll, uncertain work within reach is rolled, and work far
 * above it isn't a plain roll at all. Without a ladder there is nothing to scale by.
 */
export function scaleGuidance(config: CampaignConfig): string {
  const ranks = config.ranks ?? []
  if (!ranks.length) return ''
  const ladder = ranks.map((r) => (r.note ? `${r.name} (${r.note})` : r.name)).join(' → ')
  return [
    `Rank ladder, lowest to highest: ${ladder}.`,
    'Judge every action against the rank of whoever attempts it. Something well within that rank is routine: no roll, narrate it done. Roll only when the outcome is uncertain or risky for someone of that rank. Something far above it is not a plain roll: say what it would take (help, preparation, a cost, time), or that it is beyond them for now. Opposition\'s rank sets how hard a contested action is; a lower-ranked foe rarely threatens a higher-ranked character, while a much stronger one can overwhelm even a good roll.',
  ].join(' ')
}

export function normalizeCampaignStats(raw: unknown): CampaignStat[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const ids = new Set<string>()
  const names = new Set<string>()
  return raw.slice(0, 30).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const value = entry as Record<string, unknown>
    const name = text(value.name, 100)
    const id = text(value.id, 100) || `legacy:${name.toLowerCase()}`
    if (!name || ids.has(id) || names.has(name.toLowerCase())) return []
    ids.add(id)
    names.add(name.toLowerCase())
    const valueMode = value.valueMode === 'ability' || value.valueMode === 'target' || value.valueMode === 'modifier' ? value.valueMode : undefined
    return [{ id, name, description: text(value.description, 500) || undefined, ...(valueMode ? { valueMode } : {}) }]
  })
}

export const CAMPAIGN_FILE_FORMAT = 'lost-tales-campaign'

/** A campaign as a shareable file, so a world's rules can travel without shipping in the app. */
export function campaignFileFrom(config: CampaignConfig): string {
  return JSON.stringify({ format: CAMPAIGN_FILE_FORMAT, version: 1, campaign: config }, null, 2)
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Reads a campaign file (or a bare campaign object) and returns a validated config, or throws with the reason. */
export function parseCampaignFile(raw: string): CampaignConfig {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : undefined
  const c = obj?.format === CAMPAIGN_FILE_FORMAT ? obj.campaign : obj
  if (!c || typeof c !== 'object') throw new Error('That file has no campaign in it.')
  const v = c as Record<string, unknown>
  if (!Array.isArray(v.moves)) throw new Error('A campaign file needs a "moves" list.')
  const relationships = v.relationships === true
  let custom: CustomResolver | undefined
  if (v.resolver === 'custom') {
    const checked = validateCustomResolver(v.custom)
    if (!checked.resolver) throw new Error(`The custom ruleset needs fixing: ${checked.errors.join(' ')}`)
    custom = checked.resolver
  }
  return {
    ruleset: text(v.ruleset, 200) || 'Custom',
    edition: text(v.edition, 100) || undefined,
    mode: v.mode === 'mechanical' ? 'mechanical' : 'guided',
    resolver: isCampaignResolver(v.resolver) ? v.resolver : 'pbta',
    ...(custom ? { custom } : {}),
    relationships,
    dating: relationships && v.dating === true,
    ...(Array.isArray(v.stats) ? { stats: normalizeCampaignStats(v.stats) ?? [] } : {}),
    ...(Array.isArray(v.ranks) ? { ranks: normalizeCampaignRanks(v.ranks) ?? [] } : {}),
    ...(Array.isArray(v.tracks) ? { tracks: normalizeTracks(v.tracks) ?? [] } : {}),
    moves: v.moves.slice(0, 100)
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && !!text((m as Record<string, unknown>).name, 200))
      .map((m, i) => ({
        id: text(m.id, 100) || `move-${i + 1}`,
        name: text(m.name, 200),
        trigger: text(m.trigger, 2000),
        stat: text(m.stat, 100),
        ...(text(m.statId, 100) ? { statId: text(m.statId, 100) } : {}),
        ...(typeof m.target === 'number' && Number.isInteger(m.target) && m.target >= -30 && m.target <= 100 ? { target: m.target } : {}),
        strong: text(m.strong, 4000),
        mixed: text(m.mixed, 4000),
        miss: text(m.miss, 4000),
        ...normalizeMoveEffects(m),
      })),
  }
}

export function resolvePbtaRoll(move: PbtaMove, modifier: number, dice: [number, number]): Omit<PbtaRoll, 'id' | 'createdAt'> {
  if (!Number.isInteger(modifier) || modifier < -5 || modifier > 5) throw new Error('Modifier must be an integer from -5 to 5')
  if (dice.some((die) => !Number.isInteger(die) || die < 1 || die > 6)) throw new Error('Each die must be between 1 and 6')
  const total = dice[0] + dice[1] + modifier
  const tier = total >= 10 ? 'strong' : total >= 7 ? 'mixed' : 'miss'
  return { moveId: move.id, moveName: move.name, stat: move.stat, modifier, dice, total, tier, outcome: move[tier] }
}

/** Deterministic core check resolution. The server supplies the dice and records this snapshot. */
export function resolveCampaignRoll(config: CampaignConfig, move: PbtaMove, modifier: number, dice: number[], suppliedTarget?: number, rollMode: 'normal' | 'advantage' | 'disadvantage' = 'normal'): Omit<PbtaRoll, 'id' | 'createdAt'> {
  if (config.resolver === 'pbta') {
    if (dice.length !== 2) throw new Error('A 2d6 move needs two dice.')
    return { ...resolvePbtaRoll(move, modifier, dice as [number, number]), resolver: 'pbta' }
  }
  if (!Number.isInteger(modifier) || modifier < -100 || modifier > 100) throw new Error('Sheet value is out of range.')
  if (config.resolver === 'roll-under' && modifier < 0) throw new Error('A roll-under target cannot be negative.')
  const target = config.resolver === 'roll-under' ? modifier : move.target ?? suppliedTarget
  if (!Number.isInteger(target) || (target as number) < -30 || (target as number) > 100) throw new Error('A valid check difficulty is required.')
  let total: number
  let degree: string
  let natural: number | undefined
  let tier: PbtaRoll['tier']
  if (config.resolver === 'd20' || config.resolver === 'd20-degree') {
    const count = rollMode === 'normal' ? 1 : 2
    if (dice.length !== count || !dice.every((die) => Number.isInteger(die) && die >= 1 && die <= 20)) throw new Error('A d20 check needs valid d20 dice.')
    natural = rollMode === 'advantage' ? Math.max(...dice) : rollMode === 'disadvantage' ? Math.min(...dice) : dice[0]
    total = natural + modifier
    if (config.resolver === 'd20-degree') {
      const margin = total - (target as number)
      const levels = ['critical failure', 'failure', 'success', 'critical success']
      const base = margin >= 10 ? 3 : margin >= 0 ? 2 : margin <= -10 ? 0 : 1
      const index = Math.max(0, Math.min(3, base + (natural === 20 ? 1 : natural === 1 ? -1 : 0)))
      degree = levels[index]
      tier = index >= 2 ? 'strong' : 'miss'
    } else {
      degree = total >= (target as number) ? 'success' : 'failure'
      tier = degree === 'success' ? 'strong' : 'miss'
    }
  } else if (config.resolver === 'fate') {
    if (dice.length !== 4 || !dice.every((die) => die === -1 || die === 0 || die === 1)) throw new Error('A Fate check needs four Fate dice.')
    total = dice.reduce((sum, die) => sum + die, modifier)
    const margin = total - (target as number)
    degree = margin >= 3 ? 'success with style' : margin > 0 ? 'success' : margin === 0 ? 'tie' : 'failure'
    tier = margin > 0 ? 'strong' : margin === 0 ? 'mixed' : 'miss'
  } else {
    if (dice.length !== 3 || !dice.every((die) => Number.isInteger(die) && die >= 1 && die <= 6)) throw new Error('A roll-under check needs three d6 dice.')
    total = dice.reduce((sum, die) => sum + die, 0)
    const criticalSuccess = total <= 4 || total === 5 && modifier >= 15 || total === 6 && modifier >= 16
    const criticalFailure = total === 18 || total === 17 && modifier < 16 || total - modifier >= 10
    degree = criticalSuccess ? 'critical success' : criticalFailure ? 'critical failure' : total <= modifier && total < 17 ? 'success' : 'failure'
    tier = degree.endsWith('success') ? 'strong' : 'miss'
  }
  return { moveId: move.id, moveName: move.name, stat: move.stat, modifier, dice, total, tier, outcome: move[tier], resolver: config.resolver, target, degree, ...(natural ? { natural, rollMode } : {}) }
}

/**
 * A move rolled under the world's own ruleset. The dice come from `face` (the server's secure
 * roller, or a test's fixed faces); the band's tier is what the rest of the engine runs on.
 */
export function resolveCustomCampaignRoll(config: CampaignConfig, move: PbtaMove, modifier: number, suppliedTarget: number | undefined, face: FaceRoller): Omit<PbtaRoll, 'id' | 'createdAt'> {
  if (config.resolver !== 'custom' || !config.custom) throw new Error('This campaign has no custom ruleset.')
  if (!Number.isInteger(modifier) || modifier < -100 || modifier > 100) throw new Error('Sheet value is out of range.')
  const target = move.target ?? suppliedTarget
  if (config.custom.compare === 'margin' && (!Number.isInteger(target) || (target as number) < -30 || (target as number) > 100)) throw new Error('A valid check difficulty is required.')
  const roll = rollCustom(config.custom, modifier, config.custom.compare === 'margin' ? target : undefined, face)
  const tier = roll.band.tier
  return {
    moveId: move.id, moveName: move.name, stat: move.stat, modifier, dice: roll.dice, total: roll.result, tier,
    outcome: [roll.band.meaning, move[tier]].filter(Boolean).join(' '),
    resolver: 'custom', degree: roll.band.label, detail: roll.detail,
    ...(config.custom.compare === 'margin' ? { target } : {}),
  }
}

export function rollPbtaMove(move: PbtaMove, modifier: number): PbtaRoll {
  const die = () => {
    const byte = new Uint8Array(1)
    do { crypto.getRandomValues(byte) } while (byte[0] >= 252)
    return 1 + byte[0] % 6
  }
  return { ...resolvePbtaRoll(move, modifier, [die(), die()]), id: crypto.randomUUID(), createdAt: Date.now() }
}

export function formatPbtaRoll(roll: PbtaRoll, action: string): string {
  const tier = roll.tier === 'strong' ? '10+ strong hit' : roll.tier === 'mixed' ? '7–9 mixed hit' : '6 or less miss'
  return `[Campaign move: ${roll.moveName}]\nAction: ${action.trim() || 'The player invokes the move.'}\nDice: ${roll.dice[0]} + ${roll.dice[1]} ${roll.modifier >= 0 ? '+' : '-'} ${Math.abs(roll.modifier)} ${roll.stat} = ${roll.total} (${tier}).\nRecorded outcome: ${roll.outcome}\nNarrate the consequence of this recorded result. Do not reroll or change the total.`
}

export const DEFAULT_CAMPAIGN: CampaignConfig = {
  ruleset: 'Custom',
  mode: 'guided',
  resolver: 'pbta',
  relationships: false,
  dating: false,
  moves: [],
}

export function campaignPrompt(config: CampaignConfig, romanceEmphasis: RomanceEmphasis = config.dating ? 'focus' : 'off'): string {
  const lines = [
    `Campaign ruleset: ${config.ruleset}${config.edition ? ` (${config.edition})` : ''}.`,
    config.mode === 'guided'
      ? 'Resolution mode: guided. Use the named ruleset as story guidance. Do not invent a die roll or claim a mechanical result.'
      : 'Resolution mode: mechanical. Respect the recorded move result. Do not invent a die roll, change its total, or award resources in narration.',
    config.relationships ? '' : 'Relationships develop through the story without automatic relationship scoring.',
    romanceEmphasis === 'focus' && config.dating ? 'Dating can arise from character choices, with consent and established relationships respected.' : '',
  ]
  if (config.mode === 'mechanical' && config.moves.length) {
    lines.push('Available moves:')
    for (const move of config.moves) lines.push(`- ${move.name}: when ${move.trigger}; use ${move.stat || 'the linked sheet field'} with the ${config.resolver} check resolver.`)
  }
  return lines.filter(Boolean).join('\n')
}
