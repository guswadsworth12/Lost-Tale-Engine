import type { RomanceEmphasis } from './worldTemplates'

export interface CampaignConfig {
  ruleset: string
  edition?: string
  mode: 'guided' | 'mechanical'
  /** An adapter handles resolution rolls, not an entire published rulebook. */
  resolver: 'pbta'
  relationships: boolean
  dating: boolean
  /** World-authored fields for each character's sheet. Older campaigns derive these from moves. */
  stats?: CampaignStat[]
  moves: PbtaMove[]
}

export interface CampaignStat {
  id: string
  name: string
  description?: string
}

export interface CharacterSheet {
  /** The world whose stat ids these values were assigned against. */
  worldId?: string
  /** Values are PbtA modifiers from -5 to +5, keyed by stable world stat id. */
  stats: Record<string, number>
}

export interface PbtaMove {
  id: string
  name: string
  trigger: string
  stat: string
  /** Stable reference to a sheet field; old moves still resolve by their stat label. */
  statId?: string
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
  dice: [number, number]
  total: number
  tier: 'strong' | 'mixed' | 'miss'
  outcome: string
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
  moves: [
    { id: 'take-a-risk', name: 'Take a Risk', trigger: 'you act despite real danger or pressure', stat: 'Nerve', statId: 'nerve', strong: 'You do it cleanly.', mixed: 'You do it, but the GM names a cost, a complication, or a worse position.', miss: 'Things go wrong; the GM says how and asks what you do.' },
    { id: 'look-closer', name: 'Look Closer', trigger: 'you study a person, place, or situation for what matters', stat: 'Wits', statId: 'wits', strong: 'Ask two questions; the GM answers honestly.', mixed: 'Ask one question; the GM answers honestly.', miss: 'You learn something, but at a bad moment or with a wrong assumption.' },
    { id: 'lend-a-hand', name: 'Lend a Hand', trigger: 'you help someone who is already acting', stat: 'Heart', statId: 'heart', strong: 'They take +1 to their roll.', mixed: 'They take +1, and you share whatever it costs them.', miss: 'Your help makes things harder for both of you.' },
    { id: 'push-through', name: 'Push Through', trigger: 'you force your way past something by effort alone', stat: 'Grit', statId: 'grit', strong: 'You get through with nothing lost.', mixed: 'You get through, but choose: hurt, spent, or noticed.', miss: 'You are stopped, and the GM makes it hurt.' },
  ],
}

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
  return typeof value === 'number' && Number.isInteger(value) && value >= -5 && value <= 5 ? value : undefined
}

/** Sanitize imported sheet fields; absent legacy sheets remain absent. */
export function normalizeCharacterSheet(raw: unknown): CharacterSheet | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const stats = (raw as { stats?: unknown }).stats
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return undefined
  const worldId = (raw as { worldId?: unknown }).worldId
  return { ...(typeof worldId === 'string' && worldId.trim() ? { worldId: worldId.slice(0, 100) } : {}), stats: Object.fromEntries(Object.entries(stats).slice(0, 50).filter(([id, value]) =>
    id.length > 0 && id.length <= 100 && Number.isInteger(value) && (value as number) >= -5 && (value as number) <= 5)) }
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
    return [{ id, name, description: text(value.description, 500) || undefined }]
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
  return {
    ruleset: text(v.ruleset, 200) || 'Custom',
    edition: text(v.edition, 100) || undefined,
    mode: v.mode === 'mechanical' ? 'mechanical' : 'guided',
    resolver: 'pbta',
    relationships,
    dating: relationships && v.dating === true,
    ...(Array.isArray(v.stats) ? { stats: normalizeCampaignStats(v.stats) ?? [] } : {}),
    moves: v.moves.slice(0, 100)
      .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object' && !!text((m as Record<string, unknown>).name, 200))
      .map((m, i) => ({
        id: text(m.id, 100) || `move-${i + 1}`,
        name: text(m.name, 200),
        trigger: text(m.trigger, 2000),
        stat: text(m.stat, 100),
        ...(text(m.statId, 100) ? { statId: text(m.statId, 100) } : {}),
        strong: text(m.strong, 4000),
        mixed: text(m.mixed, 4000),
        miss: text(m.miss, 4000),
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
    for (const move of config.moves) lines.push(`- ${move.name}: when ${move.trigger}; roll +${move.stat || 'modifier'}.`)
  }
  return lines.filter(Boolean).join('\n')
}
