import { campaignNeedsTarget, scaleGuidance, type CampaignConfig, type PbtaRoll } from './campaign'
import { describeBands, describeDice, tierLabels } from './customRules'
import { choiceEffectsText, effectsForChoice, effectsForSetEvent, effectsText, parseEffects, PLAYER_HOLDER, type StateChange, type TrackEffect } from './gameState'

/**
 * The game master agent. Separate from the character agents on purpose: the GM paces the scene,
 * decides who acts, adjudicates the player's declared action under the campaign's resolver mode,
 * and proposes lasting changes. It never speaks *as* a carded character — their dialogue comes from
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

/** A server-resolved check stored on the player message that declared it. */
export interface RecordedMove extends PbtaRoll {
  action: string
  /** Keeps the modifier's origin auditable after a sheet changes later. */
  modifierSource?: 'sheet' | 'manual'
  sheetStatId?: string
  /** What this result did to tracked state, per the move's rules (`gameState.ts`). Set by the server with the dice. */
  stateChanges?: StateChange[]
}

export type GmPacing = 'linger' | 'advance' | 'cut'

export interface GmProposal {
  id: string
  /** `branch` stays with this chat branch; `world` becomes shared canon for every chat in the world once confirmed. */
  scope: 'branch' | 'world'
  text: string
  status: 'pending' | 'confirmed' | 'rejected'
  decidedAt?: number
  /** Changes to tracked state this proposal makes. They apply only once the player confirms it. */
  changes?: TrackEffect[]
}

export interface GmAdjudication {
  action: string
  /** Where the outcome came from — shown in the UI so a guided judgment never reads as a rules result. */
  source: 'recorded_roll' | 'guided_judgment' | 'roll_needed' | 'set_event'
  /** The story's set event this beat carried out (`SetEvent`): canon, applied without a roll. */
  setEventId?: string
  moveId?: string
  moveName?: string
  tier?: PbtaRoll['tier']
  degree?: string
  /** Set before rolling for a scene-specific d20 or Fate check. */
  target?: number
  total?: number
  rollId?: string
  /** A question answered from an earlier recorded roll that granted it, so no new dice were due. */
  followUp?: boolean
  /** The recorded outcome asks the player to pick (a cost, an option). Until they do, nobody reacts. */
  awaitingChoice?: string[]
  /** Questions the result grants that the player has not asked yet. Until they do, nobody reacts. */
  awaitingQuestions?: number
  /** The player's pick that completed an earlier roll's outcome (`awaitingChoice`). */
  choice?: string
  outcome: string
}

/**
 * A canon beat of a story: when it happens, it happens as written, with no roll. Set on the story's
 * chat (`Chat.setEvents`) and carried into later scenes.
 */
export interface SetEvent {
  id: string
  /** What happens, in plain terms: "Wren binds the sleeper into Lyra's form". */
  trigger: string
  /** The fixed result, applied without dice. */
  outcome: string
  /** A lasting consequence recorded when it happens, e.g. the strain it costs. */
  consequence?: string
  /** Words that identify the action even when the GM misses it. Each entry must appear in the
   *  player's action; `a|b` accepts either. */
  match?: string[]
  /** What it does to tracked state when it happens. Unset: conditions its consequence names. */
  effects?: TrackEffect[]
}

/** Set events already carried out in this branch. */
export function setEventsDoneFrom(messages: readonly { gm?: GmTurn }[]): string[] {
  return [...new Set(messages.map((m) => m.gm?.adjudication?.setEventId).filter((id): id is string => !!id))]
}

/** The first not-yet-done set event whose words all appear in the player's action. */
export function matchSetEvent(action: string, events: readonly SetEvent[]): SetEvent | undefined {
  return events.find((event) => !!event.match?.length && event.match.every((word) => {
    const options = word.split('|').map((w) => w.trim()).filter(Boolean)
    return options.some((option) => new RegExp(`\\b${escapeRe(option)}`, 'i').test(action))
  }))
}

/** A recorded roll whose outcome is waiting for the player's pick (`pendingChoiceFrom`). */
export interface PendingChoice {
  rollId: string
  moveId?: string
  moveName: string
  tier?: PbtaRoll['tier']
  degree?: string
  total?: number
  outcome: string
  options: string[]
}

/** A recent recorded roll whose result still grants questions the player hasn't asked yet. */
export interface EarlierRoll {
  rollId: string
  moveId?: string
  moveName: string
  tier?: PbtaRoll['tier']
  degree?: string
  total?: number
  outcome: string
  granted: number
  remaining: number
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 }

/** How many questions a move's outcome text grants ("Ask one useful question", "ask 3 questions"). 0 when it grants none. */
export function grantedQuestions(outcome: string): number {
  const m = /\bask\b[^.;\n]{0,100}?\b(\d+|a|an|one|two|three|four|five)\b[^.;\n]{0,100}?(?:\bquestions?\b|\bof the following\b)/i.exec(outcome)
  if (!m) return 0
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()] ?? 0
  return Math.max(0, Math.min(n, 5))
}

/**
 * What a recorded outcome asks the player to choose between ("choose a cost: strain, time, or
 * unwanted attention" gives the four). Undefined when it asks for no choice; an empty list when it
 * asks for one without naming the options in the text.
 */
export function choiceOptions(outcome: string): string[] | undefined {
  const m = /\b(?:choose|pick)\b([^.;\n]*)/i.exec(outcome)
  if (!m) return undefined
  // "They can help and choose what that support looks like": someone else's choice, not the player's.
  const sentence = outcome.slice(Math.max(...['.', ';', '!', '?', '\n'].map((c) => outcome.lastIndexOf(c, m.index))) + 1, m.index)
  if (/^\s*(?:they|he|she|the gm)\b/i.test(sentence)) return undefined
  const colon = m[1].indexOf(':')
  if (colon < 0) return []
  return m[1].slice(colon + 1)
    .split(/,|\bor\b|\//i)
    .map((o) => o.trim().replace(/^(?:or|and|a|an|the)\s+/i, '').trim())
    .filter((o) => o && o.length <= 40)
    .slice(0, 6)
}

/** Where a roll was recorded in the branch: the saved roll itself, or for older stories its GM adjudication. */
function latestRecordedRoll(branch: readonly { gm?: GmTurn; campaignRoll?: RecordedMove }[]): { index: number; adj: GmAdjudication } | undefined {
  let index = -1
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].campaignRoll) { index = i; break }
  }
  if (index < 0) for (let i = branch.length - 1; i >= 0; i--) {
    const adj = branch[i].gm?.adjudication
    if (adj?.source === 'recorded_roll' && !adj.followUp) { index = i; break }
  }
  if (index < 0) return undefined
  const savedRoll = branch[index].campaignRoll
  const adj = savedRoll ? recordedAdjudication(savedRoll) : branch[index].gm?.adjudication
  return adj ? { index, adj } : undefined
}

/**
 * The latest roll, if its outcome asks the player to choose and they have not yet. The player's
 * next message is that choice: it completes the roll rather than starting a new action.
 */
