import type { CampaignConfig, PbtaRoll } from './campaign'

/**
 * The game master agent. Separate from the character agents on purpose: the GM paces the scene,
 * decides who acts, adjudicates the player's declared action under the campaign's resolver mode,
 * and proposes lasting changes. It never speaks *as* a character — character dialogue comes from
 * each character's own prompt (`useChatSession`'s `buildCurrentPrompt`), which is the only place
 * private lore, private memory, and card prompt items are assembled.
 *
 * The GM sees public setting and an optional storyteller-only continuity note. Character private
 * memory and prompt items never reach this prompt. The note may contain secrets the GM must pace
 * without revealing them before the story earns that knowledge.
 *
 * Everything the GM decides is stored on its own chat message (`StoredMessage.gm`). Forks copy
 * messages and rewinds delete them, so the GM's record — including which consequences the player
 * confirmed — follows the branch without a separate event table to keep in sync.
 */

export const GM_SPEAKER_ID = 'game-master'
export const GM_NAME = 'Game Master'

/** A PbtA move result the player rolled, stored on the user message that declared it. */
export interface RecordedMove extends PbtaRoll {
  action: string
}

export type GmPacing = 'linger' | 'advance' | 'cut'

export interface GmProposal {
  id: string
  /** `branch` stays with this chat branch; `world` becomes shared canon for every chat in the world once confirmed. */
  scope: 'branch' | 'world'
  text: string
  status: 'pending' | 'confirmed' | 'rejected'
  decidedAt?: number
}

export interface GmAdjudication {
  action: string
  /** Where the outcome came from — shown in the UI so a guided judgment never reads as a rules result. */
  source: 'recorded_roll' | 'guided_judgment' | 'roll_needed'
  moveId?: string
  moveName?: string
  tier?: PbtaRoll['tier']
  total?: number
  rollId?: string
  outcome: string
}

export interface GmTurn {
  mode: CampaignConfig['mode']
  ruleset: string
  narration: string
  pacing: GmPacing
  /** Character agents to act this beat, in order. Never includes a player-controlled character. */
  speakerIds: string[]
  /** Existing world characters brought into the scene for the next beat. */
  addCharacterIds?: string[]
  /** A new branch the GM decided this beat warrants. `chatId` is filled after the fork is saved. */
  fork?: { title: string; reason: string; chatId?: string }
  /** Public lorebook entries the GM called for the character agents on this beat. */
  loreCallIds?: string[]
  adjudication?: GmAdjudication
  proposals: GmProposal[]
  /** The scenery line the GM was shown, kept for the inspector. */
  scenery: string
  /** Set when the model's output was unusable and a deterministic fallback ran instead. */
  fallback?: string
  /** Engine corrections applied to the model's decision (e.g. a tier that disagreed with the dice). */
  corrections?: string[]
}

export interface GmRosterEntry {
  id: string
  name: string
  occupation?: string
}

export interface GmContext {
  campaign: CampaignConfig
  worldName: string
  worldDescription?: string
  worldRules?: string
  gmNotes?: string
  scenario?: string
  canonFacts: string[]
  branchConsequences: string[]
  scenery: string
  timeOfDay?: string
  /** Character agents present — player-controlled characters already removed. */
  roster: GmRosterEntry[]
  /** World characters available to enter, excluding the player's character and current cast. */
  availableRoster?: GmRosterEntry[]
  /** False when a nearby beat already forked this conversation. */
  canFork?: boolean
  loreIndex?: { id: string; title: string }[]
  playerName: string
  transcript: { speaker: string; text: string }[]
  playerAction: string
  recordedMove?: RecordedMove
  maxSpeakers: number
}

const TIER_LABEL: Record<PbtaRoll['tier'], string> = { strong: '10+ strong hit', mixed: '7–9 mixed hit', miss: '6- miss' }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const firstName = (s: string) => s.trim().toLowerCase().split(/[\s,]+/)[0] ?? ''

/** Characters the player controls are never GM-directed agents. Matched by persona name, whole or first-name. */
export function isPlayerCharacter(characterName: string, playerName: string): boolean {
  const a = characterName.trim().toLowerCase()
  const b = playerName.trim().toLowerCase()
  if (!a || !b) return false
  return a === b || firstName(a) === firstName(b)
}

export function buildGmPrompt(ctx: GmContext): { system: string; user: string } {
  const { campaign } = ctx
  const modeLines = campaign.mode === 'mechanical'
    ? [
        `Resolution mode: MECHANICAL (${campaign.resolver.toUpperCase()} resolver).`,
        'A recorded roll is binding. Report its tier and outcome exactly; never reroll, change the total, or soften a miss.',
        'If the player declares an action that triggers a move and no roll is recorded, set "move" to that move name and leave "tier" null: the player must roll before it resolves.',
        'You may not invent dice, totals, or resources.',
      ]
    : [
        'Resolution mode: GUIDED. The ruleset informs tone and likely consequences only.',
        'Adjudicate with judgment: say plainly what happens because of the declared action. Never claim a die roll, total, or tier.',
      ]
  const moveLines = campaign.moves.length
    ? ['Moves:', ...campaign.moves.map((m) => `- ${m.name} (+${m.stat || 'modifier'}): when ${m.trigger}. 10+: ${m.strong} 7–9: ${m.mixed} 6-: ${m.miss}`)]
    : []
  const system = [
    `You are the GAME MASTER for a ${campaign.ruleset}${campaign.edition ? ` (${campaign.edition})` : ''} story in the setting "${ctx.worldName}".`,
    'You run the scene; you do not play the characters. Each character is voiced by their own separate agent after you decide.',
    `${ctx.playerName} is the player's character. Never write ${ctx.playerName}'s dialogue, voluntary actions, choices, thoughts, feelings, or discoveries, and never pick ${ctx.playerName} to act.`,
    ...modeLines,
    ...moveLines,
    'Your job each beat: (1) adjudicate the player\'s declared action, (2) narrate the immediate, observable result in 1-3 sentences of present-tense prose, (3) choose which present characters react and in what order, (4) choose pacing, (5) propose lasting changes only when something durable really happened.',
    'You may add at most one available character to the scene when an entrance follows naturally from the fiction. That character becomes eligible to speak on the next beat. Never add the player character.',
    'Fork only when a consequential choice or simultaneous story thread deserves its own continuing branch. A scene change, quiet beat, or new arrival alone does not warrant a fork. Give a brief reason and a useful branch title. Otherwise use null.',
    'You may call up to two listed public lorebook entries by title when their facts matter to this beat. Each called entry will be supplied to the character agents. Do not call unrelated entries just to fill context.',
    'Storyteller-only notes may describe secrets or planned arcs. Respect each character’s knowledge boundary: do not reveal, foreshadow as certain, or make a character act on information they have not learned in the story.',
    'Pacing: "linger" keeps the moment open, "advance" moves the situation forward, "cut" ends the scene.',
    'Proposals are suggestions the player must confirm. Use scope "branch" for consequences of this story branch and "world" only for setting facts every story in this world should inherit.',
    'Reply with one JSON object and nothing else:',
    '{"narration": string, "pacing": "linger"|"advance"|"cut", "speakers": [present character names], "addCharacters": [at most one available character name], "fork": {"title": string, "reason": string}|null, "loreCalls": [up to two listed lore titles], "adjudication": {"action": string, "move": string|null, "tier": "strong"|"mixed"|"miss"|null, "outcome": string} | null, "proposals": [{"scope": "branch"|"world", "text": string}]}',
  ].join('\n')

  const rosterLine = ctx.roster.length
    ? ctx.roster.map((r) => `- ${r.name}${r.occupation ? ` (${r.occupation})` : ''}`).join('\n')
    : '- (nobody else is present)'
  const availableLine = ctx.availableRoster?.length
    ? ctx.availableRoster.map((r) => `- ${r.name}${r.occupation ? ` (${r.occupation})` : ''}`).join('\n')
    : '- (none)'
  const m = ctx.recordedMove
  const recorded = m
    ? `Recorded roll (binding): ${m.moveName} — dice ${m.dice[0]} + ${m.dice[1]} ${m.modifier >= 0 ? '+' : '-'} ${Math.abs(m.modifier)} ${m.stat} = ${m.total}, ${TIER_LABEL[m.tier]}. Outcome: ${m.outcome}`
    : 'Recorded roll: none this turn.'
  const user = [
    ctx.worldDescription?.trim() ? `Setting: ${ctx.worldDescription.trim()}` : '',
    ctx.worldRules?.trim() ? `World rules: ${ctx.worldRules.trim()}` : '',
    ctx.scenario?.trim() ? `Current scenario: ${ctx.scenario.trim()}` : '',
    ctx.gmNotes?.trim() ? `Storyteller-only continuity (do not disclose without an in-story cause): ${ctx.gmNotes.trim()}` : '',
    ctx.canonFacts.length ? `World canon:\n${ctx.canonFacts.map((f) => `- ${f}`).join('\n')}` : '',
    ctx.branchConsequences.length ? `Confirmed consequences in this story branch:\n${ctx.branchConsequences.map((f) => `- ${f}`).join('\n')}` : '',
    `Current scenery: ${ctx.scenery}${ctx.timeOfDay ? ` · ${ctx.timeOfDay}` : ''}`,
    `Characters present (at most ${ctx.maxSpeakers} may act this beat):\n${rosterLine}`,
    `Characters available to enter (add at most one, only if the scene calls for it):\n${availableLine}`,
    `Fork allowed this beat: ${ctx.canFork === false ? 'no — a nearby beat already forked' : 'yes, if a distinct continuing branch is truly needed'}`,
    ctx.loreIndex?.length ? `Callable public lorebook entries:\n${ctx.loreIndex.map((l) => `- ${l.title}`).join('\n')}` : '',
    ctx.transcript.length ? `Recent scene:\n${ctx.transcript.map((t) => `${t.speaker}: ${t.text}`).join('\n')}` : '',
    `${ctx.playerName}'s declared action: ${ctx.playerAction.trim() || '(no action, only waiting)'}`,
    recorded,
    'JSON:',
  ].filter(Boolean).join('\n\n')
  return { system, user }
}