export function pendingChoiceFrom(branch: readonly { gm?: GmTurn; campaignRoll?: RecordedMove }[]): PendingChoice | undefined {
  const found = latestRecordedRoll(branch)
  const rollId = found?.adj.rollId
  if (!found || !rollId) return undefined
  const { index, adj } = found
  const options = choiceOptions(adj.outcome)
  if (!options) return undefined
  const chosen = branch.slice(index + 1).some((message) => message.gm?.adjudication?.rollId === rollId && !!message.gm?.adjudication?.choice)
  if (chosen) return undefined
  return { rollId, moveId: adj.moveId, moveName: adj.moveName ?? 'the earlier roll', tier: adj.tier, degree: adj.degree, total: adj.total, outcome: adj.outcome, options }
}

function looksLikeQuestion(action: string): boolean {
  return action.includes('?') || /\b(?:ask|question|wonder|find out|tell me)\b/i.test(action)
}

/**
 * The latest roll in this scene can grant questions until they are answered. The server record is
 * authoritative; older stories without one can still use their GM adjudication. Follow-up answers
 * are counted by roll id, regardless of how many character replies intervened.
 */
export function earlierRollFrom(branch: readonly { gm?: GmTurn; campaignRoll?: RecordedMove }[]): EarlierRoll | undefined {
  const found = latestRecordedRoll(branch)
  if (!found) return undefined
  const { index, adj } = found
  if (!adj.rollId || adj.tier === 'miss') return undefined
  const granted = grantedQuestions(adj.outcome)
  const used = branch.slice(index + 1).filter((message) => message.gm?.adjudication?.followUp && message.gm.adjudication.rollId === adj.rollId).length
  if (granted - used <= 0) return undefined
  return { rollId: adj.rollId, moveId: adj.moveId, moveName: adj.moveName ?? 'the earlier roll', tier: adj.tier, degree: adj.degree, total: adj.total, outcome: adj.outcome, granted, remaining: granted - used }
}

export interface GmTurn {
  mode: CampaignConfig['mode']
  ruleset: string
  narration: string
  pacing: GmPacing
  /** Character agents to act this beat, in order. Never includes a player-controlled character. */
  speakerIds: string[]
  /** Existing world characters brought into the scene and able to answer this beat. */
  addCharacterIds?: string[]
  /** Characters the player reached from afar (a call, a message, telepathy): they answer this beat from where they are and do not join the scene. */
  remoteIds?: string[]
  /** A new branch the GM decided this beat warrants. `chatId` is filled after the fork is saved. */
  fork?: { title: string; reason: string; chatId?: string }
  /** Public lorebook entries the GM called for the character agents on this beat. */
  loreCallIds?: string[]
  adjudication?: GmAdjudication
  /** Where the fiction moved this beat, if it did (`chat/sceneSetting.ts` replays it on the branch). */
  setting?: { location: string; atmosphere?: string }
  proposals: GmProposal[]
  /** The scenery line the GM was shown, kept for the inspector. */
  scenery: string
  /** Set when the model's output was unusable and a deterministic fallback ran instead. */
  fallback?: string
  /** Engine corrections applied to the model's decision (e.g. a tier that disagreed with the dice). */
  corrections?: string[]
  /** Tracked state this beat changed by rule: the player's pick for a roll, or a set event carried out. */
  stateChanges?: StateChange[]
}

export interface GmRosterEntry {
  id: string
  name: string
  occupation?: string
  /** Standing on the world's rank ladder, from their sheet. */
  rank?: string
}

export interface GmContext {
  campaign: CampaignConfig
  /** The world's own storytelling style for the GM (`WorldCard.promptOverrides`); unset: `GM_STYLE_GUIDANCE`. */
  styleGuidance?: string
  worldName: string
  worldDescription?: string
  worldRules?: string
  gmNotes?: string
  scenario?: string
  storySoFar?: string
  /** The current chapter's name and goal, and what the chapter before it left (`story/chapters.ts` `chapterBriefing`). */
  chapterBriefing?: string
  openThreads?: string[]
  /** What the characters remember (`memory/gmKnowledge.ts`), each line naming who knows it. The GM sees all of it. */
  memoryDigest?: string[]
  /** Who present does not know what (`memory/gmKnowledge.ts`), so no character acts on what they never learned. */
  knowledgeGaps?: string[]
  activeObjective?: string
  canonFacts: string[]
  branchConsequences: string[]
  /** Recent engine-owned results, kept visible after their transcript lines leave context. */
  recentRolls?: string[]
  scenery: string
  /** Where the scene currently is and how it feels, derived from the branch. */
  location?: string
  atmosphere?: string
  timeOfDay?: string
  /** Character agents present — player-controlled characters already removed. */
  roster: GmRosterEntry[]
  /** World characters available to enter, excluding the player's character and current cast. */
  availableRoster?: GmRosterEntry[]
  /** Loaded for this scene, but not yet physically present. */
  loadedRoster?: GmRosterEntry[]
  /** All non-player characters with cards, including ones the GM cannot add to this scene. */
  cardedNames?: string[]
  /** False when a nearby beat already forked this conversation. */
  canFork?: boolean
  loreIndex?: { id: string; title: string }[]
  playerName: string
  /** The player's card, for per-character tracked state. */
  playerId?: string
  /** Tracked state now (`gameState.ts` `stateLines`, GM audience). */
  stateLines?: string[]
  /** The player's standing on the world's rank ladder, from their sheet. */
  playerRank?: string
  transcript: { speaker: string; text: string }[]
  playerAction: string
  recordedMove?: RecordedMove
  /** A recent recorded roll whose granted questions aren't used up yet (`earlierRollFrom`). */
  earlierRoll?: EarlierRoll
  /** A recorded roll still waiting for the player's pick (`pendingChoiceFrom`); this message is that pick. */
  pendingChoice?: PendingChoice
  /** The story's canon beats that have not happened yet in this branch. */
  setEvents?: SetEvent[]
  maxSpeakers: number
}

const TIER_LABEL: Record<PbtaRoll['tier'], string> = { strong: '10+ strong hit', mixed: '7–9 mixed hit', miss: '6- miss' }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Wording for reaching someone who is not here: a call, a message, telepathy, a sending. */
const REACH_OUT = /\b(?:call(?:s|ed|ing)?|reach(?:es|ed|ing)? out|telepath\w*|messag\w*|send(?:s|ing)? (?:word|a message)|sending|contact(?:s|ed|ing)?|summon(?:s|ed|ing)?|signal(?:s|led|ing)? (?:to|for))\b/i
const firstName = (s: string) => s.trim().toLowerCase().split(/[\s,]+/)[0] ?? ''

/** Characters the player controls are never GM-directed agents. Matched by persona name, whole or first-name. */
export function isPlayerCharacter(characterName: string, playerName: string): boolean {
  const a = characterName.trim().toLowerCase()
  const b = playerName.trim().toLowerCase()
  if (!a || !b) return false
  return a === b || firstName(a) === firstName(b)
}

/**
 * How the GM runs a scene: momentum, and who reacts. The part of its prompt a world can tune
 * (`prompt/tunable.ts`); the rules around it (carded characters, the player's agency, binding
 * rolls, knowledge boundaries, the reply format) are not.
 */
export const GM_STYLE_GUIDANCE = [
  'When a scene has paid off, close it or move to a concrete next situation. At a natural pause, bring in one actionable piece of guild life, a consequence, or an established open thread; do not wait for the player to invent every lead. Give the player room to choose what to pursue. Do not manufacture an emergency or reveal a future secret just to create momentum.',
  'When the player commits the group to a course of action (an assault, a chase, a plan put in motion), resolve it forward: narrate what the opposing NPCs and the world do in response, and where things now stand. Each beat should change the situation; do not hold a confrontation at "about to" or "on the verge" for another beat. Refer to the player\'s companions as "the group", never by name.',
  'Choose speakers so the people present can play off each other. Agents speak in the order you list them, and each hears everyone before it this beat, so put a reaction after whatever provokes it. Characters may answer one another, not only the player. Pick only the ones who would genuinely respond; a quiet character can sit a beat out. In action, or once the player has given orders, list only the one or two whose part matters this beat.',
].join('\n')

/** The binding line the GM receives for a recorded roll, exactly as it reads in the prompt. */
export function recordedRollLine(m: RecordedMove | undefined): string {
  return m
    ? m.resolver === 'custom'
      ? `Recorded roll (binding): ${m.moveName} — ${m.detail ?? `dice ${m.dice.join(', ')}, result ${m.total}`}; ${m.degree ?? m.tier} (tier: ${m.tier}). Outcome: ${m.outcome}`
      : m.resolver && m.resolver !== 'pbta'
      ? `Recorded roll (binding): ${m.moveName} — dice ${m.dice.join(', ')}; sheet value ${m.modifier} ${m.stat}; total ${m.total}${m.target !== undefined ? ` vs target ${m.target}` : ''}; ${m.degree ?? TIER_LABEL[m.tier]}. Outcome: ${m.outcome}`
      : `Recorded roll (binding): ${m.moveName} — dice ${m.dice[0]} + ${m.dice[1]} ${m.modifier >= 0 ? '+' : '-'} ${Math.abs(m.modifier)} ${m.stat} = ${m.total}, ${TIER_LABEL[m.tier]}. Outcome: ${m.outcome}`
    : 'Recorded roll: none this turn.'
}