function extractJsonObject(raw: string): Record<string, unknown> | undefined {
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return undefined
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function matchRosterName(name: string, roster: GmRosterEntry[]): GmRosterEntry | undefined {
  const n = name.trim().toLowerCase()
  if (!n) return undefined
  return roster.find((r) => r.name.toLowerCase() === n) ?? roster.find((r) => firstName(r.name) === firstName(n))
}

/** Who acts when the GM gave no usable pick: whoever the player addressed by name, else the first present. */
function defaultSpeakers(ctx: GmContext): string[] {
  const addressed = ctx.roster.find((r) => new RegExp(`\\b${escapeRe(firstName(r.name))}\\b`, 'i').test(ctx.playerAction))
  const pick = addressed ?? ctx.roster[0]
  return pick ? [pick.id] : []
}

function recordedAdjudication(move: RecordedMove): GmAdjudication {
  return {
    action: move.action,
    source: 'recorded_roll',
    moveId: move.moveId,
    moveName: move.moveName,
    tier: move.tier,
    total: move.total,
    rollId: move.id,
    outcome: move.outcome,
  }
}

/** A GM turn built without the model: keeps play moving and still honors a recorded roll. */
export function fallbackGmTurn(ctx: GmContext, reason: string): GmTurn {
  return {
    mode: ctx.campaign.mode,
    ruleset: ctx.campaign.ruleset,
    narration: '',
    pacing: 'linger',
    speakerIds: defaultSpeakers(ctx),
    adjudication: ctx.recordedMove ? recordedAdjudication(ctx.recordedMove) : undefined,
    proposals: [],
    scenery: ctx.scenery,
    fallback: reason,
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/**
 * Validates the model's GM decision against the engine's own state. The model proposes; this
 * function is where the rules win: a recorded roll overrides whatever tier the model narrated,
 * guided mode can't claim a tier at all, mechanical mode without dice can only ask for a roll, and
 * the player's character is never handed to an agent.
 */
export function parseGmTurn(raw: string, ctx: GmContext, newId: () => string = () => crypto.randomUUID()): GmTurn {
  const obj = extractJsonObject(raw)
  if (!obj) return fallbackGmTurn(ctx, 'The GM reply was not valid JSON.')
  const corrections: string[] = []

  let narration = str(obj.narration, 1500)
  // The GM narrates the world, not the player: drop any line that puts words in the player's mouth.
  const playerLine = new RegExp(`^\\s*\\**${escapeRe(firstName(ctx.playerName))}[^:\\n]{0,40}:`, 'i')
  const narrationLines = narration.split('\n')
  if (narrationLines.some((line) => playerLine.test(line))) {
    narration = narrationLines.filter((line) => !playerLine.test(line)).join('\n').trim()
    corrections.push(`Removed narration that spoke for ${ctx.playerName}.`)
  }

  const pacing: GmPacing = obj.pacing === 'advance' || obj.pacing === 'cut' ? obj.pacing : 'linger'

  const requested = Array.isArray(obj.speakers) ? obj.speakers.filter((s): s is string => typeof s === 'string') : []
  const speakerIds: string[] = []
  for (const name of requested) {
    if (isPlayerCharacter(name, ctx.playerName)) {
      corrections.push(`Ignored a request for ${ctx.playerName} to act; the player controls that character.`)
      continue
    }
    const hit = matchRosterName(name, ctx.roster)
    if (hit && !speakerIds.includes(hit.id)) speakerIds.push(hit.id)
  }
  if (speakerIds.length > ctx.maxSpeakers) speakerIds.length = ctx.maxSpeakers
  if (!speakerIds.length && pacing !== 'cut') speakerIds.push(...defaultSpeakers(ctx))

  const requestedAdd = Array.isArray(obj.addCharacters) ? obj.addCharacters.filter((s): s is string => typeof s === 'string') : []
  const addCharacterIds: string[] = []
  for (const name of requestedAdd) {
    if (isPlayerCharacter(name, ctx.playerName)) continue
    const hit = matchRosterName(name, ctx.availableRoster ?? [])
    if (hit && !addCharacterIds.includes(hit.id)) addCharacterIds.push(hit.id)
    if (addCharacterIds.length === 1) break
  }
  const requestedFork = obj.fork && typeof obj.fork === 'object' && !Array.isArray(obj.fork)
    ? obj.fork as Record<string, unknown> : undefined
  const forkTitle = str(requestedFork?.title, 100)
  const forkReason = str(requestedFork?.reason, 300)
  const fork = ctx.canFork !== false && forkTitle && forkReason ? { title: forkTitle, reason: forkReason } : undefined
  const loreCallIds: string[] = []
  for (const title of Array.isArray(obj.loreCalls) ? obj.loreCalls : []) {
    if (typeof title !== 'string') continue
    const hit = ctx.loreIndex?.find((l) => l.title.toLowerCase() === title.trim().toLowerCase())
    if (hit && !loreCallIds.includes(hit.id)) loreCallIds.push(hit.id)
    if (loreCallIds.length === 2) break
  }

  const rawAdj = obj.adjudication && typeof obj.adjudication === 'object' ? obj.adjudication as Record<string, unknown> : undefined
  const claimedTier = rawAdj?.tier === 'strong' || rawAdj?.tier === 'mixed' || rawAdj?.tier === 'miss' ? rawAdj.tier : undefined
  let adjudication: GmAdjudication | undefined
  if (ctx.recordedMove) {
    adjudication = recordedAdjudication(ctx.recordedMove)
    if (claimedTier && claimedTier !== ctx.recordedMove.tier) {
      corrections.push(`The GM narrated a ${claimedTier} result; the recorded ${ctx.recordedMove.tier} result stands.`)
    }
  } else if (rawAdj) {
    const action = str(rawAdj.action, 500) || ctx.playerAction.trim().slice(0, 500)
    const moveName = str(rawAdj.move, 200)
    const move = moveName ? ctx.campaign.moves.find((mv) => mv.name.toLowerCase() === moveName.toLowerCase()) : undefined
    if (ctx.campaign.mode === 'mechanical' && move) {
      adjudication = { action, source: 'roll_needed', moveId: move.id, moveName: move.name, outcome: `Roll ${move.name} (+${move.stat}) to resolve this.` }
      if (claimedTier) corrections.push('No dice were recorded, so the claimed tier was discarded and a roll was requested.')
    } else {
      const outcome = str(rawAdj.outcome, 1000)
      if (outcome) adjudication = { action, source: 'guided_judgment', outcome }
      if (claimedTier) corrections.push(`${ctx.campaign.mode === 'guided' ? 'Guided mode' : 'A ruling without dice'} cannot claim a mechanical tier; it was discarded.`)
    }
  }

  const proposals: GmProposal[] = (Array.isArray(obj.proposals) ? obj.proposals : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({ scope: p.scope === 'world' ? 'world' as const : 'branch' as const, text: str(p.text, 400) }))
    .filter((p) => p.text)
    .slice(0, 3)
    .map((p) => ({ id: newId(), ...p, status: 'pending' as const }))

  return {
    mode: ctx.campaign.mode,
    ruleset: ctx.campaign.ruleset,
    narration,
    pacing,
    speakerIds,
    addCharacterIds: addCharacterIds.length ? addCharacterIds : undefined,
    fork,
    loreCallIds: loreCallIds.length ? loreCallIds : undefined,
    adjudication,
    proposals,
    scenery: ctx.scenery,
    corrections: corrections.length ? corrections : undefined,
  }
}

export function adjudicationLabel(adj: GmAdjudication): string {
  if (adj.source === 'recorded_roll') return `${adj.moveName}: ${adj.tier ? TIER_LABEL[adj.tier] : ''} (${adj.total}, recorded roll)`
  if (adj.source === 'roll_needed') return `${adj.moveName}: roll needed`
  return 'GM judgment (guided, not a rules result)'
}

/** The public text of a GM message — what every character agent and the player sees in the transcript. */
export function formatGmMessage(turn: GmTurn): string {
  const parts = [turn.narration]
  if (turn.adjudication) parts.push(`[${adjudicationLabel(turn.adjudication)}] ${turn.adjudication.outcome}`)
  if (turn.pacing === 'cut') parts.push('[Scene ends]')
  return parts.filter(Boolean).join('\n\n') || '[The GM lets the moment play out.]'
}

/** One-shot steer for a character agent's reply: the GM's public ruling, never anyone's private notes. */
export function gmDirectionFor(turn: GmTurn, speakerName: string, playerName: string): string {
  const lines = [`The Game Master has ruled on this beat. Reply only as ${speakerName}.`]
  if (turn.adjudication?.source === 'recorded_roll') {
    lines.push(`Binding recorded result: ${adjudicationLabel(turn.adjudication)} — ${turn.adjudication.outcome} Do not reroll, change, or soften it.`)
  } else if (turn.adjudication?.source === 'roll_needed') {
    lines.push(`${playerName}'s action is not resolved yet: it needs a ${turn.adjudication.moveName} roll. React without deciding whether it succeeds.`)
  } else if (turn.adjudication) {
    lines.push(`GM ruling: ${turn.adjudication.outcome}`)
  }
  if (turn.pacing === 'advance') lines.push('Move the situation forward.')
  if (turn.pacing === 'cut') lines.push('Bring the scene to a close.')
  lines.push(`Never speak or act for ${playerName}.`)
  return lines.join(' ')
}

/** Consequences the player confirmed on this branch, in story order. Derived from messages, so fork/rewind need no bookkeeping. */
export function branchConsequencesFrom(messages: { gm?: GmTurn }[]): string[] {
  return messages.flatMap((m) => (m.gm?.proposals ?? []).filter((p) => p.status === 'confirmed' && p.scope === 'branch').map((p) => p.text))
}