export function buildGmPrompt(ctx: GmContext): { system: string; user: string } {
  const { campaign } = ctx
  const maxArrivals = Math.min(2, ctx.maxSpeakers)
  const modeLines = campaign.mode === 'mechanical'
    ? [
        `Resolution mode: MECHANICAL (${campaign.resolver.toUpperCase()} resolver).`,
        'A recorded roll is binding. In adjudication, copy its move, tier, and outcome exactly; use narration to describe how that result looks in the fiction. Never reroll, change the total, or soften a failed check.',
        'A miss can have creative consequences, including a new problem or scene change, but it cannot grant the attempted success unless the recorded miss outcome explicitly says so. Put lasting changes in proposals for the player to confirm.',
        'If the player declares an action that triggers a move and no roll is recorded, set "move" to that move name and leave "tier" null: the player must roll before it resolves.',
        campaignNeedsTarget(campaign)
          ? 'When requesting a roll, set adjudication.target to the difficulty or opposition before the player rolls, unless the move has a fixed target. Choose it from the situation and the ruleset; do not change it after the roll.' : '',
        'You may not invent dice, totals, or resources.',
      ]
    : [
        'Resolution mode: GUIDED. The ruleset informs tone and likely consequences only.',
        'Adjudicate with judgment: say plainly what happens because of the declared action. Never claim a die roll, total, or tier.',
      ]
  // A world's own ruleset: how its dice work and which tier each outcome counts as, so the GM can
  // copy a recorded result's tier exactly.
  const custom = campaign.resolver === 'custom' ? campaign.custom : undefined
  const customLines = custom && campaign.mode === 'mechanical'
    ? [`This world's own dice: ${describeDice(custom.dice)}`, 'Outcomes (each counts as the tier in brackets):', ...describeBands(custom).map((line) => `- ${line}`)]
    : []
  const tierNames = custom ? tierLabels(custom) : undefined
  const moveLines = campaign.moves.length
    ? ['Moves:', ...campaign.moves.map((m) => campaign.resolver === 'pbta'
      ? `- ${m.name} (+${m.stat || 'modifier'}): when ${m.trigger}. 10+: ${m.strong} 7–9: ${m.mixed} 6-: ${m.miss}`
      : tierNames
        ? `- ${m.name} (${m.stat || 'sheet value'}): when ${m.trigger}. ${tierNames.strong} (strong): ${m.strong} ${tierNames.mixed} (mixed): ${m.mixed} ${tierNames.miss} (miss): ${m.miss}${m.target !== undefined ? ` Fixed difficulty: ${m.target}.` : ''}`
        : `- ${m.name} (${m.stat || 'sheet value'}): when ${m.trigger}. Success: ${m.strong} Tie: ${m.mixed} Failure: ${m.miss}${m.target !== undefined ? ` Fixed target: ${m.target}.` : ''}`)]
    : []
  const system = [
    `You are the GAME MASTER for a ${campaign.ruleset}${campaign.edition ? ` (${campaign.edition})` : ''} story in the setting "${ctx.worldName}".`,
    'You run the scene and NPCs without character cards. Every listed present or available character has a card and is played by a separate agent, even when you do not choose them to speak this beat.',
    'Never write a carded character’s dialogue, actions, gestures, thoughts, feelings, entrance, or reaction in narration or adjudication. Do not preview or paraphrase their reply. Put present carded characters who should respond in speakers; their agents will write their own turns. Narration is only for scenery, uncarded NPCs, and immediate observable effects of the player’s action. Keep carded character names out of narration. For example: "Rain strikes the windows. The barkeep says the bridge is closed."',
    `${ctx.playerName} is the player's character. Never write ${ctx.playerName}'s dialogue, voluntary actions, choices, thoughts, feelings, or discoveries, and never pick ${ctx.playerName} to act.`,
    ...modeLines,
    ...customLines,
    ...moveLines,
    scaleGuidance(campaign),
    'Your job each beat: (1) adjudicate the player\'s declared action without deciding any carded character’s response, (2) narrate the immediate, observable result in 1-3 sentences of present-tense prose, (3) choose which present characters react and in what order, (4) choose pacing, (5) propose lasting changes only when something durable really happened.',
    ctx.styleGuidance?.trim() || GM_STYLE_GUIDANCE,
    `You may add up to ${maxArrivals} available characters to the scene when their entrance follows naturally from the fiction, including when the player calls, summons, or reaches out to them by any means the setting allows. Characters loaded for this scene are expected arrivals, but are not physically present until they enter. If two arrive together, add both in the same beat. Each added character responds this beat: list them in speakers too. Never add the player character.`,
    'When the player reaches someone who is not here without bringing them here (a call, a message, telepathy, a sending), put that character in "remote" instead: they answer this beat from where they are and do not join the scene. Never write their reply yourself; their own agent answers.',
    'Fork only when a consequential choice or simultaneous story thread deserves its own continuing branch. A scene change, quiet beat, or new arrival alone does not warrant a fork. Give a brief reason and a useful branch title. Otherwise use null.',
    'You may call up to two listed public lorebook entries by title when their facts matter to this beat. Each called entry will be supplied to the character agents. Do not call unrelated entries just to fill context.',
    'Storyteller-only notes may describe secrets or planned arcs. Respect each character’s knowledge boundary: do not reveal, foreshadow as certain, or make a character act on information they have not learned in the story.',
    'Established conditions are true when the player checks them, even if the outline expected their discovery later. On a successful investigation, give truthful, actionable evidence within the declared scope; never conceal it to preserve a planned reveal. If a recorded result grants questions, answer the player’s questions from that result without demanding another roll: set adjudication.followUp to true, name the earlier move, and put the answer in adjudication.outcome. A follow-up question never needs new dice. Describe what the character can observe, not their private interpretation or next choice.',
    'Set events are canon beats of this story. When the player\'s action carries one out, it happens exactly as written: do not request a roll or name a move; set adjudication.setEvent to its id and narrate its outcome. Never trigger a set event the player has not attempted.',
    'When a recorded result grants questions, the roll is not resolved until the player asks them: on the roll beat, narrate only what the result settles (including any complication it names), invite the question, do not answer anything yet, and list no speakers. While granted questions remain, answer each one and again list no speakers.',
    'When a recorded result asks the player to choose (a cost, a complication, an option), the roll is not resolved until they do. Narrate only what the result has already settled, never pick for them, end by asking them to choose, and list no speakers: nobody reacts until the choice is made. When the player then makes that choice, apply it from the earlier roll: set adjudication.followUp to true, adjudication.choice to their pick, name the earlier move, put what the choice costs in the fiction in adjudication.outcome, and do not request a roll.',
    'When the player\'s declared action or the fiction moves the group somewhere new, set "setting" to where the scene now is: a short place name, plus its atmosphere if that matters. A character arriving is not a move. Otherwise use null.',
    'Pacing: "linger" keeps the moment open, "advance" moves the situation forward, "cut" ends the scene.',
    'Proposals are suggestions the player must confirm. Use scope "branch" for consequences of this story branch and "world" only for setting facts every story in this world should inherit.',
    ...(campaign.tracks?.length ? [
      'Tracked state (resources, conditions, clocks, items) is kept by the engine, not by you. A recorded result, the player\'s choice for it, and a set event apply their own changes: describe what they cost in the fiction, and never state a different value. For any other lasting change to tracked state, add a proposal with "change" written as "Track +1", "Track -1", "Track = 2", "Track on", "Track off", "Track + item" or "Track - item", ending "for Name" for a per-character track; it applies only when the player confirms it. When a clock is full, what it counts toward happens now.',
    ] : []),
    'Rumors and beliefs are not facts. A remembered line tagged "claim" is only what someone said, and "belief" only what someone thinks; "unverified" means nobody has ruled on it, "true" or "FALSE" is the player\'s ruling. Never narrate a claim or belief as true unless it is ruled true. Characters who heard a FALSE claim still believe it until they learn otherwise in play; let them act on it, but the world does not bend to it. Never put an unconfirmed claim or a belief in a "world" proposal.',
    'Reply with one JSON object and nothing else:',
    `{"narration": string, "pacing": "linger"|"advance"|"cut", "speakers": [present or arriving character names], "addCharacters": [up to ${maxArrivals} available character names], "remote": [at most one available character reached from afar], "fork": {"title": string, "reason": string}|null, "setting": {"location": string, "atmosphere": string|null}|null, "loreCalls": [up to two listed lore titles], "adjudication": {"action": string, "move": string|null, "target": number|null, "tier": "strong"|"mixed"|"miss"|null, "followUp": boolean, "choice": string|null, "setEvent": string|null, "outcome": string} | null, "proposals": [{"scope": "branch"|"world", "text": string${campaign.tracks?.length ? ', "change": string|null' : ''}}]}`,
  ].join('\n')

  const describe = (r: GmRosterEntry) => `- ${r.name}${[r.rank && `rank: ${r.rank}`, r.occupation].filter(Boolean).length ? ` (${[r.rank && `rank: ${r.rank}`, r.occupation].filter(Boolean).join('; ')})` : ''}`
  const rosterLine = ctx.roster.length ? ctx.roster.map(describe).join('\n') : '- (nobody else is present)'
  const availableLine = ctx.availableRoster?.length ? ctx.availableRoster.map(describe).join('\n') : '- (none)'
  const m = ctx.recordedMove
  const recorded = recordedRollLine(m)
  const people = gmPeople(ctx)
  const rollChanges = m?.stateChanges?.length ? `This result's tracked-state changes, already applied: ${effectsText(m.stateChanges, campaign.tracks, people)}.` : ''
  const earlier = ctx.earlierRoll
    ? `Earlier roll still in effect: ${ctx.earlierRoll.moveName} (${ctx.earlierRoll.total ?? '?'}${ctx.earlierRoll.tier ? `, ${TIER_LABEL[ctx.earlierRoll.tier]}` : ''}). It granted: ${ctx.earlierRoll.outcome} Questions left: ${ctx.earlierRoll.remaining}. If the player asks about this result, answer one question now as a follow-up (adjudication.followUp true) and do not request a roll. If several questions are asked together, answer the first and leave the others for later turns.`
    : ''
  const pending = ctx.pendingChoice
    ? `Waiting on the player's choice from ${ctx.pendingChoice.moveName} (${ctx.pendingChoice.total ?? '?'}${ctx.pendingChoice.tier ? `, ${TIER_LABEL[ctx.pendingChoice.tier]}` : ''}): ${ctx.pendingChoice.outcome}${ctx.pendingChoice.options.length ? ` Options: ${ctx.pendingChoice.options.join(', ')}.` : ''} The player's declared action below is that choice. Apply it as a follow-up to the earlier roll (adjudication.followUp true, adjudication.choice set) and do not request a roll.`
    : ''
  const choiceMove = ctx.pendingChoice ? campaign.moves.find((mv) => mv.id === ctx.pendingChoice!.moveId) : undefined
  const choiceCosts = choiceMove?.choiceEffects?.length && campaign.tracks?.length
    ? `What each option does to tracked state (the engine applies it): ${choiceEffectsText(choiceMove.choiceEffects, campaign.tracks)}.` : ''
  const user = [
    ctx.worldDescription?.trim() ? `Setting: ${ctx.worldDescription.trim()}` : '',
    ctx.worldRules?.trim() ? `World rules: ${ctx.worldRules.trim()}` : '',
    ctx.scenario?.trim() ? `Current scenario: ${ctx.scenario.trim()}` : '',
    ctx.gmNotes?.trim() ? `Storyteller-only continuity (do not disclose without an in-story cause): ${ctx.gmNotes.trim()}` : '',
    ctx.storySoFar?.trim() ? `Story so far: ${ctx.storySoFar.trim()}` : '',
    ctx.chapterBriefing?.trim() ? `${ctx.chapterBriefing.trim()}\nSteer the scene toward the chapter's goal when the fiction allows, without forcing it or deciding for the player.` : '',
    ctx.openThreads?.length ? `Open threads:\n${ctx.openThreads.map((t) => `- ${t}`).join('\n')}` : '',
    ctx.memoryDigest?.length ? `What the characters remember (and who knows it):\n${ctx.memoryDigest.join('\n')}` : '',
    ctx.knowledgeGaps?.length ? `Knowledge boundaries in this scene. These characters have not learned these things; do not narrate them knowing it, and let them find out only in play:\n${ctx.knowledgeGaps.map((g) => `- ${g}`).join('\n')}` : '',
    ctx.activeObjective?.trim() ? `Current objective: ${ctx.activeObjective.trim()}` : '',
    ctx.canonFacts.length ? `World canon:\n${ctx.canonFacts.map((f) => `- ${f}`).join('\n')}` : '',
    ctx.branchConsequences.length ? `Confirmed consequences in this story branch:\n${ctx.branchConsequences.map((f) => `- ${f}`).join('\n')}` : '',
    ctx.recentRolls?.length ? `Earlier recorded checks in this scene (binding):\n${ctx.recentRolls.map((roll) => `- ${roll}`).join('\n')}` : '',
    campaign.tracks?.length ? `Tracked state now (kept by the engine):\n${ctx.stateLines?.length ? ctx.stateLines.map((line) => `- ${line}`).join('\n') : '- (nothing tracked has changed yet)'}` : '',
    ctx.location ? `Current location: ${ctx.location}${ctx.atmosphere ? ` (${ctx.atmosphere})` : ''}` : '',
    `Current scenery: ${ctx.scenery}${ctx.timeOfDay ? ` · ${ctx.timeOfDay}` : ''}`,
    `Characters present (at most ${ctx.maxSpeakers} may act this beat):\n${rosterLine}`,
    ctx.loadedRoster?.length ? `Loaded for this scene but still awaited: ${ctx.loadedRoster.map((r) => r.name).join(', ')}. They can enter together when the scene reaches them.` : '',
    `Characters available to enter (add at most ${maxArrivals}, only if the scene calls for it):\n${availableLine}`,
    ctx.cardedNames?.length ? `All carded characters (never portray them in GM prose): ${ctx.cardedNames.join(', ')}` : '',
    `Fork allowed this beat: ${ctx.canFork === false ? 'no — a nearby beat already forked' : 'yes, if a distinct continuing branch is truly needed'}`,
    ctx.loreIndex?.length ? `Callable public lorebook entries:\n${ctx.loreIndex.map((l) => `- ${l.title}`).join('\n')}` : '',
    ctx.transcript.length ? `Recent scene:\n${ctx.transcript.map((t) => `${t.speaker}: ${t.text}`).join('\n')}` : '',
    ctx.playerRank ? `${ctx.playerName}'s rank: ${ctx.playerRank}` : '',
    `${ctx.playerName}'s declared action: ${ctx.playerAction.trim() || '(no action, only waiting)'}`,
    recorded,
    rollChanges,
    earlier,
    pending,
    choiceCosts,
    ctx.setEvents?.length ? `Set events still to come (canon; when the player carries one out, it happens as written with no roll):\n${ctx.setEvents.map((e) => `- [${e.id}] ${e.trigger} → ${e.outcome}${e.consequence ? ` (${e.consequence})` : ''}${e.effects?.length && campaign.tracks?.length ? ` [tracked: ${effectsText(e.effects, campaign.tracks, people)}]` : ''}`).join('\n')}` : '',
    'JSON:',
  ].filter(Boolean).join('\n\n')
  return { system, user }
}

/** Everyone the GM can name in a tracked-state change: the cast, who could arrive, and the player. */
function gmPeople(ctx: GmContext): { id: string; name: string }[] {
  return [...ctx.roster, ...(ctx.availableRoster ?? []), { id: ctx.playerId ?? PLAYER_HOLDER, name: ctx.playerName }]
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
    degree: move.degree,
    target: move.target,
    total: move.total,
    rollId: move.id,
    outcome: move.outcome,
  }
}

/** A GM turn built without the model: keeps play moving and still honors a recorded roll. */
export function fallbackGmTurn(ctx: GmContext, reason: string): GmTurn {
  const unresolved = ctx.campaign.mode === 'mechanical' && !ctx.recordedMove
  return {
    mode: ctx.campaign.mode,
    ruleset: ctx.campaign.ruleset,
    narration: unresolved ? 'The Game Master could not rule on this action. Retry the ruling or withdraw the action.' : '',
    pacing: 'linger',
    speakerIds: unresolved ? [] : defaultSpeakers(ctx),
    adjudication: ctx.recordedMove ? recordedAdjudication(ctx.recordedMove) : undefined,
    proposals: [],
    scenery: ctx.scenery,
    fallback: reason,
  }
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/**
 * Drops only the sentences that name a carded character. Their agents own what they do, but the
 * rest of the GM's word (the world, the opposition, where things stand) still has to reach the
 * scene, or the beat never moves.
 */
function withoutSentencesNaming(text: string, namedCardIn: (text: string) => string | undefined): string {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["”’)\]]*|$)\s*/g) ?? [text]
  return sentences.filter((sentence) => !namedCardIn(sentence)).join('').trim()
}

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
  const stateChanges: StateChange[] = []

  let narration = str(obj.narration, 1500)
  // The GM narrates the world, not the player: drop any line that puts words in the player's mouth.
  const playerLine = new RegExp(`^\\s*\\**${escapeRe(firstName(ctx.playerName))}[^:\\n]{0,40}:`, 'i')
  const narrationLines = narration.split('\n')
  if (narrationLines.some((line) => playerLine.test(line))) {
    narration = narrationLines.filter((line) => !playerLine.test(line)).join('\n').trim()
    corrections.push(`Removed narration that spoke for ${ctx.playerName}.`)
  }
  // A carded character's own agent owns their turn. If the GM names one in narration,
  // discard that narration rather than risk presenting a second, conflicting turn.
  const cardedNames = ctx.cardedNames ?? [...ctx.roster, ...(ctx.availableRoster ?? [])].map((card) => card.name)
  const namedCardIn = (text: string) => cardedNames.find((card) =>
    [card, firstName(card)].some((name) => name && new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(text)))
  const namedCard = namedCardIn(narration)
  // Whom the GM tried to voice itself: if they are away and the player reached them, they answer for themselves.
  const rawAdjText = obj.adjudication && typeof obj.adjudication === 'object' ? str((obj.adjudication as Record<string, unknown>).outcome, 1000) : ''
  const gmVoiced = [namedCard, namedCardIn(rawAdjText)].filter((name): name is string => !!name)
  if (namedCard) {
    narration = withoutSentencesNaming(narration, namedCardIn)
    corrections.push(`Removed GM narration involving ${namedCard}; the character agent owns that turn.`)
  }

  const pacing: GmPacing = obj.pacing === 'advance' || obj.pacing === 'cut' ? obj.pacing : 'linger'

  const requestedAdd = Array.isArray(obj.addCharacters) ? obj.addCharacters.filter((s): s is string => typeof s === 'string') : []
  const addCharacterIds: string[] = []
  for (const name of requestedAdd) {
    if (isPlayerCharacter(name, ctx.playerName)) continue
    const hit = matchRosterName(name, ctx.availableRoster ?? [])
    if (hit && !addCharacterIds.includes(hit.id)) addCharacterIds.push(hit.id)
    if (addCharacterIds.length === Math.min(2, ctx.maxSpeakers)) break
  }

  const requestedRemote = Array.isArray(obj.remote) ? obj.remote.filter((s): s is string => typeof s === 'string') : []
  const remoteIds: string[] = []
  for (const name of requestedRemote) {
    if (isPlayerCharacter(name, ctx.playerName)) continue
    const hit = matchRosterName(name, ctx.availableRoster ?? [])
    if (hit && !addCharacterIds.includes(hit.id) && !remoteIds.includes(hit.id)) remoteIds.push(hit.id)
    if (remoteIds.length === 1) break
  }
  if (!remoteIds.length) {
    // The player reached someone who is not here, by name. If the GM neither brought them in nor let
    // them answer (or tried to answer for them), their own agent replies from where they are.
    const reachAt = [...ctx.playerAction.matchAll(new RegExp(REACH_OUT.source, 'gi'))].map((m) => m.index ?? 0)
    const reached = (ctx.availableRoster ?? [])
      .filter((r) => !isPlayerCharacter(r.name, ctx.playerName) && !addCharacterIds.includes(r.id))
      .map((r) => ({ r, at: ctx.playerAction.search(new RegExp(`\\b(?:${escapeRe(r.name)}|${escapeRe(firstName(r.name))})\\b`, 'i')) }))
      // Reached means the reaching comes shortly before the name in the same sentence ("reaches out
      // to Seraphine"), not a stray "call" elsewhere; or the GM already tried to speak for them.
      .filter((hit) => hit.at >= 0 && (reachAt.some((at) => hit.at - at >= 0 && hit.at - at <= 80 && !/[.!?\n]/.test(ctx.playerAction.slice(at, hit.at))) || gmVoiced.includes(hit.r.name)))
      .sort((a, b) => a.at - b.at)[0]?.r
    if (reached) {
      remoteIds.push(reached.id)
      corrections.push(`${reached.name} answers from where they are: the player reached them from afar, and only their own agent can reply.`)
    }
  }

  // An arrival answers in the beat that brings them in; waiting a beat left calls unanswered.
  const added = (ctx.availableRoster ?? []).filter((r) => addCharacterIds.includes(r.id))
  const requested = Array.isArray(obj.speakers) ? obj.speakers.filter((s): s is string => typeof s === 'string') : []
  const speakerIds: string[] = []
  for (const name of requested) {
    if (isPlayerCharacter(name, ctx.playerName)) {
      corrections.push(`Ignored a request for ${ctx.playerName} to act; the player controls that character.`)
      continue
    }
    const hit = matchRosterName(name, [...ctx.roster, ...added])
    if (hit && !speakerIds.includes(hit.id)) speakerIds.push(hit.id)
  }
  for (const entrant of added) if (!speakerIds.includes(entrant.id)) speakerIds.push(entrant.id)
  // Whoever was reached answers first; the people here react after.
  speakerIds.unshift(...remoteIds.filter((id) => !speakerIds.includes(id)))
  if (!speakerIds.length && pacing !== 'cut') speakerIds.push(...defaultSpeakers(ctx))
  if (!speakerIds.length && pacing !== 'cut' && !addCharacterIds.length) {
    // Nobody is here, but the player spoke to someone who could join (a call, a shout, a summons).
    // The first one named is the one being reached ("call Mae… bring Avi" reaches Mae).
    const called = (ctx.availableRoster ?? [])
      .filter((r) => !isPlayerCharacter(r.name, ctx.playerName))
      .map((r) => ({ r, at: ctx.playerAction.search(new RegExp(`\\b${escapeRe(firstName(r.name))}\\b`, 'i')) }))
      .filter((hit) => hit.at >= 0)
      .sort((a, b) => a.at - b.at)[0]?.r
    if (called) {
      addCharacterIds.push(called.id)
      speakerIds.push(called.id)
      corrections.push(`Brought in ${called.name}: the player addressed them and nobody else was here to answer.`)
    }
  }
  // Reserve response slots for arrivals even if the GM listed too many present speakers first.
  for (let i = speakerIds.length - 1; speakerIds.length > ctx.maxSpeakers && i >= 0; i--) {
    if (!addCharacterIds.includes(speakerIds[i]) && !remoteIds.includes(speakerIds[i])) speakerIds.splice(i, 1)
  }
  if (speakerIds.length > ctx.maxSpeakers) speakerIds.length = ctx.maxSpeakers
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
    const options = choiceOptions(adjudication.outcome)
    if (options) adjudication.awaitingChoice = options
    const questions = adjudication.tier === 'miss' ? 0 : grantedQuestions(adjudication.outcome)
    if (questions > 0) adjudication.awaitingQuestions = questions
  } else if (ctx.pendingChoice) {
    // This message is the player's pick for the earlier roll: it completes that roll, no new dice.
    const p = ctx.pendingChoice
    const picked = p.options
      .map((option) => ({ option, at: ctx.playerAction.search(new RegExp(`\\b${escapeRe(option)}\\b`, 'i')) }))
      .filter((hit) => hit.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((hit) => hit.option)
    const choice = picked.join(', ') || str(rawAdj?.choice, 200) || ctx.playerAction.trim().replace(/^\[|\]$/g, '').slice(0, 200)
    const proposed = str(rawAdj?.outcome, 1000)
    const outcome = proposed && proposed !== p.outcome && !/^(?:roll\b|make (?:a|another) roll\b|a roll is needed\b)/i.test(proposed)
      ? proposed : `Chosen: ${choice}.`
    if (rawAdj && rawAdj.followUp !== true) corrections.push(`Recorded the choice for the earlier ${p.moveName} roll instead of asking for a new one.`)
    // The pick's cost is the move's rule, not the model's prose.
    stateChanges.push(...effectsForChoice(ctx.campaign.moves.find((mv) => mv.id === p.moveId), picked.length ? picked : [choice], p.rollId, ctx.playerId))
    adjudication = {
      action: ctx.playerAction.trim().slice(0, 500),
      source: 'recorded_roll',
      followUp: true,
      choice,
      moveId: p.moveId,
      moveName: p.moveName,
      tier: p.tier,
      degree: p.degree,
      total: p.total,
      rollId: p.rollId,
      outcome,
    }
  } else if (ctx.setEvents?.length && (
    ctx.setEvents.find((e) => e.id === str(rawAdj?.setEvent, 100)) || matchSetEvent(ctx.playerAction, ctx.setEvents)
  )) {
    // A canon beat: it happens as written. A roll the GM asked for is overruled.
    const event = ctx.setEvents.find((e) => e.id === str(rawAdj?.setEvent, 100)) ?? matchSetEvent(ctx.playerAction, ctx.setEvents)!
    if (str(rawAdj?.setEvent, 100) !== event.id) corrections.push(`Carried out the story's set event "${event.trigger}" without a roll.`)
    adjudication = { action: ctx.playerAction.trim().slice(0, 500), source: 'set_event', setEventId: event.id, outcome: event.outcome }
    stateChanges.push(...effectsForSetEvent(event, ctx.campaign.tracks, gmPeople(ctx), ctx.playerId))
  } else if (ctx.earlierRoll && (rawAdj?.followUp === true || looksLikeQuestion(ctx.playerAction) || (
    str(rawAdj?.move, 200).toLowerCase() === ctx.earlierRoll.moveName.toLowerCase() && !!claimedTier && claimedTier === ctx.earlierRoll.tier
  ))) {
    // A question the earlier roll already paid for: answered from that result, no new dice.
    const e = ctx.earlierRoll
    const proposedAnswer = str(rawAdj?.outcome, 1000)
    const answer = /^(?:roll\b|make (?:a|another) roll\b|a roll is needed\b)/i.test(proposedAnswer) || proposedAnswer === e.outcome
      ? narration : proposedAnswer || narration
    if (!answer) return fallbackGmTurn(ctx, `The GM did not answer a question earned by ${e.moveName}; retry without rolling.`)
    if (rawAdj?.followUp !== true) corrections.push(`Answered from the earlier ${e.moveName} roll instead of asking for a new one.`)
    adjudication = {
      action: str(rawAdj?.action, 500) || ctx.playerAction.trim().slice(0, 500),
      source: 'recorded_roll',
      followUp: true,
      moveId: e.moveId,
      moveName: e.moveName,
      tier: e.tier,
      degree: e.degree,
      total: e.total,
      rollId: e.rollId,
      outcome: answer,
    }
    // The scene waits until every granted question is asked, unless the player moves on.
    if (e.remaining > 1) adjudication.awaitingQuestions = e.remaining - 1
    if (answer === narration) narration = ''
  } else if (rawAdj) {
    const action = str(rawAdj.action, 500) || ctx.playerAction.trim().slice(0, 500)
    const moveName = str(rawAdj.move, 200)
    const move = moveName ? ctx.campaign.moves.find((mv) => mv.name.toLowerCase() === moveName.toLowerCase()) : undefined
    if (ctx.campaign.mode === 'mechanical' && moveName && !move) {
      return fallbackGmTurn(ctx, `The GM named an unknown move: ${moveName}.`)
    }
    if (ctx.campaign.mode === 'mechanical' && move) {
      const rawTarget = rawAdj.target
      const target = !campaignNeedsTarget(ctx.campaign) ? undefined
        : move.target ?? (Number.isInteger(rawTarget) && (rawTarget as number) >= -30 && (rawTarget as number) <= 100 ? rawTarget as number : undefined)
      if (campaignNeedsTarget(ctx.campaign) && target === undefined) {
        return fallbackGmTurn(ctx, `The GM requested ${move.name} without setting a difficulty.`)
      }
      adjudication = { action: ctx.playerAction.trim().slice(0, 500), source: 'roll_needed', moveId: move.id, moveName: move.name, ...(target !== undefined ? { target } : {}), outcome: `Roll ${move.name}${target !== undefined ? ` vs ${target}` : ''} to resolve this.` }
      if (claimedTier) corrections.push('No dice were recorded, so the claimed tier was discarded and a roll was requested.')
    } else {
      if (ctx.campaign.mode === 'mechanical' && claimedTier) return fallbackGmTurn(ctx, 'The GM claimed a mechanical result without a recorded roll.')
      const outcome = str(rawAdj.outcome, 1000)
      if (outcome) adjudication = { action, source: 'guided_judgment', outcome }
      if (claimedTier) corrections.push(`${ctx.campaign.mode === 'guided' ? 'Guided mode' : 'A ruling without dice'} cannot claim a mechanical tier; it was discarded.`)
    }
  }
  if (adjudication?.awaitingChoice || adjudication?.awaitingQuestions) {
    // The roll is not resolved until the player picks or asks: nobody reacts to half a result.
    if (speakerIds.length || addCharacterIds.length) corrections.push(`Held character replies until the player ${adjudication.awaitingChoice ? 'makes the choice' : 'asks the questions'} this result grants.`)
    speakerIds.length = 0
    addCharacterIds.length = 0
    remoteIds.length = 0
  }
  if (adjudication?.source === 'guided_judgment') {
    const namedInRuling = namedCardIn(adjudication.outcome)
    if (namedInRuling) {
      const outcome = withoutSentencesNaming(adjudication.outcome, namedCardIn)
      adjudication = outcome ? { ...adjudication, outcome } : undefined
      corrections.push(`Removed a GM judgment involving ${namedInRuling}; the character agent owns that response.`)
    }
  }
  if (adjudication?.source === 'roll_needed') {
    // A requested move is a gate, not a beat: none of the model's fictional result is established.
    return {
      mode: ctx.campaign.mode,
      ruleset: ctx.campaign.ruleset,
      narration: '',
      pacing: 'linger',
      speakerIds: [],
      adjudication,
      proposals: [],
      scenery: ctx.scenery,
      corrections: corrections.length ? corrections : undefined,
    }
  }

  const rawSetting = obj.setting && typeof obj.setting === 'object' && !Array.isArray(obj.setting) ? obj.setting as Record<string, unknown> : undefined
  const settingLocation = str(rawSetting?.location, 120)
  const settingAtmosphere = str(rawSetting?.atmosphere, 300)
  const setting = settingLocation && settingLocation.toLowerCase() !== (ctx.location ?? '').trim().toLowerCase()
    ? { location: settingLocation, ...(settingAtmosphere ? { atmosphere: settingAtmosphere } : {}) }
    : undefined

  const proposals: GmProposal[] = (Array.isArray(obj.proposals) ? obj.proposals : [])
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({ scope: p.scope === 'world' ? 'world' as const : 'branch' as const, text: str(p.text, 400), change: str(p.change, 300) }))
    .filter((p) => p.text)
    .slice(0, 3)
    .map(({ change, ...p }) => {
      // A proposed state change is read by the engine's own syntax; what it can't read is dropped, never guessed.
      const parsed = change && ctx.campaign.tracks?.length ? parseEffects(change, ctx.campaign.tracks, gmPeople(ctx)) : undefined
      if (parsed?.errors.length) corrections.push(`Dropped a proposed state change the engine could not read: "${change}".`)
      const changes = parsed && !parsed.errors.length && parsed.effects.length
        ? parsed.effects.map((effect) => (effect.who || !ctx.playerId ? effect : { ...effect, who: ctx.playerId }))
        : undefined
      // Tracked state belongs to this story branch, never to world canon.
      return { id: newId(), ...p, ...(changes ? { scope: 'branch' as const, changes } : {}), status: 'pending' as GmProposal['status'] }
    })
  const setEvent = adjudication?.setEventId ? ctx.setEvents?.find((e) => e.id === adjudication!.setEventId) : undefined
  // A set event's consequence is canon for this branch the moment it happens; nobody needs to confirm it.
  if (setEvent?.consequence) proposals.unshift({ id: newId(), scope: 'branch', text: setEvent.consequence, status: 'confirmed', decidedAt: Date.now() })

  if (ctx.recordedMove && (claimedTier !== ctx.recordedMove.tier
    || str(rawAdj?.move, 200).toLowerCase() !== ctx.recordedMove.moveName.toLowerCase()
    || (typeof rawAdj?.outcome !== 'string' || rawAdj.outcome.trim() !== ctx.recordedMove.outcome.trim()))) {
    // A reply that cannot repeat the recorded ruling cannot establish new fiction. This applies
    // to every tier: an invented strong hit on a mixed roll was previously allowed to move the
    // scene and propose canon even though the adjudication badge showed the correct result.
    corrections.push('The GM did not confirm the recorded move and outcome; its fictional changes were discarded.')
    return {
      mode: ctx.campaign.mode,
      ruleset: ctx.campaign.ruleset,
      narration: '',
      pacing: 'linger',
      speakerIds,
      loreCallIds: loreCallIds.length ? loreCallIds : undefined,
      adjudication,
      proposals: [],
      scenery: ctx.scenery,
      corrections: corrections.length ? corrections : undefined,
    }
  }

  return {
    mode: ctx.campaign.mode,
    ruleset: ctx.campaign.ruleset,
    narration,
    pacing,
    speakerIds,
    addCharacterIds: addCharacterIds.length ? addCharacterIds : undefined,
    remoteIds: remoteIds.length ? remoteIds : undefined,
    fork,
    loreCallIds: loreCallIds.length ? loreCallIds : undefined,
    adjudication,
    setting,
    proposals,
    scenery: ctx.scenery,
    corrections: corrections.length ? corrections : undefined,
    ...(stateChanges.length ? { stateChanges } : {}),
  }
}

export function adjudicationLabel(adj: GmAdjudication): string {
  const rolled = adj.degree ?? (adj.tier ? TIER_LABEL[adj.tier] : 'roll')
  if (adj.source === 'recorded_roll' && adj.choice) return `${adj.moveName}: ${adj.choice} chosen (${rolled}, ${adj.total})`
  if (adj.source === 'recorded_roll' && adj.awaitingChoice) return `${adj.moveName}: ${rolled} (${adj.total}, recorded roll), your choice`
  if (adj.source === 'recorded_roll' && adj.followUp && adj.awaitingQuestions) return `${adj.moveName}: question from the earlier ${rolled} (${adj.total}), ${adj.awaitingQuestions} left`
  if (adj.source === 'recorded_roll' && adj.awaitingQuestions) return `${adj.moveName}: ${rolled} (${adj.total}, recorded roll), your question${adj.awaitingQuestions > 1 ? 's' : ''}`
  if (adj.source === 'recorded_roll' && adj.followUp) return `${adj.moveName}: question from the earlier ${adj.degree ?? (adj.tier ? TIER_LABEL[adj.tier] : 'roll')} (${adj.total})`
  if (adj.source === 'recorded_roll') return `${adj.moveName}: ${adj.degree ?? (adj.tier ? TIER_LABEL[adj.tier] : '')} (${adj.total}, recorded roll)`
  if (adj.source === 'set_event') return 'Set event (canon, no roll)'
  if (adj.source === 'roll_needed') return `${adj.moveName}: roll needed${adj.target !== undefined ? ` vs ${adj.target}` : ''}`
  return 'GM judgment (guided, not a rules result)'
}

/** The public text of a GM message — what every character agent and the player sees in the transcript. */
export function formatGmMessage(turn: GmTurn): string {
  // The move is public: every agent and the player should know where the scene now is.
  const parts = [turn.setting ? `[Scene: ${turn.setting.location}]` : '', turn.narration]
  if (turn.adjudication) {
    const failed = turn.adjudication.source === 'recorded_roll' && turn.adjudication.tier === 'miss'
    parts.push(`[${failed ? 'Failed check — ' : ''}${adjudicationLabel(turn.adjudication)}] ${turn.adjudication.outcome}`)
    if (turn.adjudication.awaitingChoice) parts.push('[Waiting for your choice. Nobody reacts until you make it.]')
    else if (turn.adjudication.awaitingQuestions) {
      const n = turn.adjudication.awaitingQuestions
      parts.push(`[Ask your question${n > 1 ? `s (${n} left)` : ''}. Nobody reacts until you do.]`)
    }
  }
  if (turn.pacing === 'cut') parts.push('[Scene ends]')
  return parts.filter(Boolean).join('\n\n') || '[The GM lets the moment play out.]'
}

/**
 * One-shot steer for a character agent's reply: the GM's public ruling, never anyone's private notes.
 * `beatOrder` is the names of this beat's speakers in order, so each agent knows who has already
 * spoken (they are in its transcript and it may answer them) and who still will.
 */
export function gmDirectionFor(turn: GmTurn, speakerName: string, playerName: string, beatOrder: string[] = [], entering = false, remote = false): string {
  const lines = [`The Game Master has ruled on this beat. Reply only as ${speakerName}.`]
  if (remote) {
    // Reached from afar: they answer through that means and never step into the scene.
    lines.push(`${speakerName} is not in this scene. ${playerName} reached ${speakerName} from afar (a call, a message, telepathy, or whatever means the last action used). Answer only through that same means, from where ${speakerName} is, and only to ${playerName}. ${speakerName} does not see or hear the scene beyond what ${playerName} sent and does not join it. Do not describe anyone else there.`)
  } else if (entering) {
    // An arrival only knows how it was reached; it hasn't been part of the scene until now.
    lines.push(`${speakerName} has just been drawn into this scene by ${playerName}'s last action. Answer through the same means ${playerName} used to reach ${speakerName}, in this setting's terms: if ${playerName} called, messaged, or signalled from a distance, reply from wherever ${speakerName} is instead of appearing in person, unless the fiction has given them time to arrive. ${speakerName} does not know where anyone else is or what they are doing unless that has been established; do not report it.`)
  }
  if (turn.adjudication?.source === 'recorded_roll') {
    lines.push(`Binding recorded result: ${adjudicationLabel(turn.adjudication)} — ${turn.adjudication.outcome} Do not reroll, change, or soften it.`)
    if (turn.adjudication.tier === 'miss') lines.push('The check failed. Follow the recorded miss outcome and any GM-described consequence; do not portray the attempted action as successful unless that outcome explicitly allows it.')
  } else if (turn.adjudication?.source === 'roll_needed') {
    lines.push(`${playerName}'s action is not resolved yet: it needs a ${turn.adjudication.moveName} roll. React without deciding whether it succeeds.`)
  } else if (turn.adjudication) {
    lines.push(`GM ruling: ${turn.adjudication.outcome}`)
  }
  if (turn.setting) lines.push(`The scene is now at ${turn.setting.location}.`)
  const at = beatOrder.indexOf(speakerName)
  const before = at > 0 ? beatOrder.slice(0, at) : []
  const after = at >= 0 ? beatOrder.slice(at + 1) : []
  if (before.length) lines.push(`${listNames(before)} just spoke this beat. ${speakerName} can respond to them as readily as to ${playerName}.`)
  if (after.length) lines.push(`${listNames(after)} will speak after ${speakerName}; leave their responses to them.`)
  if (!remote) {
    // A beat is a step forward in time, not a fresh huddle: answer the latest line and do what was settled.
    lines.push(`Continue from the latest line in the transcript; that is where the moment is now. Do not repeat a count, plan, or order someone has already given.`)
    lines.push(`If ${playerName} gave ${speakerName} a task, or the group has settled on a plan, ${speakerName} carries it out now: show it happening, not getting ready for it. Do not reassign roles, issue new orders, or restate the plan. If ${speakerName} truly objects, a brief word, then act.`)
    lines.push(`End on what ${speakerName} does or says, not on waiting for a signal.`)
  }
  if (turn.pacing === 'advance') lines.push(`Move the situation forward: time has passed since the last line, so ${speakerName} acts rather than waits.`)
  if (turn.pacing === 'cut') lines.push('Bring the scene to a close.')
  lines.push(`Never speak or act for ${playerName} or any other carded character.`)
  return lines.join(' ')
}

function listNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Consequences the player confirmed on this branch, in story order. Derived from messages, so fork/rewind need no bookkeeping. */
export function branchConsequencesFrom(messages: { gm?: GmTurn }[]): string[] {
  return messages.flatMap((m) => (m.gm?.proposals ?? []).filter((p) => p.status === 'confirmed' && p.scope === 'branch').map((p) => p.text))
}

/** Small authoritative ledger for later turns, independent of model-written summaries. */
export function recentRollsFrom(messages: readonly { campaignRoll?: RecordedMove }[], limit = 3): string[] {
  return messages.flatMap((m) => m.campaignRoll ? [m.campaignRoll] : []).slice(-limit).map((roll) =>
    `${roll.moveName} (${roll.degree ?? roll.tier}, ${roll.total}): ${roll.action.slice(0, 150)} → ${roll.outcome.slice(0, 500)}`)
}
