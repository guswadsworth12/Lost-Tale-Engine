/**
 * useChatSession: the central hook driving a single chat — sends/regenerates messages, builds
 * prompts, streams generation, and runs the post-reply "assist" passes (relationship judging,
 * intimacy scenes, gifts, objectives, world triggers, summarization, choice suggestions).
 */
import { appearanceNote, cardBrief } from '@/lib/characters/cardBrief'
import { stillStrangers, strangerNote, strangersFor } from '@/lib/story/acquaintance'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { promptOverride } from '@/lib/prompt/promptOverrides'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatFactsApi, chatsApi, instructTemplatesApi, memoriesApi, messagesApi, objectivesApi, relationshipEventsApi, storiesApi, worldInfoBooksApi, worldsApi } from '@/lib/api/client'
import { sceneChain, sceneLabel, storyRecapBlock } from '@/lib/story/recaps'
import { chapterBriefing, chapterIdOf, chapterLabel, chapterLine, chaptersOf } from '@/lib/story/chapters'
import { writeChapterRecap, type ChapterRecapDraft } from '@/lib/story/chapterRecap'
import { writeSceneRecap, type RecapDraft } from '@/lib/story/recapWriter'
import { playerViewOf, switchPlayer as planPlayerSwitch } from '@/lib/characters/player'
import { newId } from '@/lib/id'
import type { AuthorNote, Chat, CommitmentStatus, DateEventCard, ItemEffect, MessageIntent, Objective, ObjectiveTask, RelationshipStage, StoredMessage, WorldCard } from '@/lib/types'
import { collectImageBase64, composeMessageText, type PendingAttachment } from '@/lib/attachments'
import { makeGenKey } from '@/lib/api/kobold'
import { generateWithTimeout, type AssistShaping } from '@/lib/api/generateWithTimeout'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { characterClient, useJobClients, useModelSettings } from '@/lib/hooks/useModelFor'
import { servedByLabel, usesChatCompletion, type ServiceKind } from '@/lib/api/services'
import type { ChatBackend } from '@/lib/api/chatBackend'
import { campaignPrompt, sheetForWorld } from '@/lib/world/campaign'
import { modulesForWorld } from '@/lib/world/worldTemplates'
import { romancePromptPolicy } from '@/lib/prompt/romanceEmphasis'
import {
  GM_NAME,
  GM_SPEAKER_ID,
  branchConsequencesFrom,
  earlierRollFrom,
  pendingChoiceFrom,
  setEventsDoneFrom,
  gmHeld,
  type GmPlayedCharacter,
  type SetEvent,
  buildGmPrompt,
  formatGmMessage,
  gmDirectionFor,
  isPlayerCharacter,
  parseGmTurn,
  cardCallsFrom,
  recentRollsFrom,
  fallbackGmTurn,
  type GmContext,
  type GmTurn,
} from '@/lib/world/gm'
import { gameStateFrom, normalizeGameState, stateLines, trackValue, type StateChange, type TrackEffect } from '@/lib/world/gameState'
import { currentScenery, describeScenery, pinnedSceneryGuidance, sceneryIsNight } from '@/lib/vn/scenery'
import { sceneSettingFrom, type SceneSettingEvent } from '@/lib/chat/sceneSetting'
import { BUILTIN_SYSTEM_PROMPTS, buildPrompt, estimateTokens, type ChatMessage, type StyleGuidanceItem } from '@/lib/prompt/builder'
import { countTokensCached } from '@/lib/tokenCache'
import { SUMMARY_MAX_LENGTH, summarizeMessages } from '@/lib/prompt/summarize'
import { generateChoices } from '@/lib/prompt/choices'
import { detectCompletedTasks, generateTasks, suggestObjective } from '@/lib/objectives/objectiveAssist'
import {
  assessCommitmentAsk,
  assessDateOutcome,
  assessIntimacyMilestone,
  assessRelationshipMoment,
  dampenRepeatedDeltas,
  detectGalleryUnlocks,
  draftHiddenAgenda,
  scaleDeltasForDifficulty,
  suggestDateEvent,
} from '@/lib/dating/relationshipAssist'
import { initiativeContribution, nextInitiativeBalance, nextMomentum, slowBurnPacingNote, warmthDeltaOf } from '@/lib/dating/momentum'
import { applyPlanUpdates, planLinesForJudge, plansChanged, plansGuidance } from '@/lib/dating/plans'
import { applyBeliefUpdates, beliefLinesForJudge, beliefsChanged, beliefsGuidance } from '@/lib/dating/beliefs'
import {
  applyExpectationUpdates,
  expectationLinesForJudge,
  expectationsChanged,
  expectationsGuidance,
  violatedExpectationTexts,
} from '@/lib/dating/expectations'
import { repeatedIntentNudge, trailingIntentRun } from '@/lib/dating/intent'
import { isRebuffActive, rebuffGuidance, type RecentRebuff } from '@/lib/dating/rebuff'
import {
  advanceIntimacyScene,
  appendSceneShapeLog,
  clothingOf,
  detectExplicitAntiPatternUsed,
  explicitAftercareGuidance,
  explicitSceneGuidance,
  intimacyAnticipationGuidance,
  intimacyConsentTensionGuidance,
  intimacyPaceFor,
  intimacySceneGuidance,
  isIntimacySceneActive,
  sceneArousalBand,
  repeatedEscalationShapeGuidance,
  arousalOf,
  resolveIntimacyChoice,
  resolvedSceneFlags,
  sceneResolveSnapshot,
  stanceOfScene,
  startOrShiftIntimacyScene,
} from '@/lib/dating/intimacyScene'
import type { IntimacyScene } from '@/lib/dating/intimacyScene'
import { detectAnyBoundaryCrossing } from '@/lib/dating/boundaryGuard'
import { detectPersonaAgencyViolation } from '@/lib/dating/agencyGuard'
import { buildSteerDirective, hardFailCorrectionDirective } from '@/lib/dating/steer'
import { earlyEscalationGuidance } from '@/lib/prompt/intimacyGuidance'
import {
  activityPhase,
  daysUntilAnnualDate,
  describePresence,
  describeWeather,
  describeWorldMoment,
  detectNarratedPhase,
  advancePhase,
  clockAfterNarration,
  formatCalendarDate,
  getCalendarInfo,
  resolveScheduledPresence,
  getEnergyRemaining,
  getWeather,
  PHASES,
  isNightPhase,
  spendEnergy,
} from '@/lib/world/calendar'
import { dateEventCardForActivity, type DayPlannerActivity } from '@/lib/world/dayPlanner'
import { sceneContinuityNote } from '@/lib/prompt/sceneContinuity'
import { sceneStateBlock } from '@/lib/prompt/sceneStateBlock'
import { vnProseNote } from '@/lib/prompt/vnProse'
import { expressionRepeatNote } from '@/lib/vn/expressionRepeat'
import { isVnReady } from '@/lib/vn/artHint'
import { detectContinuityBreak, describeContinuityBreak } from '@/lib/dating/continuityGuard'
import { getScenarioCatalog, scenarioById, selectScenario, successorScenario } from '@/lib/dating/scenarios'
import { pendingChoiceOption } from '@/lib/dating/intimacyStages'
import { newlyDiscoveredRegions, withDiscoveredRegions } from '@/lib/dating/touch'
import { combinedValence, kinkValenceMap } from '@/lib/dating/kinks'
import type { BodyRegion } from '@/lib/dating/arousal'
import { evaluateTriggers } from '@/lib/world/triggers'
import {
  ambientEventGuidance,
  describeSocialReaction,
  scheduleConflictGuidance,
  selectAmbientEvent,
  selectSocialReaction,
} from '@/lib/world/ambientEvents'
import { findArchetypeMatch, participantRelationshipGuidance } from '@/lib/chat/participantArchetype'
import {
  applyBreakupScar,
  clampAffection,
  clampStat,
  computeWarmth,
  crossedMilestone,
  evaluateRelationshipRisk,
  FIRST_KISS_FLAG,
  formatCommitmentStatus,
  findActiveIntimacyScene,
  formatRelationshipStage,
  getRelationshipStats,
  getRelationshipTrack,
  isLiveScene,
  nextCommitmentTier,
  patchRelationshipTrack,
  RELATIONSHIP_DIMENSIONS,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
  unlockedEndingIds,
} from '@/lib/dating/stage'
import { advanceContact, contactRegionsFor, isSceneParticipant, sceneParticipants, withParticipant } from '@/lib/dating/sceneParticipants'
import {
  appendGiftLog,
  birthdayGiftGuidance,
  defaultGiftInventory,
  getGiftCatalog,
  giftBirthdayMultiplier,
  giftById,
  giftCadenceMultiplier,
  giftImpactBase,
  giftMismatchPenalty,
  giftReactionGuidance,
  isReciprocityCueActive,
  recentGiftCount,
  recentMeaningfulGiftName,
  reciprocityGuidance,
  trailingSameGiftRun,
  type ReciprocityCue,
} from '@/lib/dating/gifts'
import { createGenerationLock, type GenerationLock } from '@/lib/chat/generationLock'
import { getCoinMutex } from '@/lib/chat/coinMutex'
import { nextRoundRobinSpeaker, parseMention, pickDirectorSpeaker, rosterFrom } from '@/lib/chat/scene'
import { itemById } from '@/lib/dating/items'
import { buildRelationshipDescription } from '@/lib/dating/relationshipDescription'
import { getInstructTemplate, resolveInstructTemplate } from '@/lib/prompt/instructTemplates'
import { intimacyGuidance, resolveIntimacyLevel } from '@/lib/prompt/intimacyGuidance'
import { chatCompletionSamplerToRequest } from '@/lib/api/chatCompletionSampler'
import { extractSceneTag, stripSceneTagForDisplay, type SceneTag } from '@/lib/vn/sceneTag'
import { resolveSceneBackground } from '@/lib/vn/resolveBackground'
import { withIndefiniteArticle } from '@/lib/text/article'
import {
  balanceTrailingMarkup,
  buildSlopAvoidanceNote,
  cleanModelOutput,
  endsCleanly,
  EXPLICIT_ANTI_PATTERN_ENTRIES,
  isDuplicateOfRecentText,
  isVerbatimEcho,
  SLOP_SCAN_TURNS,
  trimToLastSentence,
} from '@/lib/text/slop'
import { substituteMacros } from '@/lib/characters/macros'
import { normalizeRpMarkup } from '@/lib/text/messageSegments'
import { replyMaxTokens, resolveReplyLength } from '@/lib/characters/voice'
import { SCENE_MOOD_IDS } from '@/lib/vn/moods'
import { DEFAULT_EXPRESSIONS, expressionCandidatesFor } from '@/lib/vn/expressions'
import { getUnlockedBackgroundIds, getUnlockedExpressionIds } from '@/lib/vn/unlocks'
import { intimateOutfitFor, outfitOwnedFlag, selectableOutfitIds, spriteKey } from '@/lib/vn/outfits'
import {
  AFTERGLOW_TURNS,
  aftercareDeltas,
  aftercareNeed,
  aftercarePaceContext,
  aftercareReason,
  aftercareToast,
  countCharReplies,
  isAfterglowActive,
  isAfterglowComplete,
  afterglowTurnsSince,
} from '@/lib/dating/aftercare'
import { backgroundLabel } from '@/lib/vn/backgrounds'
import { countStaticSceneTurns, sceneProgressionNudge } from '@/lib/prompt/sceneProgression'
import {
  composeIntimacyActionText,
  getUnlockedIntimacyOptions,
  intimacyActionDirective,
  intimacyArousalWeight,
  intimacyEntryKinks,
  intimacyItemById,
  intimacyOptionsGuidance,
  isExplicitCategory,
  resolveIntimacyPromptNote,
} from '@/lib/dating/intimacyCatalog'
import {
  afterglowGuidance,
  agencyGuardNote,
  authoredStatePriorityNote,
  characterIntentGuidance,
  desireGuidance,
  fearGuidance,
  moodGuidance,
  needGuidance,
  stockRomancePhrasingNote,
} from '@/lib/prompt/mindGuidance'
import {
  classifyAttachedImageScene,
  detectCharacterForms,
  detectExpressionFromSprites,
  detectExpressionTextMismatch,
  shortlistExpressions,
} from '@/lib/vn/sceneVision'
import { appearanceForCharacter, formChoices, isPhysicalForm } from '@/lib/vn/appearances'
import { assessRapport } from '@/lib/dating/rapport'
import { bookAppliesToChat } from '@/lib/worldinfo/scope'
import { buildFactsLorebook } from '@/lib/worldinfo/facts'
import { messageWitnesses, witnessedMessage } from '@/lib/memory/witnesses'
import { latestJournal, memoriesKnownBy, memoryBlock, selectMemoriesExplained } from '@/lib/memory/rank'
import type { PromptInspection } from '@/lib/prompt/inspection'
import { gmMemoryDigest, knowledgeGaps } from '@/lib/memory/gmKnowledge'
import { buildScribePrompt, parseScribeResponse } from '@/lib/memory/scribe'
import { buildJournalPrompt, parseJournalResponse, pickForJournal } from '@/lib/memory/journal'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { errorMessage, toastError, toastInfo, toastSuccess } from '@/lib/store/useToastStore'
import { playSendBlip } from '@/lib/audio/sfx'
import type { Character, Lorebook } from '@/lib/characters/cardSpec'
import { buildCharacterProfileNote } from '@/lib/characters/profile'
import type { ChoiceOption, RelationshipDimension, RelationshipWarning, Scene, SceneFlag } from '@/lib/types'

/** Minimum number of newly-eligible messages before auto-summarize bothers running (avoids a summarization call on every single turn). */
const MIN_BATCH_FOR_AUTO_SUMMARY = 6
/** Most messages the memory scribe reads in one call. */
const SCRIBE_BATCH = 16

/** Extra generation rounds `runGeneration` allows itself when a reply looks cut off by hitting max_length, before giving up and leaving it as-is. */
const MAX_AUTO_CONTINUE_ROUNDS = 2

/** A chat-level override (`Chat.assistOverrides`) wins over the global Settings → Generation default — unset falls back to it, same precedence style as `Character.instructTemplateId`. */
function effectiveAssistFlag(chatOverride: boolean | undefined, globalDefault: boolean): boolean {
  return chatOverride ?? globalDefault
}

/** Re-encodes an image URL as a small JPEG (base64, no `data:` prefix) for the vision scene pass; undefined on failure. */
async function downscaleImageToBase64(url: string, maxEdge = 320): Promise<string | undefined> {
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.crossOrigin = 'anonymous'
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('image load failed'))
      el.src = url
    })
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth || maxEdge, img.naturalHeight || maxEdge))
    const w = Math.max(1, Math.round((img.naturalWidth || maxEdge) * scale))
    const h = Math.max(1, Math.round((img.naturalHeight || maxEdge) * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return undefined
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82)
    return dataUrl.slice(dataUrl.indexOf(',') + 1) || undefined
  } catch {
    return undefined
  }
}

/** KoboldCpp's `images` field describes the current context, not per-turn — resend whatever the most recent user turn attached. */
function latestImages(history: StoredMessage[]): string[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const images = history[i].role === 'user' ? history[i].images : undefined
    if (images?.length) return images.map((dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1))
  }
  return []
}

/** Coin bonus for crossing into a new relationship stage (`announceMilestone`). */
const STAGE_MILESTONE_COIN_BONUS = 15

/** Coin bonus for an accepted Define-the-Relationship ask (`askForCommitment`). */
const COMMITMENT_ACCEPTED_COIN_BONUS = 25

/** Coin bonus for completing a chat objective (`setObjectiveStatus`); date/hangout payouts are separate (`endDateEvent`). */
const OBJECTIVE_COMPLETE_COIN_BONUS = 12

/** Toasts a relationship-stage crossing, logs it as a ChatFact, and grants a one-time coin bonus. */
async function announceMilestone(opts: {
  charName: string
  personaName: string
  chatId: string
  previousStage: RelationshipStage
  relationshipStage: RelationshipStage
  sourceMessageId?: string
  /** Whose track to open a reciprocity window on; omitted call sites just skip that part. */
  characterId?: string
  turnCount?: number
}): Promise<void> {
  if (!crossedMilestone(opts.previousStage, opts.relationshipStage)) return
  const label = formatRelationshipStage(opts.relationshipStage)
  const coinsGranted = await getCoinMutex(opts.chatId).run(async () => {
    const liveChat = await chatsApi.get(opts.chatId)
    if (!liveChat) return 0
    await chatsApi.update(opts.chatId, { giftCoins: Math.max(0, (liveChat.giftCoins ?? 0) + STAGE_MILESTONE_COIN_BONUS) })
    return STAGE_MILESTONE_COIN_BONUS
  })
  toastSuccess(`${opts.charName}'s relationship with you is now "${label}"${coinsGranted ? ` — +${coinsGranted} coins` : ''}`, { chime: true })
  chatFactsApi
    .create({
      chatId: opts.chatId,
      text: `${opts.personaName} and ${opts.charName}'s relationship recently deepened to "${label}."`,
      sourceMessageId: opts.sourceMessageId,
    })
    .catch(() => {})
  if (opts.characterId) {
    const freshChat = await chatsApi.get(opts.chatId)
    if (freshChat) {
      await chatsApi.update(
        opts.chatId,
        patchRelationshipTrack(freshChat, opts.characterId, {
          reciprocityCue: { startedAtTurn: opts.turnCount ?? 0, reason: 'milestone' },
        }),
      )
    }
  }
}

/** Shared breakup/reconciliation choke point, called after every relationship-stat recompute; applies the stat scar and fires the matching toast. */
function applyRelationshipRisk(opts: {
  charName: string
  commitmentStatus: CommitmentStatus
  stats: Record<RelationshipDimension, number>
  existingWarning?: RelationshipWarning
  breakupCount: number
}): {
  commitmentStatus: CommitmentStatus
  stats: Record<RelationshipDimension, number>
  relationshipWarning?: RelationshipWarning
  breakupCount: number
  warnedJustNow: boolean
  brokeUpJustNow: boolean
  clearedJustNow: boolean
} {
  const result = evaluateRelationshipRisk({
    commitmentStatus: opts.commitmentStatus,
    stats: opts.stats,
    existingWarning: opts.existingWarning,
    breakupCount: opts.breakupCount,
  })
  let stats = opts.stats
  if (result.brokeUpJustNow) {
    stats = applyBreakupScar(opts.stats)
    toastError(`${opts.charName} broke things off — the strain never got resolved in time.`)
  } else if (result.warnedJustNow) {
    toastError(`${opts.charName}'s relationship is on the rocks: ${result.warning?.reason}. Fix things before it's too late.`)
  } else if (result.clearedJustNow) {
    toastSuccess(`${opts.charName}'s relationship has stabilized.`, { chime: true })
  }
  return {
    commitmentStatus: result.commitmentStatus,
    stats,
    relationshipWarning: result.warning,
    breakupCount: result.breakupCount,
    warnedJustNow: result.warnedJustNow,
    brokeUpJustNow: result.brokeUpJustNow,
    clearedJustNow: result.clearedJustNow,
  }
}

/** Drops any scene-tag field the model wasn't actually offered (locked expression/background/outfit). */
function sanitizeSceneTag(
  scene: SceneTag | undefined,
  unlockedExpressions: string[],
  unlockedBackgrounds: string[],
  /** The outfit ids the model was actually offered this turn (`selectableOutfitIds`). Omitted for a character with no outfit art, where an `outfit=` tag can only be invention. */
  selectableOutfits?: string[],
): SceneTag | undefined {
  if (!scene) return undefined
  const cleaned: SceneTag = {}
  if (scene.expression && unlockedExpressions.includes(scene.expression)) cleaned.expression = scene.expression
  if (scene.background && unlockedBackgrounds.includes(scene.background)) cleaned.background = scene.background
  // Mood isn't unlock-gated (music isn't affection-locked), just checked against the known set.
  if (scene.mood && SCENE_MOOD_IDS.includes(scene.mood)) cleaned.mood = scene.mood
  // Dropped (not coerced to base) so an unset outfit just means "no change" downstream.
  if (scene.outfit && selectableOutfits?.includes(scene.outfit)) cleaned.outfit = scene.outfit
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

function hasRequiredFlags(required: string[] | undefined, flags: Set<SceneFlag>): boolean {
  if (!required?.length) return true
  return required.every((f) => flags.has(f as SceneFlag))
}

/** Live generation HUD stats, timed client-side from this round's own SSE stream. */
export interface GenerationStats {
  tokensPerSec: number
  firstTokenMs: number
  contextUsed: number
  contextBudget: number
  /** True once this round has finished (the numbers are final) — still climbing mid-stream until then. */
  measured: boolean
}

export function useChatSession(chatId: string | null) {
  const sampler = useSettingsStore((s) => s.sampler)
  const reasoningTokenReserve = useSettingsStore((s) => s.reasoningTokenReserve)
  const { saved: secrets } = useSecretStatus()
  const chatBackendModel = useSettingsStore((s) => s.chatBackendModel)
  const chatCompletionSampler = useSettingsStore((s) => s.chatCompletionSampler)
  const instructTemplateId = useSettingsStore((s) => s.instructTemplateId)
  const autoSummarize = useSettingsStore((s) => s.autoSummarize)
  const characterMemoryOn = useSettingsStore((s) => s.characterMemory)
  const keepRecentMessages = useSettingsStore((s) => s.keepRecentMessages)
  const summaryDetail = useSettingsStore((s) => s.summaryDetail)
  const autoDetectTasks = useSettingsStore((s) => s.autoDetectTasks)
  const autoTrackRelationship = useSettingsStore((s) => s.autoTrackRelationship)
  const relationshipDifficulty = useSettingsStore((s) => s.relationshipDifficulty)
  const autoSuggestChoices = useSettingsStore((s) => s.autoSuggestChoices)
  const regexScripts = useSettingsStore((s) => s.regexScripts)
  const globalVisualNovelMode = useSettingsStore((s) => s.visualNovelMode)
  const reducedAudio = useSettingsStore((s) => s.reducedAudio)
  const styleGuidanceNote = useSettingsStore((s) => s.styleGuidance)
  const avoidEmDashes = useSettingsStore((s) => s.avoidEmDashes)
  const slowBurnPacing = useSettingsStore((s) => s.slowBurnPacing)
  const globalIntimacyLevel = useSettingsStore((s) => s.intimacyLevel)
  const visionSceneDetection = useSettingsStore((s) => s.visionSceneDetection)
  const globalSystemPrompt = useSettingsStore((s) => s.systemPrompt)
  const globalPostHistory = useSettingsStore((s) => s.postHistoryInstructions)
  const promptSections = useSettingsStore((s) => s.promptSections)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)
  // Each job uses the model chosen for it (Settings → Models by job), else Main. `client` is Story replies.
  const jobClients = useJobClients()
  const modelSettings = useModelSettings()
  const mainClient = useChatBackendClient()
  const client = jobClients.story.client
  const gmClient = jobClients.gm.client
  const memoryClient = jobClients.memory.client
  const trackingClient = jobClients.tracking.client
  const visionClient = jobClients.vision.client
  const activeGenerationClientRef = useRef<ChatBackend | null>(null)
  const customInstructTemplates = useApiQuery('instruct-templates', () => instructTemplatesApi.list(), []) ?? []

  const chat = useApiQuery('chats', () => (chatId ? chatsApi.get(chatId) : Promise.resolve(undefined)), [chatId])
  const character = useApiQuery(
    'characters',
    () => (chat ? charactersApi.get(chat.characterId) : Promise.resolve(undefined)),
    [chat?.characterId],
  )
  // A character's own override wins over the global Settings -> Generation default; empty/unset falls back.
  // A hosted chat-completion backend formats its own turns — the active instruct template's own
  // reserved tokens (ChatML's `<|im_start|>`, Llama 3's `<|eot_id|>`, ...) have no meaning there and
  // would otherwise leak into the system/user message content as literal text (only `plain-chat`'s
  // empty affixes happen to hide this). Force the token-free, name-prefixed `plain-chat` template
  // for this backend instead; KoboldCpp keeps using whatever the user actually has configured.
  const instructTemplate = resolveInstructTemplate(character?.instructTemplateId || instructTemplateId, customInstructTemplates)
  // Per job: each may run on a different kind of service (Settings → Models by job).
  const templateFor = useCallback(
    (kind: ServiceKind) => (usesChatCompletion(kind) ? getInstructTemplate('plain-chat') : instructTemplate),
    [instructTemplate],
  )
  const template = templateFor(jobClients.story.kind)
  // Shared prompt shaping for every background judge/assist call below (relationship tracker,
  // objectives, choices, director pick, rapport, scene vision) — never for the main reply, which
  // already builds its own fully-templated, reasoning-aware prompt via `buildPrompt`/`replyMaxTokens`.
  // Each job uses its own connection's template (`plain-chat` for a chat-completion one, as the reply
  // does) so a background call looks like that model's own turn shape instead of a flat, unwrapped
  // block a strict template model (Gemma) reads as already-finished text and answers with EOS to
  // (rp#7), and adds the same reasoning-token headroom the reply gets so a thinking model's hidden
  // reasoning doesn't eat the whole small assist budget before the visible JSON is due (rp#6).
  const jobShaping: Record<'gm' | 'memory' | 'tracking' | 'vision', AssistShaping> = useMemo(() => ({
    gm: { reasoningReserve: reasoningTokenReserve, template: templateFor(jobClients.gm.kind) },
    memory: { reasoningReserve: reasoningTokenReserve, template: templateFor(jobClients.memory.kind) },
    tracking: { reasoningReserve: reasoningTokenReserve, template: templateFor(jobClients.tracking.kind) },
    vision: { reasoningReserve: reasoningTokenReserve, template: templateFor(jobClients.vision.kind) },
  }), [jobClients, reasoningTokenReserve, templateFor])
  // Extra characters in a group chat, beyond the primary — [] for today's ordinary single-character
  // chats. Fetched by id rather than a batched endpoint since the character list is small (a local,
  // single-user app) and this reuses the exact same reactive `characters` resource as `character` above.
  const participantIds = chat?.participants ?? []
  const participantCharacters = useApiQuery(
    'characters',
    () => Promise.all(participantIds.map((id) => charactersApi.get(id))).then((list) => list.filter((c): c is Character => !!c)),
    [participantIds.join(',')],
  ) ?? []
  // The card you play in this story. Everything below reads it through `persona`, the public view
  // (name, portrait, what others may know); its private prompts and memory never reach a prompt.
  const playerCharacter = useApiQuery(
    'characters',
    () => (chat?.playerCharacterId ? charactersApi.get(chat.playerCharacterId) : Promise.resolve(undefined)),
    [chat?.playerCharacterId],
  )
  const persona = playerCharacter ? playerViewOf(playerCharacter) : undefined
  // The story this scene belongs to, and all its scenes (none for a one-scene story). Keyed on
  // 'chats' so ending a scene, which creates the next one, refreshes the list.
  const story = useApiQuery('stories', () => (chat?.storyId ? storiesApi.get(chat.storyId) : Promise.resolve(undefined)), [chat?.storyId])
  const storyScenes = useApiQuery('chats', () => (chat?.storyId ? storiesApi.scenes(chat.storyId) : Promise.resolve([] as Chat[])), [chat?.storyId]) ?? []
  const world = useApiQuery(
    'worlds',
    () => (character?.worldId ? worldsApi.get(character.worldId) : Promise.resolve(undefined)),
    [character?.worldId],
  )
  const messages = useApiQuery(
    'messages',
    () => (chatId ? messagesApi.listByChat(chatId) : Promise.resolve([])),
    [chatId],
  ) ?? []
  const worldInfoBooks = useApiQuery('world-info-books', () => worldInfoBooksApi.list(), []) ?? []
  const callableLore = useMemo(() => worldInfoBooks
    .filter((book) => world && book.boundWorldIds?.includes(world.id) && !book.boundChatIds?.length && !book.boundCharacterIds?.length)
    .flatMap((book) => book.book.entries.filter((entry) => entry.enabled && entry.content.trim()).map((entry) => ({
      id: `${book.id}:${entry.id}`,
      title: `${book.name} · ${entry.comment || entry.keys[0] || entry.id}`,
      content: entry.content,
    }))), [world, worldInfoBooks])
  const chatFacts = useApiQuery(
    'chat-facts',
    () => (chatId ? chatFactsApi.listByChat(chatId) : Promise.resolve([])),
    [chatId],
  ) ?? []
  const activeFacts = useMemo(() => chatFacts.filter((f) => f.active), [chatFacts])
  const activeObjective = useApiQuery(
    'objectives',
    () => (chatId ? objectivesApi.getActive(chatId) : Promise.resolve(undefined)),
    [chatId],
  )

  const [isGenerating, setIsGenerating] = useState(false)
  // True while the Game Master decides a turn, before any reply streams, so Stop is offered then too.
  const [isGmRuling, setIsGmRuling] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [generatingMessageId, setGeneratingMessageId] = useState<string | null>(null)
  const [genStats, setGenStats] = useState<GenerationStats | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const genKeyRef = useRef<string>('')
  const summarizingRef = useRef(false)
  const scribingRef = useRef(false)
  // Synchronous lock guarding against double-dispatch within one tick — `isGenerating` state alone is one render too slow. Lazy-built to avoid allocating every render.
  const generationLockRef = useRef<GenerationLock | null>(null)
  if (!generationLockRef.current) generationLockRef.current = createGenerationLock()
  const beginGeneration = useCallback(() => generationLockRef.current!.begin(), [])
  const endGeneration = useCallback(() => generationLockRef.current!.end(), [])
  // Sprite URL -> base64 cache for the vision scene-detect pass, memoised for the hook's lifetime.
  const spriteBase64Ref = useRef<Map<string, string>>(new Map())
  // Who a freshly-sent message's reply gets generated as — only meaningful in a group chat.
  const [replyAsCharacterId, setReplyAsCharacterId] = useState<string | null>(null)
  // How full the last reply's prompt was, for the context meter. `dropped` counts transcript
  // messages that no longer fit, the clearest sign a scene has run long.
  const [contextUsage, setContextUsage] = useState<{ used: number; budget: number; dropped: number } | null>(null)
  useEffect(() => {
    setReplyAsCharacterId(null)
    setContextUsage(null)
  }, [chatId])

  // Opening a chat with an unread unprompted message clears its ChatsPanel badge.
  useEffect(() => {
    if (chat?.id && chat.hasUnreadOutreach) {
      chatsApi.update(chat.id, { hasUnreadOutreach: false }).catch(() => {})
    }
  }, [chat?.id, chat?.hasUnreadOutreach])

  // Background "assist" work after a reply lands (relationship scoring, choices, tasks, summary, vision). `key -> label`, shown so the wait stays legible.
  const [assistTasks, setAssistTasks] = useState<Record<string, string>>({})
  useEffect(() => {
    setAssistTasks({})
  }, [chatId])
  const runAssist = useCallback((key: string, label: string, fn: () => Promise<unknown>) => {
    setAssistTasks((t) => ({ ...t, [key]: label }))
    void Promise.resolve()
      .then(fn)
      .catch(() => {})
      .finally(() =>
        setAssistTasks((t) => {
          if (!(key in t)) return t
          const { [key]: _drop, ...rest } = t
          return rest
        }),
      )
  }, [])
  // Fixed order so the strip doesn't reshuffle as tasks finish at different times.
  const assistActivity = ['gm', 'relationship', 'rapport', 'choices', 'tasks', 'summary', 'memory', 'vision']
    .map((k) => assistTasks[k])
    .filter((label): label is string => !!label)

  /** Everyone who can be in a scene, by id — how a shared scene's participant ids resolve back to cards. */
  const allCharactersById = useMemo(
    () => new Map((character ? [character, ...participantCharacters] : participantCharacters).map((c) => [c.id, c])),
    [character, participantCharacters],
  )

  /** Which character's card is "active" for a given speaker id, plus everyone else as a roster. */
  // Cards of characters the GM brought in during the current beat. The reactive
  // `participantCharacters` only catches up on the next render, too late for the arrival's own reply.
  const arrivalsRef = useRef<Character[]>([])
  // Cards of characters reached from afar this beat. They can speak, but they are not in the scene.
  const remoteRef = useRef<Character[]>([])
  useEffect(() => {
    arrivalsRef.current = []
    remoteRef.current = []
  }, [chatId])
  const resolveSpeaker = useCallback(
    (speakerId: string | null | undefined) => {
      const known = character ? [character, ...participantCharacters] : participantCharacters
      const sceneCharacters = [...known, ...arrivalsRef.current.filter((a) => !known.some((c) => c.id === a.id))]
      const away = speakerId ? remoteRef.current.find((c) => c.id === speakerId) : undefined
      const active = away || (speakerId && sceneCharacters.find((c) => c.id === speakerId)) || character
      // Someone answering from afar is with nobody here.
      const roster = active && !away ? sceneCharacters.filter((c) => c.id !== active.id) : []
      return { active, roster }
    },
    [character, participantCharacters],
  )

  // Cached: `buildPrompt` counts every history turn to decide what fits, and a single generation
  // builds the prompt more than once. See `tokenCache.ts` for how the cache is invalidated.
  /** Where a character's replies go: their own connection or model, else the Story replies job. */
  const replyJobFor = useCallback(
    (speaker: Character) => (speaker.modelServiceId || speaker.modelOverride ? characterClient(speaker, modelSettings, mainClient, secrets) : jobClients.story),
    [modelSettings, jobClients.story, mainClient, secrets],
  )

  const countTokens = useCallback(
    async (text: string) =>
      countTokensCached(text, async (t) => {
        try {
          const r = await client.tokenCount(t)
          return r.count
        } catch {
          return estimateTokens(t)
        }
      }, jobClients.story.scope),
    [client, jobClients.story.scope],
  )

  const buildCurrentPrompt = useCallback(
    async (
      historyForPrompt: ChatMessage[],
      opts?: {
        continueLastTurn?: boolean
        impersonateAsUser?: boolean
        speakerId?: string | null
        /** This turn's player intent chip, if any — used only to detect a repeated-intent streak for the diminishing-returns nudge. */
        intent?: MessageIntent
        /** One-off addition to `styleGuidance`, for a generation shape none of the standing settings cover — e.g. 10b's live-scene opener, "you're breaking the ice, not replying to a message." Never persisted, never reused past this one call. */
        extraStyleGuidance?: string
        /** Passed straight through to `buildPrompt` — the Prompt Inspector's "where did my tokens go" view opts into this; the real generation path never does. */
        includeSectionBreakdown?: boolean
      },
    ) => {
      if (!character || !chat) return null
      const { active: speaker, roster } = resolveSpeaker(opts?.speakerId)
      if (!speaker) return null
      // Shaped for the service this speaker's reply goes to: their own connection, else Story replies.
      const speakerTemplate = templateFor(replyJobFor(speaker).kind)
      // Fresh read — the reactive `chat` closure can be one render behind a summary update that just landed.
      const freshChat = (await chatsApi.get(chat.id)) ?? chat
      const sceneRoster = freshChat.scene?.presentCharacterIds
        ? roster.filter((member) => freshChat.scene!.presentCharacterIds!.includes(member.id))
        : roster
      // Only the active speaker's private card lore enters this request. Other characters are
      // represented by their names and the public chat transcript, so secrets do not bleed across agents.
      const lorebooks: Lorebook[] = speaker.card.character_book
        ? [{ ...speaker.card.character_book, sourceKey: `char:${speaker.id}` }]
        : []
      const boundBooks = worldInfoBooks
        .filter((b) =>
          bookAppliesToChat(b, {
            chatId: freshChat.id,
            characterId: speaker.id,
            worldId: character.worldId,
          }),
        )
        .map((b) => ({ ...b.book, sourceKey: `book:${b.id}` }))
      const worldLorebook = world?.lorebook ? [{ ...world.lorebook, sourceKey: `world:${world.id}` }] : []
      const factsLorebook = buildFactsLorebook(activeFacts).map((b) => ({ ...b, sourceKey: 'facts' }))
      const affection = freshChat.affection ?? 0
      const modules = modulesForWorld(world ?? { template: freshChat.mode })
      const romanceEmphasis = modules.romanceEmphasis
      const romanceFocus = romanceEmphasis === 'focus'
      // One read of the char-reply count for the whole build — every turn-scoped window check below keys off it.
      const charReplyCount = countCharReplies(messages)
      // Time-of-day for the prompt's scene framing: a per-chat `scene.timePhase` override (set in the
      // Scene panel or auto-detected from narration) wins over the shared world clock. Weekday still
      // comes from the world clock — only the phase is per-chat.
      const scenePhaseIndex = freshChat.scene?.timePhase ? PHASES.indexOf(freshChat.scene.timePhase) : -1
      const promptPhaseIndex = scenePhaseIndex >= 0 ? scenePhaseIndex : (world?.currentPhaseIndex ?? 0)
      // Split in two on purpose (see `PromptBuildInput.worldMoment`): what the world *is* is stable
      // and belongs in the cacheable prefix, while what the world is *doing right now* changes as
      // the clock advances or the scene moves, and would otherwise invalidate the KV cache for
      // every history token behind it each time it did.
      const worldDescriptionLines = world
        ? [world.description?.trim(), world.rules?.trim() ? `World rules: ${world.rules.trim()}` : '', world.campaign && modules.campaignRules ? campaignPrompt({ ...world.campaign, mode: modules.campaignRules, relationships: modules.relationships, dating: modules.dating }, modules.romanceEmphasis) : '', world.canonFacts?.length ? `Confirmed world facts:\n${world.canonFacts.map((fact) => `- ${fact.text}`).join('\n')}` : ''].filter(Boolean)
        : []
      // Read fresh: a GM turn or scenery choice may have landed after this render's `messages`.
      const branchMessages = await messagesApi.listByChat(freshChat.id)
      // Character memory: this speaker hears only what they witnessed or were told, in this story.
      // The transcript leaves out messages from while they were not there (before they arrived, or
      // while they were away), and the scene summary reaches them only if they missed none of it.
      const memoryOn = characterMemoryOn && !opts?.impersonateAsUser
      const sceneMemories = memoryOn ? await memoriesApi.forChat(freshChat.id).catch(() => []) : []
      const missedIds = new Set(memoryOn ? branchMessages.filter((m) => !witnessedMessage(m, speaker.id)).map((m) => m.id) : [])
      const missedSummarized = branchMessages.some((m) => missedIds.has(m.id) && m.createdAt <= (freshChat.summaryUpToTimestamp ?? 0))
      const memoryPicks = memoryOn
        ? selectMemoriesExplained(sceneMemories, {
            characterId: speaker.id,
            presentIds: freshChat.scene?.presentCharacterIds ?? roster.map((c) => c.id),
            recentText: historyForPrompt.slice(-6).map((m) => m.text).join('\n'),
          })
        : []
      const memoryJournal = memoryOn ? latestJournal(sceneMemories, speaker.id) : undefined
      const memoryText = memoryOn
        ? memoryBlock(speaker.card.name, memoryPicks.map((e) => e.memory), memoryJournal, speaker.id)
        : ''
      // Earlier scenes' confirmed consequences ride along on the chat; this scene's come from its GM turns.
      const branchConsequences = [...(freshChat.carriedConsequences ?? []), ...branchConsequencesFrom(branchMessages)]
      const recentRolls = modules.campaignRules === 'mechanical' ? recentRollsFrom(branchMessages) : []
      // Tracked state this speaker can see: the story's shared values and their own.
      const tracks = modules.campaignRules ? world?.campaign?.tracks : undefined
      const trackedLines = tracks?.length
        ? stateLines(gameStateFrom(tracks, freshChat.gameState, branchMessages, { playerId: freshChat.playerCharacterId }).state, tracks,
          { audience: { characterId: speaker.id }, playerId: freshChat.playerCharacterId, nameOf: (id) => (id === speaker.id ? speaker.card.name : undefined) })
        : []
      // Where the scene is now, replayed from the branch (`chat/sceneSetting.ts`), not the chat's opening value.
      const sceneSetting = sceneSettingFrom(branchMessages, freshChat.scene, (id) => backgroundLabel(id, world))
      const worldMomentLines = [
        ...(world
          ? [
              describeWorldMoment({
                worldId: world.id,
                characterId: speaker.id,
                day: world.currentDay ?? 0,
                phaseIndex: promptPhaseIndex,
                weatherPreferences: speaker.weatherPreferences,
                calendar: world.calendar,
              }),
              // Only worth a line when this character actually has a schedule authored.
              speaker.schedule?.length
                ? describePresence(
                    resolveScheduledPresence(
                      speaker.schedule,
                      world.currentDay ?? 0,
                      promptPhaseIndex,
                      sceneSetting.location,
                    ),
                  )
                : '',
            ]
          : []),
        freshChat.activeEvent?.title
          ? `Current event: ${freshChat.activeEvent.title}${freshChat.activeEvent.description ? `. ${freshChat.activeEvent.description}` : ''}`
          : '',
        // Location/atmosphere framing, independent of whether this chat has a bound World.
        sceneSetting.location ? `Scene location: ${sceneSetting.location}` : '',
        sceneSetting.atmosphere ? `Scene atmosphere: ${sceneSetting.atmosphere}` : '',
        pinnedSceneryGuidance(currentScenery(branchMessages, freshChat.scene), world),
        branchConsequences.length ? `Established in this story so far:\n${branchConsequences.map((c) => `- ${c}`).join('\n')}` : '',
        recentRolls.length ? `Recorded checks in this scene (binding):\n${recentRolls.map((roll) => `- ${roll}`).join('\n')}` : '',
        trackedLines.length ? `Tracked state (kept by the game; do not change it in your reply):\n${trackedLines.map((line) => `- ${line}`).join('\n')}` : '',
      ].filter(Boolean)
      const worldDescription = worldDescriptionLines.length > 0 ? worldDescriptionLines.join('\n') : undefined
      const worldMoment = worldMomentLines.length > 0 ? worldMomentLines.join('\n') : undefined

      const { count: staticSceneTurns, currentBackground: staticSceneBackground } = countStaticSceneTurns(messages)
      const speakerPresence = speaker.schedule?.length
        ? resolveScheduledPresence(
            speaker.schedule,
            world?.currentDay ?? 0,
            promptPhaseIndex,
            sceneSetting.location,
          )
        : undefined
      const scheduleLocation = speakerPresence?.location
      // A genuine schedule conflict (busy/sleeping/traveling) reads as a noticed cost. Suppressed during a live event, which already carries its own cost.
      const scheduleConflictLine =
        !freshChat.activeEvent && speakerPresence ? scheduleConflictGuidance(speaker.card.name, speakerPresence) : ''
      // Don't tell the model to "drift toward" a place the scene is already set — offer other backgrounds instead.
      const sceneLocationNow = sceneSetting.location?.trim().toLowerCase() ?? ''
      const scheduleLocationNorm = scheduleLocation?.trim().toLowerCase() ?? ''
      const sceneAlreadyAtScheduleSpot =
        !!scheduleLocationNorm &&
        !!sceneLocationNow &&
        (scheduleLocationNorm === sceneLocationNow ||
          scheduleLocationNorm.includes(sceneLocationNow) ||
          sceneLocationNow.includes(scheduleLocationNorm))
      const nudgeScheduleLocation = sceneAlreadyAtScheduleSpot ? undefined : scheduleLocation
      const sceneNudge = freshChat.activeEvent
        ? ''
        : sceneProgressionNudge(staticSceneTurns, {
            charName: speaker.card.name,
            scheduleLocation: nudgeScheduleLocation,
            alternateBackgroundLabels: nudgeScheduleLocation
              ? undefined
              : getUnlockedBackgroundIds(world, affection)
                  .filter((id) => id !== staticSceneBackground)
                  .slice(0, 3)
                  .map((id) => backgroundLabel(id, world)),
          })
      // A concrete, authored-data-grounded "something's going on" hook (a holiday, weather the
      // character loves/hates, a routine gap, a goal on their mind, an idle-time interest) — see
      // `world/ambientEvents.ts`. Suppressed during a live event for the same reason `sceneNudge`
      // is: the event itself is already the scene's content.
      const ambientLine = freshChat.activeEvent
        ? ''
        : ambientEventGuidance({
            charName: speaker.card.name,
            characterId: speaker.id,
            chatId: freshChat.id,
            charTurnCount: charReplyCount,
            event: selectAmbientEvent({
              worldId: world?.id,
              characterId: speaker.id,
              day: world?.currentDay ?? 0,
              phaseIndex: world?.currentPhaseIndex ?? 0,
              schedule: speaker.schedule,
              likes: speaker.likes,
              goals: speaker.goals,
              frequentedLocations: speaker.frequentedLocations,
              weatherPreferences: speaker.weatherPreferences,
              birthday: speaker.birthday,
              calendar: world?.calendar,
            }),
          })

      // What this relationship has earned so far — a bank of intimate ideas the model can draw from if a scene goes there. See `intimacyCatalog.ts`.
      const speakerTrack = getRelationshipTrack(freshChat, speaker.id)
      const speakerStats = getRelationshipStats(speakerTrack)
      const speakerWarmth = computeWarmth(speakerTrack.affection ?? 0, speakerStats)
      // Read-only preview of `world/triggers.ts`'s `style_guidance` rules against pre-turn state, so a rule can colour THIS turn's writing — the real, persisting evaluation runs after in `updateAffectionFromReply`. Never marks a rule fired itself. Primary-only.
      const triggerStyleLines =
        speaker.id === character.id && world?.triggers?.length
          ? evaluateTriggers(
              world.triggers,
              {
                affection: speakerTrack.affection ?? 0,
                warmth: speakerWarmth,
                stats: speakerStats,
                flags: new Set(freshChat.sceneFlags ?? []),
                commitmentStatus: speakerTrack.commitmentStatus ?? 'none',
                day: world?.currentDay,
              },
              freshChat.firedTriggerIds ?? [],
            )
              .actions.filter((a): a is Extract<typeof a, { kind: 'style_guidance' }> => a.kind === 'style_guidance')
              .map((a) => a.text)
          : []
      const triggerStyleLine = triggerStyleLines.join(' ')
      // A toy only reaches the model once actually bought — warmth/commitment just gate eligibility to buy.
      const ownedToyIds = new Set(Object.keys(freshChat.toyInventory ?? {}))
      // A world's own content rating wins over the global Settings dial.
      const intimacyLevel = resolveIntimacyLevel(world?.intimacyLevel, globalIntimacyLevel)
      // Same location gate the panel applies — an entry tied to a place the scene isn't in should
      // not be described to the model either, or it will reach for it and the prose goes somewhere
      // the background says it can't be.
      const sceneBackgroundId = resolveSceneBackground({
        taggedBackground: undefined,
        chat: freshChat,
        world,
        affection: speakerWarmth,
        narration: undefined,
      }).id
      const intimacyOptions = intimacyOptionsGuidance(
        getUnlockedIntimacyOptions(
          speakerWarmth,
          speakerTrack.commitmentStatus ?? 'none',
          world,
          ownedToyIds,
          { touch: speaker.touchProfile, kinks: speaker.kinkProfile },
          sceneBackgroundId,
        ),
        intimacyLevel,
      )

      // "Character Mind" — transient mood/need/intent, separate from the relationship track (`prompt/mindGuidance.ts`).
      // Aftermath window of an intimate scene, app-known rather than judge-inferred (`aftercare.ts`).
      const afterglowSince = afterglowTurnsSince(speakerTrack.afterglow ?? undefined, charReplyCount)
      const afterglowLine =
        afterglowSince !== null && isAfterglowActive(speakerTrack.afterglow ?? undefined, charReplyCount)
          ? afterglowGuidance(speaker.card.name, persona?.name || 'You', afterglowSince, speakerTrack.afterglow?.sourceLabel)
          : ''
      // Immediate post-climax physical beat — separate from `afterglowLine`, which stays content-rating-agnostic and non-physical by its own test. Explicit setting only, first couple of replies after the scene resolves.
      const explicitAftercareLine =
        afterglowSince !== null && afterglowSince <= 1 && intimacyLevel === 'explicit' ? explicitAftercareGuidance(speaker.card.name) : ''
      const moodLine = moodGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.mood)
      const needLine = needGuidance(speaker.card.name, speakerTrack.currentNeed)
      const intentLine = characterIntentGuidance(speaker.card.name, speakerTrack.characterIntent)
      const fearLine = fearGuidance(speaker.card.name, speakerTrack.currentFear)
      const desireLine = desireGuidance(speaker.card.name, speakerTrack.currentDesire)
      // Persistent agency layer — turn-spanning intentions the character carries of their own (`dating/plans.ts`).
      const plansLine = plansGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.plans)
      // Standing impressions of and expectations of {{user}} (`dating/beliefs.ts`/`dating/expectations.ts`).
      const beliefsLine = beliefsGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.beliefsAboutUser)
      const expectationsLine = expectationsGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.expectationsOfUser)
      // Overrides a model's trained romantic defaults when they'd conflict with this character's actually-authored state (a resistant mood, or deliberately holding back).
      const priorityLine = authoredStatePriorityNote(
        speaker.card.name,
        speakerTrack.mood,
        (speakerTrack.plans ?? []).some((p) => p.kind === 'distance'),
        !!speaker.boundaries?.length,
      )
      const speakerHoldingBackByPlan = (speakerTrack.plans ?? []).some((p) => p.kind === 'distance')
      const speakerPace = intimacyPaceFor(speakerTrack.mood, speakerHoldingBackByPlan, speaker.boundaries?.length ?? 0)
      const latestUserText = [...historyForPrompt].reverse().find((m) => m.role === 'user')?.text
      const earlyEscalationLine = earlyEscalationGuidance(speakerWarmth, latestUserText, speaker.card.name)
      // The one shared scene, found chat-wide rather than on this speaker's own track: in a group
      // scene it lives on its owner's track, so a non-owner speaking needs to be told about that same
      // scene instead of none at all. Being in the same room as a scene is not the same as being in
      // it, though, so a character the roster doesn't name still gets nothing.
      const promptSceneOwner = findActiveIntimacyScene(freshChat, (s: IntimacyScene) => isIntimacySceneActive(s, charReplyCount))
      const promptScene =
        promptSceneOwner && isSceneParticipant(promptSceneOwner.scene, speaker.id, promptSceneOwner.ownerId)
          ? promptSceneOwner.scene
          : undefined
      const speakerSceneActive = !!promptScene
      const romancePolicy = romancePromptPolicy(romanceEmphasis, speakerSceneActive)
      // Physical continuity + phase-scaled sensory guidance while a scene is active.
      const intimacySceneLine = speakerSceneActive
        ? intimacySceneGuidance(speaker.card.name, promptScene!, speakerPace)
        : ''
      // Sequenced physical mechanics, anti-pattern list, voice/POV guard. Re-checks `intimacyLevel` itself as defense in depth in case the setting was turned down mid-scene.
      const explicitSceneLine =
        speakerSceneActive && intimacyLevel === 'explicit'
          ? explicitSceneGuidance(speaker.card.name, persona?.name || 'You', promptScene!.phase, speakerPace, speaker.explicitVoiceNote)
          : ''
      const escalationShapeLine = speakerSceneActive
        ? (repeatedEscalationShapeGuidance(speaker.card.name, speakerTrack.intimacySceneShapeLog) ?? '')
        : ''
      const intimacyConsentTensionLine = speakerSceneActive
        ? (intimacyConsentTensionGuidance(speaker.card.name, speakerStats.comfort, speakerStats.chemistry) ?? '')
        : ''
      // Pre-scene buildup — the mirror of the line above, only while nothing physical has started yet.
      const intimacyAnticipationLine = !speakerSceneActive
        ? (intimacyAnticipationGuidance(speaker.card.name, persona?.name || 'You', speakerStats.chemistry, speakerStats.comfort) ?? '')
        : ''
      // "Missed opportunity" cost after a real deflection/backfire, distinct from the hard `relationshipWarning` banner.
      const rebuffLine = isRebuffActive(speakerTrack.recentRebuff, charReplyCount)
        ? rebuffGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.recentRebuff!)
        : ''
      const reciprocityLine = isReciprocityCueActive(speakerTrack.reciprocityCue, charReplyCount)
        ? reciprocityGuidance(speaker.card.name, persona?.name || 'You', speakerTrack.reciprocityCue!.reason)
        : ''
      // Stock romance-writing tells, regardless of whether they've come up before in this chat (unlike `buildSlopAvoidanceNote`, which only catches this character's own repeats).
      const isRomanticOrIntimateMoment =
        speakerSceneActive || isAfterglowActive(speakerTrack.afterglow ?? undefined, charReplyCount) ||
        (romanceFocus && speakerStats.chemistry >= 70)
      const recentSpeakerTurns = messages
        .filter((m) => m.role === 'char' && m.name === speaker.card.name)
        .slice(-SLOP_SCAN_TURNS)
        .map((m) => m.text)
      const stockRomancePhrasingLine = stockRomancePhrasingNote(isRomanticOrIntimateMoment, recentSpeakerTurns)
      // The one canonical POV guard — fires on any romantic/intimate moment, catalog-driven scene or freeform.
      const agencyGuardLine = agencyGuardNote(isRomanticOrIntimateMoment, speaker.card.name, persona?.name || 'You')

      // Whether the app is actually presenting this scene as a visual novel — the same tri-state
      // resolution `ChatWindow` renders from, so the prose guidance and the presentation can never
      // disagree about which form the reply is being written for.
      const vnOverride = freshChat.assistOverrides?.visualNovelMode ?? (modules.visualNovel ? globalVisualNovelMode : false)
      const isVisualNovel = vnOverride === 'auto' ? isVnReady(speaker, world) : !!vnOverride
      // How a reply is written when it lands in a dialogue box under a sprite (`prompt/vnProse.ts`).
      const vnProseLine = vnProseNote(isVisualNovel, speaker.card.name, persona?.name || 'You', speakerTrack.mood, sceneRoster.map((c) => c.card.name))
      // The reactive half of `vnExpressionGuidance`'s standing "let the face move" rule — names the
      // specific expression back once it's actually gone stale, the same pressure `slopAvoidance`
      // applies to repeated phrasing. Costs nothing on the (typical) turn nothing has gone stale.
      const expressionRepeatLine = isVisualNovel
        ? (expressionRepeatNote(
            speaker.card.name,
            messages
              .filter((m) => m.role === 'char' && m.name === speaker.card.name)
              .slice(-SLOP_SCAN_TURNS)
              .map((m) => m.scene?.expression),
          ) ?? '')
        : ''
      // Whether anything on screen will actually use an expression/background/outfit tag this turn
      // — the VN stage, or the reactive portrait a live date puts beside the log. See the note on
      // `sceneOptions` below for why this gates what the model is asked for.
      const wantsFullSceneTag = isVisualNovel || isLiveScene(freshChat.activeEvent)
      // A described form or outfit is told to the model in every mode, so it needs the full history too.
      const describedAppearance = !!speaker.outfits?.some((outfit) => outfit.description?.trim())
      const appearanceHistory = (wantsFullSceneTag || describedAppearance) && speaker.outfits?.length
        ? await messagesApi.listByChat(freshChat.id)
        : messages
      // A manual stage correction is what the story shows, so the model is told it too.
      const speakerOutfitId = appearanceForCharacter(appearanceHistory, {
        id: speaker.id, name: speaker.card.name, outfits: speaker.outfits, sprites: speaker.sprites, baseForm: speaker.baseForm, aliases: speaker.aliases,
      }, character.id, getRelationshipTrack(freshChat, speaker.id).affection ?? 0, new Set(freshChat.sceneFlags ?? []), freshChat.scene?.appearanceOverrides?.[speaker.id])

      // Where and when, resolved once: the state block asserts these as fact and `continuityGuard.ts`
      // checks the reply against them afterwards, so both halves have to be reading the same values.
      const promptLocation = sceneSetting.location ?? scheduleLocation
      const promptTimePhase = world
        ? (() => {
            // A world with its own calendar names its own weekday; the built-in one keeps "monday".
            const info = getCalendarInfo(world.currentDay ?? 0, world.calendar)
            return `${info.custom ? info.weekdayName : info.weekday} ${PHASES[promptPhaseIndex]}`
          })()
        : freshChat.scene?.timePhase || undefined

      // The engine-rendered ledger of a live intimate scene — clothing, contact, and arousal the app
      // tracks itself, stated as fact rather than left to the model's memory of scrollback.
      const sceneStateLine = speakerSceneActive
        ? sceneStateBlock({
            charName: speaker.card.name,
            userName: persona?.name || 'You',
            location: promptLocation,
            timePhase: promptTimePhase,
            day: world?.currentDay,
            activity: promptScene!.activityLabel,
            sceneTurns:
              promptScene!.startedAtTurn === undefined ? undefined : charReplyCount - promptScene!.startedAtTurn,
            turnNow: charReplyCount,
            clothing: clothingOf(promptScene!, speaker.id),
            contactRegions: promptScene!.contactRegions,
            contact: promptScene!.contact,
            // Reads through `arousalOf`, so a scene persisted before the meter existed still states a band.
            arousalBand: sceneArousalBand(promptScene!, speaker.id),
            // Everyone else in the scene, each with their own clothing and band — in a group scene
            // "who is where, and how far along" is exactly what the model cannot hold on its own.
            participants: sceneParticipants(promptScene!)
              .filter((id) => id !== speaker.id)
              .map((id) => ({
                id,
                name: allCharactersById.get(id)?.card.name ?? id,
                clothing: clothingOf(promptScene!, id),
                arousalBand: sceneArousalBand(promptScene!, id),
              })),
          })
        : ''

      // Compact, always-computed ledger of concrete scene facts, consolidated into one block instead
      // of scattered across separate lines. Whatever the state block above is already asserting is
      // withheld here: the same fact stated twice in one prompt is noise, and two copies can drift.
      const sceneContinuityLine = sceneContinuityNote({
        location: sceneStateLine ? undefined : promptLocation,
        timePhase: sceneStateLine ? undefined : promptTimePhase,
        presentNames: roster.map((c) => c.card.name),
        currentActivity: sceneStateLine ? undefined : freshChat.activeEvent?.title,
        openThreads: activeFacts.filter((f) => f.unresolved).map((f) => f.text),
      })

      // Messages already folded into chat.summary are represented there, not sent verbatim.
      const cutoff = freshChat.summaryUpToTimestamp ?? 0
      const createdAtById = new Map(messages.map((m) => [m.id, m.createdAt]))
      const unsummarizedHistory = cutoff
        ? historyForPrompt.filter((m) => (createdAtById.get(m.id) ?? Infinity) > cutoff)
        : historyForPrompt
      const recentHistory = unsummarizedHistory.filter((m) => !missedIds.has(m.id))

      // Impersonating {{user}}'s line withholds every steer built for {{char}}'s reply; world/persona/history context and plain style rules still apply.
      const impersonating = !!opts?.impersonateAsUser
      const pendingTasks = activeObjective?.tasks.filter((t) => t.status === 'pending') ?? []
      const objectiveForPrompt =
        !impersonating && activeObjective && pendingTasks.length > 0
          ? {
              title: activeObjective.title,
              description: activeObjective.description,
              pendingTasks: pendingTasks.map((t) => t.description),
            }
          : undefined
      // Only meaningful when the primary is actually speaking — it's specific to {{user}}'s relationship with the primary.
      const relationshipDescription =
        !impersonating &&
        modules.relationships && effectiveAssistFlag(freshChat.assistOverrides?.autoTrackRelationship, autoTrackRelationship) &&
        speaker.id === character.id
          ? buildRelationshipDescription(freshChat, world, character, romanceEmphasis)
          : undefined
      // Someone new to the story doesn't know the names of people they haven't been introduced to.
      const strangerLine = strangerNote(speaker.card.name, stillStrangers(speaker.id, freshChat.strangers?.[speaker.id], messages, (id) =>
        allCharactersById.get(id)?.card.name ?? (id === playerCharacter?.id ? playerCharacter.card.name : undefined)).flatMap((id) => {
        const name = allCharactersById.get(id)?.card.name ?? (id === playerCharacter?.id ? playerCharacter.card.name : undefined)
        return name ? [name] : []
      }))
      // The non-primary counterpart to the line above, so another speaking participant doesn't borrow the primary's own romantic warmth.
      const participantGuidance =
        modules.relationships && !impersonating && speaker.id !== character.id
          ? participantRelationshipGuidance({
              speakerName: speaker.card.name,
              personaName: persona?.name || 'You',
              primaryName: character.card.name,
              warmth: speakerWarmth,
              archetype: findArchetypeMatch(
                [character.card.name, persona?.name].filter((n): n is string => !!n),
                [{ connections: character.socialConnections }, { connections: speaker.socialConnections }],
              ),
              // `Chat.commitmentStatus`/`sceneFlags` are always the PRIMARY's own copies (never a
              // non-primary participant's), exactly what a rival's tone should be reading off —
              // see `rivalCommitmentFraming`/`rivalJealousyIntensifier`'s own doc comments.
              primaryCommitmentStatus: freshChat.commitmentStatus,
              jealousyFlagActive: (freshChat.sceneFlags ?? []).includes('jealousy'),
              emphasis: romanceEmphasis,
            })
          : undefined
      // Names back to the model the specific AI-prose tells and verbatim repeats this character
      // has just used, so it has something concrete to avoid rather than a generic "write well"
      // line it will agree with and ignore. Costs zero tokens when the recent turns are clean.
      const slopAvoidance = buildSlopAvoidanceNote(
        recentHistory.filter((m) => m.role === 'char' && m.name === speaker.card.name).map((m) => m.text),
        { extraPatterns: intimacyLevel === 'explicit' ? EXPLICIT_ANTI_PATTERN_ENTRIES : undefined },
      )
      // How long this speaker's turns should run, in a unit the model can count (sentences), taken
      // from their `replyLength` override or measured from their own example dialogue. The matching
      // hard token cap lives in `runGeneration` so brevity survives a model that ignores the line.
      const replyLengthInstruction = resolveReplyLength(speaker.replyLength, speaker.card).instruction
      const activityInitiativeGuidance =
        speakerWarmth >= 20 && charReplyCount >= 3
          ? `Do not only react: let ${speaker.card.name} sometimes suggest something that fits their own interests or routine.`
          : ''
      // "Repeated same interaction → diminishing returns": if the player has leaned on the same
      // intent chip several turns running, tell the character to notice rather than keep being moved.
      // `messages` here is a turn behind (this turn's user line is created but not yet re-queried),
      // so `opts.intent` is the current turn folded in.
      const priorUserIntents = messages.filter((m) => m.role === 'user').map((m) => m.intent as string | undefined)
      const repeatNudge = repeatedIntentNudge(
        trailingIntentRun([...priorUserIntents, opts?.intent]),
        speaker.card.name,
        persona?.name || 'You',
      )
      // Every built-in system prompt already forbids em dashes, so the standalone line is pure redundancy when one is active.
      const builtinSystemPrompt = BUILTIN_SYSTEM_PROMPTS.find((p) => p.id === freshChat.assistOverrides?.systemPromptId)
      const emDashRule =
        avoidEmDashes && !builtinSystemPrompt
          ? 'Never use em dashes (the — character) in your writing. Use a comma, period, or parentheses instead.'
          : ''
      // Narration in *asterisks* (drawn in italics) and speech in "quotes" is how every reply is
      // shown, voiced, and exported, so every speaker is asked for it, whatever their card's examples
      // look like. Only the Companion chat style, deliberately plain texting, is left out of it.
      const markupRule = isVisualNovel || builtinSystemPrompt?.id !== 'companion'
        ? 'Format with Markdown: put every action and piece of narration in *asterisks* (it is shown in italics) and every line of spoken dialogue in "quotes". Close every mark you open: no half-quoted sentence, no narration sentence left bare between two quoted lines.'
        : ''
      // One line, tagged essential or not — replaces what used to be a flat `.filter(Boolean).join`
      // of every guidance line, unconditionally, regardless of how small `sampler.max_context_length`
      // was. `buildPrompt` only ever paid for that block by trimming `history`, so a small-context
      // model running VN mode with an active scene could lose most of its history to a steering
      // block bigger than the reply it was steering — the history window shrank around a
      // fixed-size "how to write this" block instead of the two ever trading off against each other.
      //
      // `essential: true` is content policy, format rules, the user's own settings, and anything
      // stating concrete engine state (the scene ledger, an active event, group-scene correctness) —
      // dropping those would make the reply contradict what the UI is already showing. Everything
      // else is "character mind" texture: it colours a reply but doesn't break it if thin, so it's
      // what `buildPrompt` sheds first when a tight context budget needs the room back, listed here
      // most-to-least valuable — see that function's drop loop for why order matters.
      const guidance = (text: string, essential = false): StyleGuidanceItem[] => (text ? [{ text, essential }] : [])
      const styleGuidanceItems: StyleGuidanceItem[] = impersonating
        ? // Impersonation only gets the rules that shape prose, not {{char}}'s behaviour/phrasing —
          // three short essential lines, nothing here is ever worth dropping.
          [...guidance(emDashRule, true), ...guidance(styleGuidanceNote.trim(), true), ...guidance(opts?.extraStyleGuidance ?? '', true)]
        : [
            ...guidance(emDashRule, true),
            ...guidance(markupRule, true),
            ...guidance(romancePolicy.naturalGuidance, true),
            ...guidance(
              romancePolicy.proactive && effectiveAssistFlag(freshChat.assistOverrides?.slowBurnPacing, slowBurnPacing)
                ? slowBurnPacingNote(speaker.card.name, speakerTrack.mood, speakerHoldingBackByPlan)
                : '',
              true,
            ),
            ...guidance(romancePolicy.intimacyContent ? intimacyGuidance(intimacyLevel) : '', true),
            ...guidance(vnProseLine, true),
            ...guidance(romancePolicy.intimacyOptions ? intimacyOptions : '', true),
            ...guidance(romancePolicy.proactive ? activityInitiativeGuidance : '', true),
            ...guidance(romancePolicy.aftercare ? afterglowLine : '', true),
            ...guidance(romancePolicy.aftercare ? explicitAftercareLine : '', true),
            // Character-mind texture, most- to least-valuable — dropped from the bottom of this
            // run first (see `buildPrompt`'s drop loop), so mood (closest to voice) survives longest.
            ...guidance(moodLine),
            ...guidance(needLine),
            ...guidance(beliefsLine),
            ...guidance(expectationsLine),
            ...guidance(plansLine),
            ...guidance(romancePolicy.guards ? rebuffLine : ''),
            ...guidance(romancePolicy.guards ? reciprocityLine : ''),
            ...guidance(romancePolicy.guards ? stockRomancePhrasingLine : ''),
            ...guidance(romancePolicy.proactive ? escalationShapeLine : ''),
            ...guidance(romancePolicy.proactive ? intimacyAnticipationLine : ''),
            ...guidance(repeatNudge ?? ''),
            ...guidance(romancePolicy.proactive ? earlyEscalationLine : ''),
            ...guidance(romancePolicy.proactive ? intentLine : ''),
            ...guidance(fearLine),
            ...guidance(desireLine),
            ...guidance(romancePolicy.proactive ? priorityLine : ''),
            // Back to essential: mechanics, safety guards, and concrete engine state.
            ...guidance(agencyGuardLine, true),
            ...guidance(sceneContinuityLine, true),
            ...guidance(romancePolicy.scene ? intimacySceneLine : '', true),
            ...guidance(romancePolicy.scene ? explicitSceneLine : '', true),
            ...guidance(romancePolicy.scene ? intimacyConsentTensionLine : '', true),
            ...guidance(sceneNudge, true),
            ...guidance(scheduleConflictLine, true),
            ...guidance(triggerStyleLine, true),
            ...guidance(ambientLine, true),
            ...guidance(participantGuidance ?? '', true),
            ...guidance(strangerLine, true),
            ...guidance(replyLengthInstruction, true),
            ...guidance(styleGuidanceNote.trim(), true),
            ...guidance(slopAvoidance ?? '', true),
            ...guidance(expressionRepeatLine, true),
            ...guidance(romancePolicy.scene ? sceneStateLine : '', true),
            ...guidance(opts?.extraStyleGuidance ?? '', true),
          ]

      const contextBudget = sampler.max_context_length - sampler.max_length - 32
      // Earlier scenes this speaker was actually there for, read fresh so a just-ended scene counts.
      const scenesForRecap = freshChat.storyId ? await storiesApi.scenes(freshChat.storyId).catch(() => storyScenes) : []
      const storyForRecap = freshChat.storyId ? await storiesApi.get(freshChat.storyId) : undefined
      const storyRecap = storyRecapBlock(sceneChain(scenesForRecap, freshChat), { characterId: speaker.id }, {
        maxTokens: Math.floor(contextBudget * 0.15),
        speakerName: speaker.card.name,
        chapters: chaptersOf(storyForRecap, scenesForRecap),
      })
      const built: PromptInspection = await buildPrompt({
        character: speaker.card,
        characterPromptItems: speaker.promptItems,
        worldPromptItems: world?.promptItems,
        characterProfile: [buildCharacterProfileNote(speaker), appearanceNote(speaker.card.name, speaker.outfits, speakerOutfitId, speaker.baseForm), speaker.privateMemory?.trim() ? `Private memory for ${speaker.card.name}: ${speaker.privateMemory.trim()}` : '', memoryText].filter(Boolean).join('\n\n'),
        personaName: persona?.name || 'You',
        personaDescription: persona?.description || '',
        globalSystemPrompt,
        chatSystemPrompt: builtinSystemPrompt?.prompt,
        globalPostHistory,
        history: recentHistory,
        chatSummary: missedSummarized ? undefined : freshChat.summary,
        storyRecap,
        worldDescription,
        worldMoment,
        lorebooks: [...worldLorebook, ...lorebooks, ...boundBooks, ...factsLorebook],
        template: speakerTemplate,
        contextBudget: Math.max(contextBudget, 256),
        scanDepth: 8,
        promptSections,
        countTokens,
        continueLastTurn: opts?.continueLastTurn,
        impersonateAsUser: opts?.impersonateAsUser,
        includeSectionBreakdown: opts?.includeSectionBreakdown,
        worldInfoState: freshChat.worldInfoState ?? {},
        worldInfoTurn: messages.length,
        activeObjective: objectiveForPrompt,
        relationshipDescription,
        styleGuidanceItems,
        authorNote: freshChat.authorNote,
        regexScripts,
        sceneOptions: {
          // Only ask for what something is actually going to render. The full instruction — the
          // format line plus every valid id — costs around 245 tokens of context on every single
          // turn, and outside Visual Novel mode most of it is spent on a stage nobody is looking
          // at: no background is drawn, and the sprite (so the expression and the outfit picking
          // it) only appears while a live date or hangout is running, via `ReactivePortrait`. Mood
          // is the exception and stays asked for either way, because `resolveBgmTrack` uses it to
          // pick the background music, which plays in both modes.
          //
          // Switching a chat into VN mode later is self-correcting: the stage reads the most recent
          // tag, so it starts neutral and picks up the real scene from the next reply — the same
          // state a brand-new chat's first message already leaves it in.
          //
          expressionIds: wantsFullSceneTag ? getUnlockedExpressionIds(speaker, speakerTrack.affection ?? 0) : [],
          backgroundIds: wantsFullSceneTag ? getUnlockedBackgroundIds(world, affection) : [],
          // Only ask for a mood tag when this world actually has music to drive with it.
          moodIds: world?.music && Object.keys(world.music).length > 0 ? SCENE_MOOD_IDS : undefined,
          // A character with no outfit art gets a single-entry list, treated as no choice.
          outfitIds: wantsFullSceneTag
            ? selectableOutfitIds(speaker.outfits, speaker.sprites, speakerTrack.affection ?? 0, new Set(freshChat.sceneFlags ?? []))
            : [],
          formIds: wantsFullSceneTag
            ? (speaker.outfits ?? [])
              .filter(isPhysicalForm)
              .filter((outfit) => selectableOutfitIds(speaker.outfits, speaker.sprites, speakerTrack.affection ?? 0, new Set(freshChat.sceneFlags ?? [])).includes(outfit.id))
              .map((outfit) => outfit.id)
            : [],
          currentOutfitId: speakerOutfitId,
        },
        affection,
        participants: sceneRoster.length ? sceneRoster.map((c) => ({ name: c.card.name })) : undefined,
        nextSpeakerName: speaker.card.name,
      })
      // Prompt Inspector only: why each memory reached this speaker, and what the witness rule held back.
      if (opts?.includeSectionBreakdown && memoryOn) {
        const names = new Map([speaker, ...roster, ...(character ? [character] : []), ...participantCharacters].map((c) => [c.id, c.card.name]))
        const knownCount = memoriesKnownBy(sceneMemories, speaker.id).filter((m) => typeof m.text === 'string' && m.text.trim()).length
        const journalText = memoryJournal?.text?.trim()
        built.memoryPicks = memoryPicks.map(({ memory, reasons }) => ({
          id: memory.id,
          text: memory.text,
          kind: memory.kind,
          reasons,
          aboutNames: reasons.aboutPresent.flatMap((id) => names.get(id) ?? []),
        }))
        if (journalText) built.memoryJournal = journalText
        built.memorySkipped = Math.max(0, knownCount - memoryPicks.length)
        built.memoryWitnessFilter = { hiddenMessages: unsummarizedHistory.length - recentHistory.length }
      }
      return built
    },
    [
      activeFacts,
      activeObjective,
      allCharactersById,
      autoTrackRelationship,
      avoidEmDashes,
      character,
      characterMemoryOn,
      chat,
      countTokens,
      globalIntimacyLevel,
      globalPostHistory,
      globalSystemPrompt,
      messages,
      participantCharacters,
      persona,
      playerCharacter,
      promptSections,
      regexScripts,
      resolveSpeaker,
      sampler,
      slowBurnPacing,
      styleGuidanceNote,
      template,
      templateFor,
      replyJobFor,
      world,
      worldInfoBooks,
    ],
  )

  const updateMemorySummary = useCallback(
    async (opts?: { force?: boolean }): Promise<string | null> => {
      if (!chat || !character || summarizingRef.current) return chat?.summary ?? null
      const eligible = messages.slice(0, Math.max(0, messages.length - keepRecentMessages))
      const already = chat.summaryUpToTimestamp ?? 0
      const newBatch = eligible.filter((m) => m.createdAt > already && m.text.trim())
      if (newBatch.length === 0) return chat.summary ?? null
      if (!opts?.force && newBatch.length < MIN_BATCH_FOR_AUTO_SUMMARY) return chat.summary ?? null

      summarizingRef.current = true
      try {
        const updated = await summarizeMessages({
          existingSummary: chat.summary ?? '',
          messages: newBatch.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text })),
          charName: character.card.name,
          userName: persona?.name || 'You',
          detail: summaryDetail,
          voiceFingerprint: character.voiceFingerprint,
          generate: (prompt) =>
            generateWithTimeout(
              memoryClient,
              {
                prompt,
                max_length: SUMMARY_MAX_LENGTH[summaryDetail],
                max_context_length: sampler.max_context_length,
                temperature: 0.4,
                top_p: 1,
                top_k: 0,
                min_p: 0,
                typical: 1,
                tfs: 1,
                rep_pen: 1.1,
                rep_pen_range: 1024,
                rep_pen_slope: 0.7,
              },
              'Update memory summary',
              undefined,
              jobShaping.memory,
            ),
        })
        const summaryUpToTimestamp = newBatch[newBatch.length - 1].createdAt
        await chatsApi.update(chat.id, { summary: updated, summaryUpToTimestamp })
        return updated
      } finally {
        summarizingRef.current = false
      }
    },
    [character, chat, memoryClient, keepRecentMessages, messages, persona, sampler.max_context_length, summaryDetail],
  )

  /** Marks the given indices (into `pending`) done on `objective`. Shared by the standalone task-detection pass and the merged pass in `runGeneration`. */
  const applyCompletedTasks = useCallback(async (objective: Objective, pending: ObjectiveTask[], completedIndices: number[]) => {
    const completedIds = new Set(completedIndices.map((i) => pending[i].id))
    const now = Date.now()
    const updatedTasks = objective.tasks.map((t) => (completedIds.has(t.id) ? { ...t, status: 'done' as const, completedAt: now } : t))
    await objectivesApi.update(objective.id, { tasks: updatedTasks })
  }, [])

  /**
   * The memory scribe (`memory/scribe.ts`): reads the messages since it last ran and records what
   * each character will remember. Who witnessed a message comes from the presence stamped on it,
   * never from the model. Best effort: a failed call leaves the watermark, so the next run retries.
   * A chat's first run only reads its most recent messages; older history stays with the summary.
   */
  /**
   * With the world's "Advance time while role playing" ticked (#51), moves the shared world clock to
   * where the story says time has gone. Each text is read from the same starting time and the latest
   * wins, so a player's "the next morning" and the GM narrating that morning move it once. `step`
   * moves it one part of the day instead (a scene ending). The scene's own time of day is set to
   * match, so the reply being written right now already reads the new time. Never throws.
   */
  const followStoryTime = useCallback(async (texts: string[], opts?: { step?: boolean; sceneId?: string }): Promise<boolean> => {
    try {
      if (!world?.advanceClockInPlay || !modulesForWorld(world).worldSimulation) return false
      const fresh = await worldsApi.get(world.id)
      if (!fresh?.advanceClockInPlay) return false
      const from = { day: fresh.currentDay ?? 0, phaseIndex: fresh.currentPhaseIndex ?? 0 }
      const later = (a: typeof from, b: typeof from) => (b.day > a.day || (b.day === a.day && b.phaseIndex > a.phaseIndex) ? b : a)
      const next = opts?.step
        ? advancePhase(from.day, from.phaseIndex)
        : texts.map((t) => clockAfterNarration(from.day, from.phaseIndex, t)).reduce<typeof from | undefined>((best, t) => (t ? (best ? later(best, t) : t) : best), undefined)
      if (!next) return false
      await worldsApi.update(world.id, { currentDay: next.day, currentPhaseIndex: next.phaseIndex })
      const sceneId = opts?.sceneId ?? chatId
      const scene = sceneId ? await chatsApi.get(sceneId) : undefined
      if (scene && scene.scene?.timePhase !== PHASES[next.phaseIndex]) {
        await chatsApi.update(scene.id, { scene: { turnPolicy: 'manual', ...scene.scene, timePhase: PHASES[next.phaseIndex] } })
      }
      toastInfo(`Time moves on: ${PHASES[next.phaseIndex]}, ${formatCalendarDate(getCalendarInfo(next.day, fresh.calendar))}.`)
      return true
    } catch {
      return false
    }
  }, [chatId, world])

  const scribeMemories = useCallback(async (opts?: { flush?: boolean }) => {
    if (!chatId || !character || !characterMemoryOn) return
    if (scribingRef.current) {
      if (!opts?.flush) return
      for (let waited = 0; scribingRef.current && waited < 60_000; waited += 250) await new Promise((r) => setTimeout(r, 250))
      if (scribingRef.current) return
    }
    scribingRef.current = true
    try {
      for (let round = 0; round < (opts?.flush ? 4 : 1); round++) {
        const fresh = await chatsApi.get(chatId)
        if (!fresh || fresh.endedAt) return
        const branch = await messagesApi.listByChat(chatId)
        const unread = branch.filter((m) => m.createdAt > (fresh.memoryScribedUpTo ?? 0) && !m.failed && m.text.trim())
        if (!unread.length) return
        const batch = (fresh.memoryScribedUpTo === undefined ? unread.slice(-SCRIBE_BATCH) : unread.slice(0, SCRIBE_BATCH))
        const cards = [character, ...participantCharacters, ...arrivalsRef.current, ...(playerCharacter ? [playerCharacter] : [])]
        const cast = [...new Map(cards.map((c) => [c.id, { id: c.id, name: c.card.name }])).values()]
        const playerName = persona?.name || 'You'
        const messagesForScribe = batch.map((m, i) => ({
          n: i + 1,
          id: m.id,
          name: m.role === 'user' ? playerName : m.name,
          text: m.text,
          witnessIds: messageWitnesses(m, fresh).filter((id) => id !== GM_SPEAKER_ID),
        }))
        const involved = new Set(messagesForScribe.flatMap((m) => m.witnessIds))
        const known = (await memoriesApi.forChat(chatId).catch(() => []))
          .filter((m) => m.active && m.kind !== 'journal' && m.knownBy.some((id) => involved.has(id)))
          .slice(-20)
        const input = {
          guidance: promptOverride(world?.promptOverrides, 'scribe'),
          worldName: world?.name,
          playerName,
          playerId: fresh.playerCharacterId,
          cast,
          messages: messagesForScribe,
          existing: known.map((m, i) => ({ n: i + 1, id: m.id, text: m.text, knownByIds: m.knownBy, unresolved: m.unresolved })),
        }
        const raw = await generateWithTimeout(
          memoryClient,
          {
            prompt: buildScribePrompt(input),
            max_length: 700,
            max_context_length: sampler.max_context_length,
            temperature: 0.3,
            top_p: 1,
            top_k: 0,
            min_p: 0,
            typical: 1,
            tfs: 1,
            rep_pen: 1.05,
            rep_pen_range: 1024,
            rep_pen_slope: 0.7,
          },
          'Record character memories',
          undefined,
          jobShaping.memory,
        )
        const result = parseScribeResponse(raw, input)
        if (result.add.length) {
          await memoriesApi.createMany(result.add.map((a) => ({
            chatId,
            text: a.text,
            kind: a.kind,
            importance: a.importance,
            witnesses: a.witnessIds,
            about: a.aboutIds,
            feelings: a.feelings,
            unresolved: a.unresolved,
            certainty: a.certainty,
            sourceMessageId: a.messageId,
            origin: 'scribe' as const,
          })))
        }
        await Promise.all([
          ...result.told.map((t) => memoriesApi.share(t.memoryId, { to: t.toIds, by: t.byId, messageId: t.messageId, chatId }).catch(() => {})),
          ...result.retire.map((r) => memoriesApi.update(r.memoryId, { active: false, retiredReason: r.reason }).catch(() => {})),
          ...result.resolve.map((id) => memoriesApi.update(id, { unresolved: false }).catch(() => {})),
        ])
        await memoriesApi.setWatermark(chatId, batch[batch.length - 1].createdAt, fresh.memoryScribedUpTo ?? null)
        if (batch.length < unread.length && fresh.memoryScribedUpTo !== undefined) continue
        return
      }
    } finally {
      scribingRef.current = false
    }
  }, [jobShaping.memory, character, characterMemoryOn, chatId, memoryClient, participantCharacters, persona?.name, playerCharacter, sampler.max_context_length, world?.name])

  /**
   * When a scene ends, each character there folds their older, settled memories into their own
   * journal (`memory/journal.ts`), so a long campaign stays a short read for every one of them.
   */
  const writeJournals = useCallback(async (sceneId: string, characterIds: string[]) => {
    if (!characterMemoryOn) return
    const all = await memoriesApi.forChat(sceneId)
    for (const id of characterIds) {
      const card = allCharactersById.get(id) ?? arrivalsRef.current.find((c) => c.id === id)
      if (!card || id === playerCharacter?.id) continue
      const toFold = pickForJournal(all, id)
      if (!toFold.length) continue
      const raw = await generateWithTimeout(
        memoryClient,
        {
          prompt: buildJournalPrompt({
            guidance: promptOverride(world?.promptOverrides, 'journal'),
            name: card.card.name,
            previousJournal: latestJournal(all, id)?.text,
            toFold: toFold.map((m) => ({ text: m.text, feeling: m.feelings?.[id] })),
            worldName: world?.name,
          }),
          max_length: 400,
          max_context_length: sampler.max_context_length,
          temperature: 0.4,
          top_p: 1,
          top_k: 0,
          min_p: 0,
          typical: 1,
          tfs: 1,
          rep_pen: 1.1,
          rep_pen_range: 1024,
          rep_pen_slope: 0.7,
        },
        'Update character journal',
        undefined,
        jobShaping.memory,
      ).catch(() => '')
      const text = parseJournalResponse(raw)
      if (!text) continue
      await memoriesApi.create({ chatId: sceneId, kind: 'journal', text, witnesses: [id], importance: 1, origin: 'journal' })
      await memoriesApi.consolidate(id, toFold.map((m) => m.id))
    }
  }, [allCharactersById, jobShaping.memory, characterMemoryOn, memoryClient, playerCharacter?.id, sampler.max_context_length, world?.name])

  /** Checks whether the reply that just landed completed any pending objective tasks. Standalone path only — see `runGeneration` for the merged one. */
  const detectAndMarkTasks = useCallback(
    async (chatIdForTasks: string, replyText: string) => {
      const objective = await objectivesApi.getActive(chatIdForTasks)
      if (!objective) return
      const pending = objective.tasks.filter((t) => t.status === 'pending')
      if (pending.length === 0) return
      const completedIndices = await detectCompletedTasks(
        trackingClient,
        replyText,
        pending.map((t) => t.description),
        jobShaping.tracking,
      )
      if (completedIndices.length === 0) return
      await applyCompletedTasks(objective, pending, completedIndices)
    },
    [trackingClient, applyCompletedTasks],
  )

  /** Scores relationship movement for whichever character actually just spoke, reading/writing their own track (`stage.ts`). `pendingTasks`, when passed, rides along in the same judge call and its completed indices are handed back for the caller to apply. */
  const updateAffectionFromReply = useCallback(
    async (
      chatIdForRelationship: string,
      history: ChatMessage[],
      latestReply: string,
      intent: MessageIntent | undefined,
      speaker: Character,
      pendingTasks?: ObjectiveTask[],
    ): Promise<number[]> => {
      const freshChat = await chatsApi.get(chatIdForRelationship)
      if (!freshChat) return []
      const isPrimary = speaker.id === freshChat.characterId
      const track = getRelationshipTrack(freshChat, speaker.id)
      const currentAffection = track.affection ?? 0
      const currentStats = getRelationshipStats(track)
      const existingFlags = new Set((freshChat.sceneFlags ?? []) as SceneFlag[])
      // Aftercare window's transcript rides along in this same judge call — no extra model round-trip.
      const openAfterglow = track.afterglow ?? undefined
      const charRepliesNow = countCharReplies(messages)
      const aftercareDue = isAfterglowComplete(openAfterglow, charRepliesNow)
      const aftercareWindow = aftercareDue ? history.slice(-(AFTERGLOW_TURNS * 2 + 2)) : undefined
      // Stable index order so the judge can mark one closed via `resolvedFactIndices`.
      const openThreads = activeFacts.filter((f) => f.unresolved)
      const activePlans = track.plans ?? []
      // Same ride-along trick as aftercare/pending tasks — only asked for while a scene is active.
      //
      // The scene is looked up chat-wide rather than off this speaker's own track: one scene is
      // shared by everyone in it (`sceneParticipants.ts`) and lives on its owner's track, so a
      // second character speaking mid-scene has to advance *that* scene. Reading `track` here would
      // have them find nothing, start their own, and the two would disagree from then on.
      const activeScene = findActiveIntimacyScene(freshChat, (s: IntimacyScene) => isIntimacySceneActive(s, charRepliesNow))
      // Being in the room is not the same as being in the scene. Only a participant's own turn is a
      // turn *of* the scene, so a third character speaking nearby neither gets asked for an
      // observation about it nor moves anyone's meter.
      const sceneForSpeaker =
        activeScene && isSceneParticipant(activeScene.scene, speaker.id, activeScene.ownerId) ? activeScene : undefined
      const openScene = sceneForSpeaker?.scene ?? track.intimacyScene ?? undefined
      const sceneActive = isIntimacySceneActive(openScene, charRepliesNow)
      // Whose track the scene is written back to. Its owner while this speaker is in one, and this
      // speaker otherwise (a scene they are about to start belongs to them).
      const sceneOwnerId = sceneForSpeaker?.ownerId ?? speaker.id
      const sceneRoster = sceneActive ? sceneParticipants(openScene!) : []
      /** Everyone in the scene besides its owner — whose meters this turn also has to advance. */
      const otherParticipants = sceneRoster.slice(1)
      const activeBeliefs = track.beliefsAboutUser ?? []
      const activeExpectations = track.expectationsOfUser ?? []
      const {
        deltas: rawDeltas,
        newFlags,
        reason,
        newFacts,
        resolvedFactIndices,
        completedTaskIndices,
        aftercareVerdict,
        mood,
        currentNeed,
        characterIntent,
        planUpdates,
        intimacyObservation,
        beliefUpdates,
        expectationUpdates,
        currentFear,
        currentDesire,
      } = await assessRelationshipMoment(trackingClient, {
        history,
        latestReply,
        charName: speaker.card.name,
        userName: persona?.name || 'You',
        current: { affection: currentAffection, ...currentStats },
        knownFacts: activeFacts.map((f) => f.text),
        unresolvedFacts: openThreads.map((f) => f.text),
        activePlans: planLinesForJudge(activePlans),
        customFlags: world?.customSceneFlags,
        intent,
        pendingTasks: pendingTasks?.map((t) => t.description),
        currentMood: track.mood,
        currentNeed: track.currentNeed,
        currentIntent: track.characterIntent,
        currentFear: track.currentFear,
        currentDesire: track.currentDesire,
        aftercareTurns: aftercareWindow,
        aftercarePaceContext: aftercareDue
          ? aftercarePaceContext(openAfterglow?.momentumAtStart, openAfterglow?.sceneAtResolve)
          : undefined,
        currentIntimacyPhase: sceneActive ? openScene!.phase : undefined,
        intimacyStance: sceneActive ? stanceOfScene(openScene!) : undefined,
        // Only a genuinely shared scene needs the contact graph; with one character in it the
        // two-party fields say whose body they mean on their own.
        sceneParticipants: sceneRoster.length > 1
          ? sceneRoster.map((id) => ({ id, name: allCharactersById.get(id)?.card.name ?? id }))
          : undefined,
        activeBeliefs: beliefLinesForJudge(activeBeliefs),
        activeExpectations: expectationLinesForJudge(activeExpectations),
        // Everyone else actually in the scene besides whoever's speaking — present for a jealousy beat to land in front of, not just be discussed.
        presentParticipants: [...(character ? [character] : []), ...participantCharacters]
          .filter((c) => c.id !== speaker.id)
          .map((c) => c.card.name),
      }, jobShaping.tracking)
      // A due window always closes even with no verdict — an unusable answer reads as the middle outcome, not "ask again next turn".
      const resolvedAftercare = aftercareDue ? (aftercareVerdict ?? 'awkward') : undefined
      // Same intent chip played 3+ turns running scales positive gains toward nothing (a bad move/friction still passes through).
      const userIntents = messages.filter((m) => m.role === 'user').map((m) => m.intent as string | undefined)
      if (userIntents[userIntents.length - 1] !== intent) userIntents.push(intent)
      const scaledDeltas = scaleDeltasForDifficulty(
        resolvedAftercare
          ? (Object.fromEntries(
              (['affection', ...RELATIONSHIP_DIMENSIONS] as const).map((k) => [
                k,
                rawDeltas[k] + aftercareDeltas(resolvedAftercare)[k],
              ]),
            ) as typeof rawDeltas)
          : rawDeltas,
        relationshipDifficulty,
      )
      const deltas = trailingIntentRun(userIntents) >= 3 ? dampenRepeatedDeltas(scaledDeltas) : scaledDeltas
      newFlags.forEach((flag) => existingFlags.add(flag))
      if (newFacts.length > 0) {
        const sourceMessageId = history[history.length - 1]?.id
        for (const f of newFacts) {
          chatFactsApi
            .create({
              chatId: chatIdForRelationship,
              text: f.text,
              sourceMessageId,
              importance: f.importance,
              valence: f.valence,
              unresolved: f.unresolved || undefined,
            })
            .catch(() => {})
        }
      }
      for (const i of resolvedFactIndices) {
        const closed = openThreads[i]
        if (closed) chatFactsApi.update(closed.id, { unresolved: false }).catch(() => {})
      }
      const affection = clampAffection(currentAffection + deltas.affection)
      let nextStats = { ...currentStats }
      for (const dim of RELATIONSHIP_DIMENSIONS) nextStats[dim] = clampStat(currentStats[dim] + deltas[dim])
      const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
      const previousStage = relationshipStageForWarmth(computeWarmth(currentAffection, currentStats), milestones)
      const risk = applyRelationshipRisk({
        charName: speaker.card.name,
        commitmentStatus: track.commitmentStatus ?? 'none',
        stats: nextStats,
        existingWarning: track.relationshipWarning ?? undefined,
        breakupCount: track.breakupCount ?? 0,
      })
      nextStats = risk.stats
      const warmth = computeWarmth(affection, nextStats)
      const relationshipStage = relationshipStageForWarmth(warmth, milestones)
      const unlockedSet = new Set(track.unlockedGalleryIds ?? [])
      const previouslyUnlockedIds = new Set(unlockedSet)
      // Endings unlock deterministically off the stage, so they're excluded from `lockedGallery` before the AI CG-matching pass below.
      unlockedEndingIds(speaker.gallery, relationshipStage, unlockedSet).forEach((id) => unlockedSet.add(id))
      const lockedGallery = (speaker.gallery ?? []).filter(
        (g) => !g.isEnding && !unlockedSet.has(g.id) && hasRequiredFlags(g.requiredFlags, existingFlags),
      )
      if (lockedGallery.length > 0) {
        const unlockedIds = await detectGalleryUnlocks(trackingClient, {
          character: speaker,
          locked: lockedGallery,
          affection,
          latestReply,
        }, jobShaping.tracking)
        unlockedIds.forEach((id) => unlockedSet.add(id))
      }
      // Evaluated against the state this turn just produced (not the state it started from), so a "trust >= 70" trigger fires the turn it's reached. Primary's own track only.
      const triggerResult = isPrimary
        ? evaluateTriggers(
            world?.triggers,
            {
              affection,
              warmth,
              stats: nextStats,
              flags: existingFlags,
              commitmentStatus: risk.commitmentStatus,
              day: world?.currentDay,
            },
            freshChat.firedTriggerIds ?? [],
          )
        : undefined
      if (triggerResult) {
        // A rare authoring accident (two rules satisfying the same turn) just takes the first
        // start_scene and ignores the rest, rather than one clobbering the other's activeEvent.
        let sceneStarted = false
        for (const action of triggerResult.actions) {
          if (action.kind === 'set_flag') existingFlags.add(action.flag)
          else if (action.kind === 'remember') {
            chatFactsApi.create({ chatId: chatIdForRelationship, text: action.text }).catch(() => {})
          } else if (action.kind === 'notify') toastInfo(action.text)
          else if (action.kind === 'social_reaction') {
            const reaction = selectSocialReaction({
              characterId: speaker.id,
              chatId: chatIdForRelationship,
              topic: action.topic,
              connections: speaker.socialConnections,
            })
            if (reaction) {
              chatFactsApi
                .create({ chatId: chatIdForRelationship, text: describeSocialReaction(speaker.card.name, reaction) })
                .catch(() => {})
            }
          } else if (action.kind === 'start_scene' && !sceneStarted) {
            sceneStarted = true
            // Not awaited: startDateEvent runs its own beginGeneration() liveness check and
            // gracefully defers with a toast if a generation is already in flight (this turn's own
            // reply), exactly like the marriage/moving-in auto-scene already does via the same ref.
            startDateEventRef.current({
              id: `heart-event-${Date.now()}`,
              title: action.title,
              description: action.description,
              objectiveTitle: action.objectiveTitle,
              objectiveDescription: action.objectiveDescription,
              kind: 'hangout',
              free: true,
            })
          }
        }
      }

      // Recomputed even on a flat turn so a burst actually decays rather than a stale value sticking around.
      const momentum = nextMomentum(track.momentum, warmthDeltaOf(deltas))
      const noMomentumChange = Math.abs(momentum - (track.momentum ?? 0)) < 0.15

      // Item 2's asymmetric-pacing signal: same decayed-running-value shape as momentum above, fed
      // a different per-turn read (who initiated, not how much warmth moved). `intent` is whichever
      // one the player tagged going into this exchange — any tag counts as a deliberate overture.
      const initiativeBalance = nextInitiativeBalance(track.initiativeBalance, initiativeContribution(!!intent, warmthDeltaOf(deltas)))
      const noInitiativeChange = Math.abs(initiativeBalance - (track.initiativeBalance ?? 0)) < 0.15

      // Persistent agency layer: fold `planUpdates` into the plan list (`dating/plans.ts` caps at 3, ages out stale ones).
      const nextPlans = applyPlanUpdates(activePlans, planUpdates, messages.length)
      const noPlanChange = !plansChanged(activePlans, nextPlans)

      const nextBeliefs = applyBeliefUpdates(activeBeliefs, beliefUpdates, messages.length)
      const noBeliefChange = !beliefsChanged(activeBeliefs, nextBeliefs)
      // Read off the pre-update list — `applyExpectationUpdates` has already dropped a resolved entry by the time this runs.
      const violatedTexts = violatedExpectationTexts(activeExpectations, expectationUpdates)
      const nextExpectations = applyExpectationUpdates(activeExpectations, expectationUpdates, messages.length)
      const noExpectationChange = !expectationsChanged(activeExpectations, nextExpectations)

      // Only recomputed while a scene is active; a stale one is carried forward unchanged. Same pace computation `buildCurrentPrompt` uses.
      const pace = intimacyPaceFor(mood ?? track.mood, activePlans.some((p) => p.kind === 'distance'), speaker.boundaries?.length ?? 0)
      // The meter reads the stats as they stand going into this turn — arousal is modulated by the
      // relationship, never the reverse (`arousal.ts`).
      const sceneGraph = scenarioById(getScenarioCatalog(world), openScene?.scenarioId)
      const nextIntimacyScene = sceneActive
        ? advanceIntimacyScene(openScene!, intimacyObservation, charRepliesNow, {
            graph: sceneGraph,
            pace,
            comfort: currentStats.comfort,
            chemistry: currentStats.chemistry,
            sensitivity: speaker.touchProfile?.sensitivity,
            kinks: kinkValenceMap(speaker.kinkProfile),
            // The same state a world's own trigger rules read, so a scenario's shared condition kinds
            // (`intimacyStages.ts`) evaluate identically to a `TriggerCondition` over the same turn.
            relationship: {
              affection,
              warmth,
              stats: nextStats,
              flags: existingFlags,
              commitmentStatus: risk.commitmentStatus,
              day: world?.currentDay,
            },
            // `toyInventory` is id -> count; an entry at zero is not owned.
            ownedItemIds: new Set(Object.entries(freshChat.toyInventory ?? {}).filter(([, n]) => n > 0).map(([id]) => id)),
            // Every other participant's own arousal inputs. Sensitivity, pace, and how they feel
            // about the content are all per-character, so the same turn is worth a different amount
            // to each of them — which is what makes a group scene develop asymmetrically instead of
            // moving everyone in lockstep.
            participants: Object.fromEntries(
              otherParticipants.map((id) => {
                const other = allCharactersById.get(id)
                const otherTrack = getRelationshipTrack(freshChat, id)
                const otherStats = getRelationshipStats(otherTrack)
                return [
                  id,
                  {
                    pace: intimacyPaceFor(
                      otherTrack.mood,
                      (otherTrack.plans ?? []).some((p) => p.kind === 'distance'),
                      other?.boundaries?.length ?? 0,
                    ),
                    comfort: otherStats.comfort,
                    chemistry: otherStats.chemistry,
                    sensitivity: other?.touchProfile?.sensitivity,
                    // Their own feelings about the content, never the owner's — the same entry can be
                    // something one of them is eager for and another merely goes along with.
                    kinkValence: combinedValence(other?.kinkProfile, openScene!.activityKinks),
                  },
                ]
              }),
            ),
          })
        : (openScene ?? null)
      const noSceneChange = JSON.stringify(nextIntimacyScene ?? null) === JSON.stringify(openScene ?? null)
      const sceneJustResolved = sceneActive && !nextIntimacyScene
      // The discovery loop: learning that *this* character answers at the backs of her knees is real
      // play, and it falls out of data the turn already produced rather than needing authored content.
      // Read from the same place the meter is: the flat list in a solo scene, and the contact graph
      // once the scene is shared, where the flat list cannot say whose body it means. Without this
      // the discovery loop silently stops the moment a second character joins.
      const touchedThisTurn = intimacyObservation
        ? sceneRoster.length > 1
          ? contactRegionsFor(advanceContact(openScene?.contact, intimacyObservation.contact ?? [], charRepliesNow, sceneRoster), speaker.id)
          : intimacyObservation.regionsTouched
        : []
      const foundRegions = intimacyObservation
        ? newlyDiscoveredRegions(speaker.touchProfile, touchedThisTurn, track.discoveredRegions as BodyRegion[] | undefined)
        : []
      const nextDiscoveredRegions = withDiscoveredRegions(track.discoveredRegions as BodyRegion[] | undefined, foundRegions)
      const noDiscoveryChange = foundRegions.length === 0

      const noStatChange = Object.values(deltas).every((d) => d === 0)
      const noRiskChange = !risk.warnedJustNow && !risk.brokeUpJustNow && !risk.clearedJustNow
      const noMindChange =
        (!mood || mood === track.mood) &&
        (!currentNeed || currentNeed === track.currentNeed) &&
        (!characterIntent || characterIntent === track.characterIntent) &&
        (!currentFear || currentFear === track.currentFear) &&
        (!currentDesire || currentDesire === track.currentDesire)
      // Coins are granted only at discrete, toasted moments elsewhere (milestones, commitment accepts, objectives, dates) — never a silent per-turn trickle here.
      if (
        noStatChange &&
        noRiskChange &&
        noMindChange &&
        noMomentumChange &&
        noInitiativeChange &&
        noPlanChange &&
        noSceneChange &&
        noDiscoveryChange &&
        noBeliefChange &&
        noExpectationChange &&
        // A resolved window must always be written even on a flat verdict, or `afterglow` stays open forever.
        !resolvedAftercare &&
        !triggerResult?.fired.length &&
        newFlags.length === 0 &&
        unlockedSet.size === (track.unlockedGalleryIds ?? []).length
      ) {
        // A task can still have completed on an otherwise-flat turn — the caller needs these either way.
        return completedTaskIndices
      }
      // The scene's own fields belong to whoever owns the scene, everything else to whoever spoke —
      // usually the same character, but not in a group scene. Split out and applied separately below,
      // because `patchRelationshipTrack` rewrites the whole participant map for a non-primary and two
      // independent calls would each erase the other's entry.
      // Flags a branch recorded on the scene have to outlive it: the scene object is discarded on
      // resolve, so they move to `Chat.sceneFlags` on the turn it ends.
      if (sceneJustResolved) for (const flag of openScene!.sceneFlags ?? []) existingFlags.add(flag as SceneFlag)
      const sceneFields = {
        intimacyScene: nextIntimacyScene,
        // A scene that just resolved this turn gets its final category sequence snapshotted into the log; any other turn carries it forward unchanged.
        intimacySceneShapeLog: sceneJustResolved
          ? appendSceneShapeLog(
              getRelationshipTrack(freshChat, sceneOwnerId).intimacySceneShapeLog,
              openScene!.categoryHistory ?? [openScene!.category],
            )
          : getRelationshipTrack(freshChat, sceneOwnerId).intimacySceneShapeLog,
      }
      const speakerPatch = patchRelationshipTrack(freshChat, speaker.id, {
          affection,
          relationshipStats: nextStats,
          relationshipStage,
          commitmentStatus: risk.commitmentStatus,
          relationshipWarning: risk.relationshipWarning ?? null,
          breakupCount: risk.breakupCount,
          unlockedGalleryIds: [...unlockedSet],
          mood: mood ?? track.mood,
          // A `cold` aftermath leaves an unmet need behind; the judge's own fresher read still wins when it has one.
          currentNeed: currentNeed ?? (resolvedAftercare ? aftercareNeed(resolvedAftercare) : undefined) ?? track.currentNeed,
          characterIntent: characterIntent ?? track.characterIntent,
          currentFear: currentFear ?? track.currentFear,
          currentDesire: currentDesire ?? track.currentDesire,
          momentum,
          initiativeBalance,
          plans: nextPlans,
          beliefsAboutUser: nextBeliefs,
          expectationsOfUser: nextExpectations,
          // A scene that just resolved writes what it looked like onto the still-open window, so the
          // judge's earned-vs-rushed context can read the scene itself and not only its run-up.
          afterglow: resolvedAftercare
            ? null
            : sceneJustResolved && track.afterglow
              ? { ...track.afterglow, sceneAtResolve: sceneResolveSnapshot(openScene!, charRepliesNow) }
              : (track.afterglow ?? null),
          discoveredRegions: nextDiscoveredRegions,
      })
      // Chained rather than merged: each call reads the participant map the previous one produced, so
      // a group scene's writes compose instead of clobbering each other.
      const withScene = { ...freshChat, ...speakerPatch }
      // `patchRelationshipTrack` already merges onto the owner's existing entry, so the scene fields
      // are all this needs to carry.
      const scenePatch = patchRelationshipTrack(withScene, sceneOwnerId, sceneFields)
      // A resolved shared scene tells *everyone* who was in it what it looked like, not only whoever
      // happened to speak last — an aftercare read that can't see the scene falls back to momentum
      // alone, and in a group scene that would be most of the participants.
      let patch: Partial<Chat> = { ...speakerPatch, ...scenePatch }
      if (sceneJustResolved) {
        const snapshot = sceneResolveSnapshot(openScene!, charRepliesNow)
        for (const id of sceneRoster) {
          if (id === speaker.id) continue
          const merged = { ...freshChat, ...patch }
          const theirs = getRelationshipTrack(merged, id)
          if (!theirs.afterglow) continue
          patch = { ...patch, ...patchRelationshipTrack(merged, id, { afterglow: { ...theirs.afterglow, sceneAtResolve: snapshot } }) }
        }
      }
      await chatsApi.update(chatIdForRelationship, {
        ...(triggerResult?.fired.length ? { firedTriggerIds: triggerResult.firedIds } : {}),
        ...patch,
        sceneFlags: [...existingFlags],
      })
      // Scene handoff (the review's §10): a scenario that names a follow-on hands off through the same
      // machinery a world's own `start_scene` trigger action uses, rather than a prose nudge and a
      // hope. Fired once, on the turn the scene actually resolved.
      if (sceneJustResolved) {
        const successor = successorScenario(sceneGraph, getScenarioCatalog(world), {
          arousal: arousalOf(openScene!).value,
          intimacyLevel: resolveIntimacyLevel(world?.intimacyLevel, globalIntimacyLevel),
          visitedStages: openScene!.visitedStages,
          relationship: {
            affection,
            warmth,
            stats: nextStats,
            flags: existingFlags,
            commitmentStatus: risk.commitmentStatus,
            day: world?.currentDay,
          },
        })
        if (successor) {
          startDateEventRef.current({
            id: `scenario-${successor.id}-${Date.now()}`,
            title: successor.title,
            description: '',
            objectiveTitle: successor.title,
            kind: 'hangout',
            free: true,
          })
        }
      }

      // A broken expectation earns a durable fact, negative valence baked in.
      for (const text of violatedTexts) {
        chatFactsApi
          .create({
            chatId: chatIdForRelationship,
            text: `${speaker.card.name} had started expecting ${text}, and it didn't happen.`,
            importance: 0.6,
            valence: -0.5,
          })
          .catch(() => {})
      }
      if (resolvedAftercare) {
        const changed = Object.fromEntries(
          Object.entries(aftercareDeltas(resolvedAftercare)).filter(([, v]) => v !== 0),
        )
        relationshipEventsApi
          .create({
            chatId: chatIdForRelationship,
            characterId: speaker.id,
            reason: aftercareReason(resolvedAftercare),
            deltas: changed,
            sourceMessageId: history[history.length - 1]?.id,
          })
          .catch(() => {})
        const note = aftercareToast(speaker.card.name, resolvedAftercare)
        if (note) {
          if (resolvedAftercare === 'cold') toastInfo(note)
          else toastSuccess(note, { chime: true })
        }
      }
      // Append-only history alongside the running totals — answers "why is trust 62 now". Only logged when a dimension or flag genuinely moved.
      if (!noStatChange || newFlags.length > 0) {
        const changedDeltas = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0))
        relationshipEventsApi
          .create({
            chatId: chatIdForRelationship,
            characterId: speaker.id,
            reason: reason ?? 'The relationship shifted during this exchange',
            deltas: changedDeltas,
            newFlags: newFlags.length ? newFlags : undefined,
            sourceMessageId: history[history.length - 1]?.id,
          })
          .catch(() => {})
      }
      await announceMilestone({
        charName: speaker.card.name,
        personaName: persona?.name || 'You',
        chatId: chatIdForRelationship,
        previousStage,
        relationshipStage,
        sourceMessageId: history[history.length - 1]?.id,
        characterId: speaker.id,
        turnCount: countCharReplies(messages),
      })
      for (const id of unlockedSet) {
        if (previouslyUnlockedIds.has(id)) continue
        const entry = speaker.gallery?.find((g) => g.id === id)
        toastSuccess(entry?.isEnding ? `An ending unlocked: ${entry.title}` : `New gallery scene unlocked: ${entry?.title ?? 'untitled'}`, { chime: true })
      }
      return completedTaskIndices
    },
    [activeFacts, character, trackingClient, participantCharacters, persona?.name, relationshipDifficulty, world],
  )

  // buyGift/buyItem/buyToy/useItem's currency branch, plus the coin writes in
  // `updateAffectionFromReply` and `endDateEvent`, all follow the same GET-compute-PUT shape
  // against the one shared `Chat.giftCoins` wallet. None of that round-trip is atomic on its own,
  // so two of these firing close together (two Shop purchases clicked back-to-back is all it
  // takes) can race: the second's GET reads the balance from *before* the first's PUT committed,
  // and whichever PUT lands last silently overwrites the other's coin delta while both purchases'
  // inventory writes (a different field each) still land — a real item, but its cost evaporates.
  // `getCoinMutex(chatId).run(...)` below serializes every one of these against the others for this
  // chat, so each one's "fresh" read is guaranteed to see the previous one's write. See
  // `coinMutex.ts` for the full repro this was found with.
  const buyGift = useCallback(
    async (giftId: string) => {
      if (!chatId) return
      const item = giftById(giftId, world)
      if (!item) return
      await getCoinMutex(chatId).run(async () => {
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        const coins = freshChat.giftCoins ?? 0
        if (coins < item.price) return
        const inventory = { ...(freshChat.giftInventory ?? defaultGiftInventory(world)) }
        inventory[giftId] = (inventory[giftId] ?? 0) + 1
        await chatsApi.update(chatId, {
          giftCoins: coins - item.price,
          giftInventory: inventory,
        })
      })
    },
    [chatId, world],
  )

  const buyItem = useCallback(
    async (itemId: string) => {
      if (!chatId) return
      const def = itemById(itemId, world)
      if (!def) return
      await getCoinMutex(chatId).run(async () => {
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        const coins = freshChat.giftCoins ?? 0
        if (coins < def.price) return
        const inventory = { ...(freshChat.itemInventory ?? {}) }
        inventory[itemId] = (inventory[itemId] ?? 0) + 1
        await chatsApi.update(chatId, {
          giftCoins: coins - def.price,
          itemInventory: inventory,
        })
      })
    },
    [chatId, world],
  )

  /**
   * Buying a wardrobe state. Unlike a gift, an item or a toy, what this owns is *art* — so it is
   * recorded as a reserved scene flag (`outfitOwnedFlag`) rather than an inventory count: every
   * reader of `isOutfitUnlocked` already threads `chat.sceneFlags` through, so the sprite, the
   * model's outfit menu and the editor all pick it up with no further plumbing.
   */
  const buyOutfit = useCallback(
    async (characterId: string, outfitId: string) => {
      if (!chatId) return
      const { active: target } = resolveSpeaker(characterId)
      const outfit = target?.outfits?.find((o) => o.id === outfitId)
      const price = Number(outfit?.price ?? 0)
      if (!outfit || price <= 0) return
      await getCoinMutex(chatId).run(async () => {
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        const coins = freshChat.giftCoins ?? 0
        if (coins < price) return
        const flag = outfitOwnedFlag(outfitId)
        const flags = new Set((freshChat.sceneFlags ?? []) as SceneFlag[])
        // Already owned — never charge twice for the same wardrobe state.
        if (flags.has(flag)) return
        flags.add(flag)
        await chatsApi.update(chatId, { giftCoins: coins - price, sceneFlags: [...flags] })
        toastSuccess(`Bought ${outfit.label}.`)
      })
    },
    [chatId, resolveSpeaker],
  )

  /** Byte-for-byte mirrors `buyGift`/`buyItem` — a toy is a purchase like either, just tracked in its own `toyInventory` (`intimacyCatalog.ts`'s own doc comment explains why toys, unlike every other intimacy-catalog category, need an actual ownership step). */
  const buyToy = useCallback(
    async (toyId: string) => {
      if (!chatId) return
      const def = intimacyItemById(toyId, world)
      if (!def?.price) return
      const price = def.price
      await getCoinMutex(chatId).run(async () => {
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        const coins = freshChat.giftCoins ?? 0
        if (coins < price) return
        const inventory = { ...(freshChat.toyInventory ?? {}) }
        inventory[toyId] = (inventory[toyId] ?? 0) + 1
        await chatsApi.update(chatId, {
          giftCoins: coins - price,
          toyInventory: inventory,
        })
      })
    },
    [chatId, world],
  )

  /**
   * Answers a branch the scene is blocked on. The stage moves here, in plain code — the model never
   * gets a say in which way it went. Returns the chosen option's catalog entry id, if it has one, so
   * the caller can route it through the existing clicked-action path and have the choice read as the
   * player doing something rather than flipping a switch.
   */
  const chooseIntimacyBranch = useCallback(
    async (characterId: string, optionId: string): Promise<string | undefined> => {
      if (!chatId) return undefined
      const freshChat = await chatsApi.get(chatId)
      if (!freshChat) return undefined
      const charReplies = countCharReplies(messages)
      // The branch belongs to the scene, not to whichever character's panel raised it — a group
      // scene's one open decision is answered once, on the track that actually holds the scene.
      const active = findActiveIntimacyScene(freshChat, (s: IntimacyScene) => isIntimacySceneActive(s, charReplies))
      if (!active || !isSceneParticipant(active.scene, characterId, active.ownerId)) return undefined
      const { ownerId, scene } = active
      const ownerTrack = getRelationshipTrack(freshChat, ownerId)
      const option = scene.pendingChoice ? pendingChoiceOption(scene.pendingChoice, optionId) : undefined
      if (!option) return undefined
      // Read before resolving: an answer that ends the scene returns `null`, and the flag it set is
      // the one durable trace the decision leaves. Folded into `Chat.sceneFlags`, where a world
      // rule's `flag_set` condition can react to it turns or days later.
      const sceneFlagsAfter = resolvedSceneFlags(scene, optionId)
      const next = resolveIntimacyChoice(scene, optionId, charReplies, scenarioById(getScenarioCatalog(world), scene.scenarioId))
      const durableFlags = new Set([...((freshChat.sceneFlags ?? []) as SceneFlag[]), ...sceneFlagsAfter])
      await chatsApi.update(chatId, {
        ...patchRelationshipTrack(freshChat, ownerId, {
          intimacyScene: next,
          // Choosing to end the scene closes it exactly as an observed finish would.
          intimacySceneShapeLog: next
            ? ownerTrack.intimacySceneShapeLog
            : appendSceneShapeLog(ownerTrack.intimacySceneShapeLog, scene.categoryHistory ?? [scene.category]),
        }),
        sceneFlags: [...durableFlags],
      })
      return option.entryId
    },
    [chatId, messages, world],
  )

  /** Applies an owned item's authored effect immediately and deterministically — no judge call, unlike a gift's in-scene reaction. */
  const useItem = useCallback(
    async (itemId: string) => {
      if (!chatId || !character) return
      const def = itemById(itemId, world)
      if (!def) return
      // The whole read-modify-write runs inside the mutex even for non-currency effects, so it can't race a Shop purchase.
      await getCoinMutex(chatId).run(async () => {
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        const inStock = freshChat.itemInventory?.[itemId] ?? 0
        if (inStock <= 0) return
        const inventory = { ...freshChat.itemInventory }
        inventory[itemId] = inStock - 1
        if (inventory[itemId] <= 0) delete inventory[itemId]

        // Applied into one accumulating patch rather than one branch per effect, so a `multi`
        // item lands as a single write — two sequential updates would give the second one a stale
        // read of the first's stats and silently drop it.
        const patch: Record<string, unknown> = { itemInventory: inventory }
        const notes: string[] = []
        const flags = new Set((freshChat.sceneFlags ?? []) as SceneFlag[])
        let stats = getRelationshipStats(freshChat)
        let affection = freshChat.affection ?? 0
        let coins = freshChat.giftCoins ?? 0

        const apply = (effect: ItemEffect) => {
          if (effect.kind === 'multi') {
            effect.effects.forEach(apply)
            return
          }
          if (effect.kind === 'currency') {
            coins = Math.max(0, coins + effect.amount)
            patch.giftCoins = coins
            notes.push(`gained ${effect.amount} coins`)
            return
          }
          if (effect.kind === 'flag') {
            flags.add(effect.flag)
            patch.sceneFlags = [...flags]
            return
          }
          const dim = effect.dimension
          if (dim === 'affection') {
            affection = clampAffection(affection + effect.amount)
            patch.affection = affection
          } else {
            stats = { ...stats, [dim]: clampStat(stats[dim] + effect.amount) }
            patch.relationshipStats = stats
          }
          notes.push(`${effect.amount > 0 ? '+' : ''}${effect.amount} ${dim}`)
        }
        apply(def.effect)

        await chatsApi.update(chatId, patch)
        toastSuccess(notes.length ? `Used ${def.name} — ${notes.join(', ')}.` : `Used ${def.name}.`)
      })
    },
    [character, chatId, world],
  )

  // `askForCommitment` needs `startDateEvent`, which is declared later in this hook body — a ref sidesteps the "used before declaration" ordering issue and any staleness from memoization.
  const startDateEventRef = useRef<(event: DateEventCard) => Promise<void>>(async () => {})

  /** A single Define-the-Relationship ask — the tier is already warmth-gated by the caller; this just judges how the character reacts to being asked. */
  const askForCommitment = useCallback(
    async (tier: Exclude<CommitmentStatus, 'none'>, characterId?: string) => {
      if (!chatId) return
      const { active: target } = resolveSpeaker(characterId)
      if (!target) return
      const freshChat = await chatsApi.get(chatId)
      if (!freshChat) return
      const track = getRelationshipTrack(freshChat, target.id)
      const currentStatus = track.commitmentStatus ?? 'none'
      const currentStats = getRelationshipStats(track)
      const currentAffection = track.affection ?? 0
      const historyForAssist: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
      let outcome
      try {
        outcome = await assessCommitmentAsk(trackingClient, {
          history: historyForAssist,
          charName: target.card.name,
          charPersonality: target.card.personality,
          userName: persona?.name || 'You',
          tierLabel: formatCommitmentStatus(tier),
          currentStatusLabel: formatCommitmentStatus(currentStatus),
          current: { affection: currentAffection, ...currentStats },
        }, jobShaping.tracking)
      } catch (e) {
        toastError(errorMessage(e))
        return
      }
      const deltas = scaleDeltasForDifficulty(outcome.deltas, relationshipDifficulty)
      const affection = clampAffection(currentAffection + deltas.affection)
      let nextStats = { ...currentStats }
      for (const dim of RELATIONSHIP_DIMENSIONS) nextStats[dim] = clampStat(currentStats[dim] + deltas[dim])
      const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
      const previousStage = relationshipStageForWarmth(computeWarmth(currentAffection, currentStats), milestones)
      const statusAfterAsk = outcome.decision === 'accept' ? tier : currentStatus
      const risk = applyRelationshipRisk({
        charName: target.card.name,
        commitmentStatus: statusAfterAsk,
        stats: nextStats,
        existingWarning: track.relationshipWarning ?? undefined,
        breakupCount: track.breakupCount ?? 0,
      })
      nextStats = risk.stats
      const warmth = computeWarmth(affection, nextStats)
      const relationshipStage = relationshipStageForWarmth(warmth, milestones)
      // A deflection/backfire opens a decaying cue that colors the next few turns; an accept always clears it.
      const nextRebuff: RecentRebuff | null =
        outcome.decision === 'accept'
          ? null
          : { startedAtTurn: countCharReplies(messages), kind: 'commitment', severity: outcome.decision === 'backfire' ? 'backfire' : 'deflect' }

      await chatsApi.update(chatId, patchRelationshipTrack(freshChat, target.id, {
        affection,
        relationshipStats: nextStats,
        relationshipStage,
        commitmentStatus: risk.commitmentStatus,
        // The relationship's anniversary — stamped once, the very first time it moves off 'none',
        // and left alone on every later tier change (marriage doesn't reset it).
        commitmentStartedDay:
          currentStatus === 'none' && risk.commitmentStatus !== 'none' ? (world?.currentDay ?? 0) : track.commitmentStartedDay,
        relationshipWarning: risk.relationshipWarning ?? null,
        breakupCount: risk.breakupCount,
        recentRebuff: nextRebuff,
      }))

      const changedDeltas = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0))
      relationshipEventsApi
        .create({
          chatId,
          characterId: target.id,
          reason: `Asked to be ${formatCommitmentStatus(tier)}: ${outcome.reason}`,
          deltas: changedDeltas,
          sourceMessageId: messages[messages.length - 1]?.id,
        })
        .catch(() => {})

      if (outcome.decision === 'accept') {
        // 10a's "Economy" bullet: a real commitment tier accepted is a discrete, rare, meaningful
        // moment worth a real reward (see `COMMITMENT_ACCEPTED_COIN_BONUS`'s own doc comment) —
        // granted inside the coin mutex like every other `giftCoins` touch (`coinMutex.ts`), and
        // folded into this same toast rather than firing a second one right on top of it.
        const coinsGranted = await getCoinMutex(chatId).run(async () => {
          const liveChat = await chatsApi.get(chatId)
          if (!liveChat) return 0
          await chatsApi.update(chatId, { giftCoins: Math.max(0, (liveChat.giftCoins ?? 0) + COMMITMENT_ACCEPTED_COIN_BONUS) })
          return COMMITMENT_ACCEPTED_COIN_BONUS
        })
        toastSuccess(
          `${target.card.name} said yes — you're ${formatCommitmentStatus(tier)} now. ${outcome.reason}${coinsGranted ? ` (+${coinsGranted} coins)` : ''}`,
          { chime: true },
        )
        chatFactsApi
          .create({
            chatId,
            text: `${persona?.name || 'You'} and ${target.card.name} are officially ${formatCommitmentStatus(tier)}.`,
          })
          .catch(() => {})
        // A married/living_together accept earns an actual wedding/moving-in scene, reusing the normal date-event machinery. Primary-only. Not awaited — the ask's own promise shouldn't block on this best-effort scene.
        if ((tier === 'married' || tier === 'living_together') && target.id === character?.id) {
          suggestDateEvent(trackingClient, {
            characterName: target.card.name,
            characterDescription: target.card.description,
            personaName: persona?.name || 'You',
            worldDescription: world?.description,
            availableBackgrounds: getUnlockedBackgroundIds(world, affection),
            affection,
            commitmentStatus: tier,
            milestoneOccasion: tier,
            recentGiftName: recentMeaningfulGiftName(track.giftLog, target.giftPreferences, world),
          }, jobShaping.tracking)
            .then((milestoneEvent) => (milestoneEvent ? startDateEventRef.current(milestoneEvent) : undefined))
            .catch((e) =>
              toastError(`Accepted, but couldn't put together the ${tier === 'married' ? 'wedding' : 'moving-in'} scene: ${errorMessage(e)}`),
            )
        }
      } else if (outcome.decision === 'backfire') {
        toastError(`That didn't land well. ${outcome.reason}`)
      } else {
        toastInfo(`Not the right moment. ${outcome.reason}`)
      }
      await announceMilestone({
        charName: target.card.name,
        personaName: persona?.name || 'You',
        chatId,
        previousStage,
        relationshipStage,
        characterId: target.id,
        turnCount: countCharReplies(messages),
      })
    },
    [character, chatId, trackingClient, messages, persona?.name, relationshipDifficulty, resolveSpeaker, world],
  )

  /** A deliberate "first time together" ask — mirrors `askForCommitment`'s shape, but sets `firstIntimateSceneAt` instead of a tier, with no auto-sent narrative line afterward. */
  const initiateFirstTime = useCallback(
    async (characterId?: string) => {
      if (!chatId) return
      const { active: target } = resolveSpeaker(characterId)
      if (!target) return
      const freshChat = await chatsApi.get(chatId)
      if (!freshChat) return
      const track = getRelationshipTrack(freshChat, target.id)
      const currentStats = getRelationshipStats(track)
      const currentAffection = track.affection ?? 0
      const historyForAssist: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
      let outcome
      try {
        outcome = await assessIntimacyMilestone(trackingClient, {
          history: historyForAssist,
          charName: target.card.name,
          charPersonality: target.card.personality,
          userName: persona?.name || 'You',
          current: { affection: currentAffection, ...currentStats },
        }, jobShaping.tracking)
      } catch (e) {
        toastError(errorMessage(e))
        return
      }
      const deltas = scaleDeltasForDifficulty(outcome.deltas, relationshipDifficulty)
      const affection = clampAffection(currentAffection + deltas.affection)
      let nextStats = { ...currentStats }
      for (const dim of RELATIONSHIP_DIMENSIONS) nextStats[dim] = clampStat(currentStats[dim] + deltas[dim])
      const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
      const previousStage = relationshipStageForWarmth(computeWarmth(currentAffection, currentStats), milestones)
      const risk = applyRelationshipRisk({
        charName: target.card.name,
        commitmentStatus: track.commitmentStatus ?? 'none',
        stats: nextStats,
        existingWarning: track.relationshipWarning ?? undefined,
        breakupCount: track.breakupCount ?? 0,
      })
      nextStats = risk.stats
      const warmth = computeWarmth(affection, nextStats)
      const relationshipStage = relationshipStageForWarmth(warmth, milestones)
      // Same rebuff rule as `askForCommitment`.
      const nextRebuff: RecentRebuff | null =
        outcome.decision === 'accept'
          ? null
          : { startedAtTurn: countCharReplies(messages), kind: 'intimacy_milestone', severity: outcome.decision === 'backfire' ? 'backfire' : 'deflect' }

      await chatsApi.update(chatId, patchRelationshipTrack(freshChat, target.id, {
        affection,
        relationshipStats: nextStats,
        relationshipStage,
        commitmentStatus: risk.commitmentStatus,
        relationshipWarning: risk.relationshipWarning ?? null,
        breakupCount: risk.breakupCount,
        firstIntimateSceneAt: outcome.decision === 'accept' ? (track.firstIntimateSceneAt ?? Date.now()) : track.firstIntimateSceneAt,
        // Only an accepted first time opens an aftercare window — nothing to judge on a deflected/backfired ask.
        afterglow:
          outcome.decision === 'accept'
            ? { startedAtTurn: countCharReplies(messages), sourceLabel: 'their first time together', momentumAtStart: track.momentum ?? 0 }
            : (track.afterglow ?? null),
        recentRebuff: nextRebuff,
      }))

      const changedDeltas = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0))
      relationshipEventsApi
        .create({
          chatId,
          characterId: target.id,
          reason: `Initiated their first time together: ${outcome.reason}`,
          deltas: changedDeltas,
          sourceMessageId: messages[messages.length - 1]?.id,
        })
        .catch(() => {})

      if (outcome.decision === 'accept') {
        toastSuccess(`${target.card.name} wants this too. ${outcome.reason}`, { chime: true })
        if (!track.firstIntimateSceneAt) {
          chatFactsApi
            .create({
              chatId,
              text: `${persona?.name || 'You'} and ${target.card.name} were intimate together for the first time.`,
            })
            .catch(() => {})
        }
      } else if (outcome.decision === 'backfire') {
        toastError(`That didn't land well. ${outcome.reason}`)
      } else {
        toastInfo(`Not the right moment. ${outcome.reason}`)
      }
      await announceMilestone({
        charName: target.card.name,
        personaName: persona?.name || 'You',
        chatId,
        previousStage,
        relationshipStage,
        characterId: target.id,
        turnCount: countCharReplies(messages),
      })
    },
    [chatId, trackingClient, messages, persona?.name, relationshipDifficulty, resolveSpeaker, world],
  )

  /** Deliberately ending a committed relationship (behind a UI confirmation), applying the same one-time scar a strain-driven breakup does. */
  const endRelationship = useCallback(
    async (characterId?: string) => {
      if (!chatId) return
      const { active: target } = resolveSpeaker(characterId)
      if (!target) return
      const freshChat = await chatsApi.get(chatId)
      if (!freshChat) return
      const track = getRelationshipTrack(freshChat, target.id)
      if ((track.commitmentStatus ?? 'none') === 'none') return
      const scarredStats = applyBreakupScar(getRelationshipStats(track))
      // The scar can drop warmth enough to cross back over a milestone boundary, so `relationshipStage` is recomputed here too. Affection itself is untouched by a breakup.
      const warmth = computeWarmth(track.affection ?? 0, scarredStats)
      const relationshipStage = relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds))
      await chatsApi.update(chatId, patchRelationshipTrack(freshChat, target.id, {
        commitmentStatus: 'none',
        relationshipStats: scarredStats,
        relationshipStage,
        relationshipWarning: null,
        breakupCount: (track.breakupCount ?? 0) + 1,
      }))
      chatFactsApi
        .create({ chatId, text: `${persona?.name || 'You'} and ${target.card.name} broke things off.` })
        .catch(() => {})
      toastInfo(`You and ${target.card.name} are no longer together.`)
    },
    [chatId, persona?.name, resolveSpeaker, world],
  )

  const previewPrompt = useCallback(async () => {
    const historyForPrompt: ChatMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      text: m.text,
    }))
    return buildCurrentPrompt(historyForPrompt, { speakerId: replyAsCharacterId, includeSectionBreakdown: true })
  }, [buildCurrentPrompt, messages, replyAsCharacterId])

  /** Saves (or clears, via explicit `null`) this chat's Author's Note. */
  const updateAuthorNote = useCallback(
    async (note: AuthorNote | null) => {
      if (!chatId) return
      await chatsApi.update(chatId, { authorNote: note && note.text.trim() ? note : null })
    },
    [chatId],
  )

  const updateGmNotes = useCallback(
    async (notes: string) => {
      if (!chatId) return
      await chatsApi.update(chatId, { gmNotes: notes.trim() || null })
    },
    [chatId],
  )

  /** The story's canon beats (`SetEvent`): happen as written, with no roll. An empty list clears them. */
  const updateSetEvents = useCallback(
    async (events: SetEvent[]) => {
      if (!chatId) return
      await chatsApi.update(chatId, { setEvents: events.length ? events : null } as Partial<Chat>)
    },
    [chatId],
  )

  /** Who the Game Master plays itself until a set event hands them over (`GmPlayedCharacter`). */
  const updateGmPlayed = useCallback(
    async (played: GmPlayedCharacter[]) => {
      if (!chatId) return
      await chatsApi.update(chatId, { gmPlayed: played.length ? played : null } as Partial<Chat>)
    },
    [chatId],
  )

  /** Makes another character this scene's lead. `keepPrevious: false` takes the old lead out of the scene. */
  const changeLead = useCallback(
    async (characterId: string, keepPrevious: boolean) => {
      if (!chatId) return
      await chatsApi.changeLead(chatId, characterId, keepPrevious)
    },
    [chatId],
  )

  /**
   * The player's own correction to tracked state. It happens at this point in the story, so it rides
   * the latest message and follows rewinds and forks (`world/gameState.ts`); with no messages yet it
   * sets the scene's starting values.
   */
  const editGameState = useCallback(
    async (effects: TrackEffect[]) => {
      if (!chatId || !effects.length) return
      const edits: StateChange[] = effects.map((effect) => ({ ...effect, source: 'player' }))
      const branch = await messagesApi.listByChat(chatId)
      const last = branch[branch.length - 1]
      if (last) {
        await messagesApi.update(last.id, { stateEdits: [...(last.stateEdits ?? []), ...edits] })
        return
      }
      const fresh = await chatsApi.get(chatId)
      const tracks = world?.campaign?.tracks ?? []
      const { state } = gameStateFrom(tracks, fresh?.gameState, [{ stateEdits: edits }], { playerId: fresh?.playerCharacterId })
      // Values back at their default needn't be stored.
      const kept = Object.fromEntries(Object.entries(state).filter(([key, value]) => {
        const track = tracks.find((t) => t.id === key.split('@')[0])
        return !track || JSON.stringify(value) !== JSON.stringify(trackValue(undefined, track))
      }))
      await chatsApi.update(chatId, { gameState: normalizeGameState(kept) ?? null } as Partial<Chat>)
    },
    [chatId, world],
  )

  /** Location/atmosphere framing plus the group-chat turn policy. `null` clears it entirely; a partial patch merges onto whatever's already set. */
  const updateScene = useCallback(
    async (patch: Partial<Scene> | null) => {
      if (!chatId) return
      if (patch === null) {
        await chatsApi.update(chatId, { scene: null })
        return
      }
      const current: Scene = chat?.scene ?? { turnPolicy: 'manual' }
      // A location/atmosphere edit happens at this point in the story, so it rides the branch
      // (`chat/sceneSetting.ts`); with no messages yet it is simply the opening setting.
      const event: SceneSettingEvent = {}
      if ('location' in patch) event.location = patch.location ?? null
      if ('atmosphere' in patch) event.atmosphere = patch.atmosphere ?? null
      const branch = Object.keys(event).length ? await messagesApi.listByChat(chatId) : []
      const shown = sceneSettingFrom(branch, current, (id) => backgroundLabel(id, world))
      const changed = (event.location !== undefined && (event.location ?? undefined) !== shown.location)
        || (event.atmosphere !== undefined && (event.atmosphere ?? undefined) !== shown.atmosphere)
      const last = branch[branch.length - 1]
      if (changed && last) {
        await messagesApi.update(last.id, { sceneSetting: { ...last.sceneSetting, ...event } })
        const { location: _l, atmosphere: _a, ...rest } = patch
        await chatsApi.update(chatId, { scene: { ...current, ...rest } })
        return
      }
      await chatsApi.update(chatId, { scene: { ...current, ...patch } })
    },
    [chat?.scene, chatId, world],
  )

  /** Updates the group-chat roster after chat creation. Resets `roundRobinIndex`, since a changed roster can shift what that index used to point at. */
  const updateParticipants = useCallback(
    async (ids: string[]) => {
      if (!chatId) return
      const fresh = (await chatsApi.get(chatId)) ?? chat
      const presentCharacterIds = fresh?.scene?.presentCharacterIds
      const nextPresent = presentCharacterIds?.filter((id) => id === fresh?.characterId || ids.includes(id))
      await chatsApi.update(chatId, {
        participants: ids,
        scene: fresh?.scene ? { ...fresh.scene, roundRobinIndex: 0, ...(nextPresent ? { presentCharacterIds: nextPresent } : {}) } : fresh?.scene,
      })
    },
    [chat, chatId],
  )

  /** Play a different card mid-story. The card you take over leaves the AI cast; the one you leave rejoins it unless it's "you only". */
  const switchPlayer = useCallback(
    async (nextId: string) => {
      if (!chatId) return false
      const fresh = (await chatsApi.get(chatId)) ?? chat
      if (!fresh) return false
      const cards = await charactersApi.list()
      const result = planPlayerSwitch(fresh, nextId, (id) => cards.find((c) => c.id === id))
      if (!result.ok) {
        toastInfo(result.reason)
        return false
      }
      const participants = result.patch.participants ?? []
      // The card you leave was in the scene as you, so it stays present once the AI takes it back.
      const leaving = fresh.playerCharacterId && participants.includes(fresh.playerCharacterId) ? [fresh.playerCharacterId] : []
      const present = fresh.scene?.presentCharacterIds
        ?.filter((id) => id === fresh.characterId || participants.includes(id))
        .concat(leaving.filter((id) => !fresh.scene!.presentCharacterIds!.includes(id)))
      await chatsApi.update(chatId, {
        ...result.patch,
        participants,
        scene: fresh.scene ? { ...fresh.scene, roundRobinIndex: 0, ...(present ? { presentCharacterIds: present } : {}) } : fresh.scene,
      })
      if (replyAsCharacterId === nextId) setReplyAsCharacterId(null)
      return true
    },
    [chat, chatId, replyAsCharacterId],
  )

  /** Drafts this scene's recap with the model, for the End scene dialog to show and edit. */
  const draftSceneRecap = useCallback(async (): Promise<RecapDraft> => {
    if (!chat || !character || !chatId) throw new Error('No scene is open.')
    const branch = await messagesApi.listByChat(chatId)
    const scenes = chat.storyId ? await storiesApi.scenes(chat.storyId).catch(() => [] as Chat[]) : []
    const storyNow = chat.storyId ? await storiesApi.get(chat.storyId) : undefined
    const earlier = storyRecapBlock(sceneChain(scenes, chat), 'narrator', { maxTokens: 600, chapters: chaptersOf(storyNow, scenes) })
    const playerName = persona?.name || 'You'
    return writeSceneRecap({
      guidance: promptOverride(world?.promptOverrides, 'scene-recap'),
      messages: branch
        .filter((m) => !m.failed && m.text.trim())
        .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('char' as const), name: m.role === 'user' ? playerName : m.name, text: m.text })),
      playerName,
      castNames: [character, ...participantCharacters].map((c) => c.card.name),
      location: sceneSettingFrom(branch, chat.scene, (id) => backgroundLabel(id, world)).location,
      storySoFar: [earlier, chat.summary].filter(Boolean).join('\n\n') || undefined,
      recordedChecks: recentRollsFrom(branch, 8),
      generate: (prompt) =>
        generateWithTimeout(
          memoryClient,
          {
            prompt,
            max_length: 700,
            max_context_length: sampler.max_context_length,
            temperature: 0.4,
            top_p: 1,
            top_k: 0,
            min_p: 0,
            typical: 1,
            tfs: 1,
            rep_pen: 1.1,
            rep_pen_range: 1024,
            rep_pen_slope: 0.7,
          },
          'Write scene recap',
          undefined,
          jobShaping.memory,
        ),
    })
  }, [jobShaping.memory, character, chat, chatId, memoryClient, participantCharacters, persona?.name, sampler.max_context_length, world])

  /**
   * Drafts the recap of this scene's chapter, for the End scene dialog when it ends the chapter too:
   * from the recaps of the chapter's earlier scenes in this line of play, and this scene's recap as
   * the player has it now. Without a working model it joins the scene recaps instead.
   */
  const draftChapterRecap = useCallback(async (current: { recapText: string; openThreads: string[] }): Promise<ChapterRecapDraft> => {
    if (!chat) throw new Error('No scene is open.')
    const scenes = chat.storyId ? await storiesApi.scenes(chat.storyId).catch(() => [] as Chat[]) : []
    const storyNow = chat.storyId ? await storiesApi.get(chat.storyId) : undefined
    const chapters = chaptersOf(storyNow, scenes.length ? scenes : [chat])
    const chapter = chapters.find((c) => c.id === chapterIdOf(chat)) ?? chapters[0]
    const earlier = chapterLine(scenes.some((s) => s.id === chat.id) ? scenes : [...scenes, chat], chat).slice(0, -1)
    return writeChapterRecap({
      guidance: promptOverride(world?.promptOverrides, 'chapter-recap'),
      chapterLabel: chapterLabel(chapter),
      goal: chapter.goal,
      playerName: persona?.name || 'You',
      scenes: [
        ...earlier.filter((s) => s.recap?.text.trim()).map((s) => ({ label: sceneLabel(s), recap: s.recap!.text, openThreads: s.recap!.openThreads })),
        { label: sceneLabel(chat), recap: current.recapText, openThreads: current.openThreads },
      ],
      generate: (prompt) =>
        generateWithTimeout(memoryClient, { prompt, max_length: 700, max_context_length: sampler.max_context_length, temperature: 0.4, top_p: 1, top_k: 0, min_p: 0, typical: 1, tfs: 1, rep_pen: 1.1, rep_pen_range: 1024, rep_pen_slope: 0.7 },
          'Write chapter recap', undefined, jobShaping.memory),
    })
  }, [jobShaping.memory, chat, memoryClient, persona?.name, sampler.max_context_length])

  /** Names this scene's chapter or sets its goal; with `chapterId`, another chapter's, or an ended chapter's recap. */
  const updateChapter = useCallback(
    async (edit: { chapterId?: string; title?: string; goal?: string; recap?: { text: string; openThreads?: string[] } }) => {
      if (!chatId) throw new Error('No scene is open.')
      return chatsApi.updateChapter(chatId, edit)
    },
    [chatId],
  )

  /**
   * Ends this scene and opens the next. The recap remembers who was there, so later scenes only
   * tell it to characters who were. Ticked lasting changes become world canon first.
   */
  const finishScene = useCallback(
    async (input: {
      recapText: string
      openThreads: string[]
      canonFacts: string[]
      next: { title?: string; location?: string; presentIds: string[]; leadId?: string; storylineId?: string; newStorylineName?: string }
      /** Ends the chapter too (`story/chapters.ts`). */
      chapter?: { recapText: string; openThreads: string[]; next: { title?: string; goal?: string } }
    }): Promise<Chat> => {
      if (!chatId) throw new Error('No scene is open.')
      // Everything said in the scene is remembered before it closes.
      await scribeMemories({ flush: true }).catch(() => {})
      const fresh = await chatsApi.get(chatId)
      if (!fresh) throw new Error('This scene no longer exists.')
      const branch = await messagesApi.listByChat(chatId)
      const inScene = fresh.scene?.presentCharacterIds ?? fresh.participants ?? []
      const spoke = branch.map((m) => m.speakerId).filter((id): id is string => !!id && id !== fresh.characterId)
      const presentIds = [...new Set([fresh.characterId, ...inScene, ...spoke, ...(fresh.playerCharacterId ? [fresh.playerCharacterId] : [])])]
        .filter((id) => id !== GM_SPEAKER_ID)
      const facts = input.canonFacts.map((t) => t.trim()).filter(Boolean)
      if (facts.length && world) {
        const current = await worldsApi.get(world.id)
        await worldsApi.update(world.id, {
          canonFacts: [...(current?.canonFacts ?? []), ...facts.map((text) => ({ id: newId(), text, createdAt: Date.now(), sourceChatId: chatId }))],
        })
      }
      // Names learned in this scene stay learned in the next: only those still unheard carry over.
      if (fresh.strangers) {
        const nameOf = (id: string) => allCharactersById.get(id)?.card.name ?? (id === playerCharacter?.id ? playerCharacter.card.name : undefined)
        const strangers = Object.fromEntries(Object.entries(fresh.strangers).flatMap(([id, record]) => {
          const left = stillStrangers(id, record, branch, nameOf)
          return left.length ? [[id, { ...record, ids: left }]] : []
        }))
        await chatsApi.update(chatId, { strangers: Object.keys(strangers).length ? strangers : null } as Partial<Chat>)
      }
      const location = input.next.location?.trim()
      const nextScene = await chatsApi.nextScene(chatId, {
        recap: {
          text: input.recapText.trim(),
          presentIds,
          openThreads: input.openThreads.map((t) => t.trim()).filter(Boolean),
          location: sceneSettingFrom(branch, fresh.scene, (id) => backgroundLabel(id, world)).location,
        },
        consequences: branchConsequencesFrom(branch),
        setEventsDone: [...new Set([...(fresh.setEventsDone ?? []), ...setEventsDoneFrom(branch)])],
        ...(input.chapter ? { chapter: {
          recap: { text: input.chapter.recapText.trim(), openThreads: input.chapter.openThreads.map((t) => t.trim()).filter(Boolean) },
          next: { title: input.chapter.next.title?.trim() || undefined, goal: input.chapter.next.goal?.trim() || undefined },
        } } : {}),
        next: {
          title: input.next.title?.trim() || undefined,
          ...(location !== undefined ? { location: location || null } : {}),
          presentIds: input.next.presentIds,
          ...(input.next.leadId && input.next.leadId !== fresh.characterId ? { leadId: input.next.leadId } : {}),
          storylineId: input.next.storylineId,
          newStorylineName: input.next.newStorylineName?.trim() || undefined,
        },
      })
      runAssist('memory', 'Writing journals', () => writeJournals(chatId, presentIds))
      // Time moves on between scenes when the world's clock follows the story.
      await followStoryTime([], { step: true, sceneId: nextScene.id })
      return nextScene
    },
    [allCharactersById, chatId, followStoryTime, playerCharacter, runAssist, scribeMemories, world, writeJournals],
  )

  /** Best-effort: proposes a few next-move options for the user, attached to the char message they follow from. Never blocks the reply. */
  const suggestChoicesForMessage = useCallback(
    async (messageId: string, historyForChoices: ChatMessage[]) => {
      if (!character || !chatId) return
      try {
        const freshChat = await chatsApi.get(chatId)
        const inventory = freshChat?.giftInventory ?? {}
        const availableGifts = getGiftCatalog(world).map((item) => ({
          id: item.id,
          name: item.name,
          quantity: inventory[item.id] ?? 0,
        })).filter((g) => g.quantity > 0)
        const choiceCards = await generateChoices(trackingClient, {
          history: historyForChoices,
          charName: character.card.name,
          userName: persona?.name || 'You',
          availableGifts,
        }, jobShaping.tracking)
        await messagesApi.update(messageId, {
          choiceCards,
          choices: choiceCards.map((c) => c.text),
        })
      } catch {
        // a failed suggestion just means no choice buttons render — never surfaced as a chat error
      }
    },
    [character, chatId, trackingClient, persona, world],
  )

  const regenerateChoices = useCallback(
    async (messageId: string) => {
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      const historyUpTo: ChatMessage[] = messages
        .slice(0, idx + 1)
        .map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
      await suggestChoicesForMessage(messageId, historyUpTo)
    },
    [messages, suggestChoicesForMessage],
  )

  /** Vision backup for the model's `<<scene:>>` self-tag: corrects the expression from the character's actual sprites, and derives background/mood from any attached photo. No-op if nothing changed. */
  const refineSceneWithVision = useCallback(
    async (messageId: string, speaker: Character, replyText: string, userImages: string[]) => {
      if (!chat || !chatId || !character || !replyText.trim()) return
      const spriteMap = speaker.sprites ?? {}
      const affection = getRelationshipTrack(chat, speaker.id).affection ?? 0
      const unlockedExpressions = getUnlockedExpressionIds(speaker, affection)
      const unlockedBackgrounds = getUnlockedBackgroundIds(world, affection)
      // Needed so re-sanitizing the existing tag can't strip an outfit the reply already established.
      const selectableOutfits = selectableOutfitIds(speaker.outfits, spriteMap, affection, new Set(chat?.sceneFlags ?? []))
      const appearanceHistory = await messagesApi.listByChat(chatId)
      const currentOutfit = appearanceForCharacter(appearanceHistory, {
        id: speaker.id, name: speaker.card.name, outfits: speaker.outfits, sprites: speaker.sprites, baseForm: speaker.baseForm, aliases: speaker.aliases,
      }, character.id, affection, new Set(chat.sceneFlags ?? []), chat.scene?.appearanceOverrides?.[speaker.id])

      const spriteExpressionIds = Object.keys(spriteMap).filter((id) => unlockedExpressions.includes(id))
      const canDetectExpression = spriteExpressionIds.length >= 2
      if (!canDetectExpression && userImages.length === 0) return

      const freshMsg = await messagesApi.get(messageId)
      if (!freshMsg) return
      const activeSwipe = freshMsg.activeSwipe ?? 0
      const currentScene: SceneTag = freshMsg.swipeScenes?.[activeSwipe] ?? freshMsg.scene ?? {}
      const next: SceneTag = { ...currentScene }

      if (canDetectExpression) {
        const labelById = new Map<string, string>([
          ...DEFAULT_EXPRESSIONS.map((e) => [e.id, e.label] as const),
          ...(speaker.customExpressions ?? []).map((c) => [c.id, c.label] as const),
        ])
        const candidates = spriteExpressionIds.map((id) => ({ id, label: labelById.get(id) ?? id }))

        // Narrow to a few plausible candidates first — too many sprites to send the vision model at once.
        const shortlist = await shortlistExpressions(visionClient, {
          charName: speaker.card.name,
          replyText,
          candidates,
          taggedExpression: currentScene.expression,
          limit: 6,
        }, jobShaping.vision)

        const cache = spriteBase64Ref.current
        const sprites = (
          await Promise.all(
            shortlist.map(async (id) => {
              // Show the outfit actually on screen, falling back to base art if this outfit lacks it.
              const url = spriteMap[spriteKey(currentOutfit, id)] ?? spriteMap[id]
              if (!url) return null
              if (!cache.has(url)) {
                const b64 = await downscaleImageToBase64(url)
                if (b64) cache.set(url, b64)
              }
              const base64 = cache.get(url)
              return base64 ? { id, label: labelById.get(id) ?? id, base64 } : null
            }),
          )
        ).filter((s): s is { id: string; label: string; base64: string } => !!s)

        const detected = await detectExpressionFromSprites(visionClient, {
          charName: speaker.card.name,
          replyText,
          sprites,
          taggedExpression: currentScene.expression,
        }, jobShaping.vision)
        if (detected) next.expression = detected
      }

      if (userImages.length > 0) {
        const cls = await classifyAttachedImageScene(visionClient, {
          images: userImages,
          backgroundIds: unlockedBackgrounds,
          moodIds: [...SCENE_MOOD_IDS],
        }, jobShaping.vision)
        if (cls.background) next.background = cls.background
        if (cls.mood) next.mood = cls.mood
      }

      const sanitized = sanitizeSceneTag(next, unlockedExpressions, unlockedBackgrounds, selectableOutfits)
      if (
        JSON.stringify(sanitized ?? null) ===
        JSON.stringify(sanitizeSceneTag(currentScene, unlockedExpressions, unlockedBackgrounds, selectableOutfits) ?? null)
      ) {
        return
      }
      const swipeScenes = freshMsg.swipeScenes ? [...freshMsg.swipeScenes] : []
      swipeScenes[activeSwipe] = sanitized
      await messagesApi.update(messageId, { scene: sanitized, swipeScenes })
    },
    [chat, chatId, character, visionClient, world],
  )

  /** Text-only fallback for `refineSceneWithVision` when no vision model is loaded — corrects a stale expression tag from the reply text alone. Expression only, writes back only on actual change. */
  const refineExpressionFromText = useCallback(
    async (messageId: string, speaker: Character, replyText: string) => {
      if (!chat || !replyText.trim()) return
      const affection = getRelationshipTrack(chat, speaker.id).affection ?? 0
      const unlockedExpressions = getUnlockedExpressionIds(speaker, affection)
      const unlockedBackgrounds = getUnlockedBackgroundIds(world, affection)
      const selectableOutfits = selectableOutfitIds(speaker.outfits, speaker.sprites, affection, new Set(chat?.sceneFlags ?? []))

      const freshMsg = await messagesApi.get(messageId)
      if (!freshMsg) return
      const activeSwipe = freshMsg.activeSwipe ?? 0
      const currentScene: SceneTag = freshMsg.swipeScenes?.[activeSwipe] ?? freshMsg.scene ?? {}
      if (!currentScene.expression) return

      const candidates = expressionCandidatesFor(unlockedExpressions, speaker.customExpressions)
      const corrected = await detectExpressionTextMismatch(visionClient, {
        charName: speaker.card.name,
        replyText,
        taggedExpression: currentScene.expression,
        candidates,
      }, jobShaping.vision)
      if (!corrected) return

      const next: SceneTag = { ...currentScene, expression: corrected }
      const sanitized = sanitizeSceneTag(next, unlockedExpressions, unlockedBackgrounds, selectableOutfits)
      if (
        JSON.stringify(sanitized ?? null) ===
        JSON.stringify(sanitizeSceneTag(currentScene, unlockedExpressions, unlockedBackgrounds, selectableOutfits) ?? null)
      ) {
        return
      }
      const swipeScenes = freshMsg.swipeScenes ? [...freshMsg.swipeScenes] : []
      swipeScenes[activeSwipe] = sanitized
      await messagesApi.update(messageId, { scene: sanitized, swipeScenes })
    },
    [chat, visionClient, world],
  )

  /**
   * Best-effort form read for the whole cast. The GM or another character can describe an arrival,
   * and the player can narrate or {instruct} a change (`fromPlayer`). Their usual look counts as a
   * form too, so "she takes her human form again" can switch back.
   */
  const refineCharacterForms = useCallback(async (messageId: string, replyText: string, opts?: { fromPlayer?: boolean }) => {
    if (!chatId || !chat || !character || !replyText.trim()) return
    const branch = await messagesApi.listByChat(chatId)
    const index = branch.findIndex((message) => message.id === messageId)
    if (index < 0) return
    const flags = new Set(chat?.sceneFlags ?? [])
    const roster = [character, ...participantCharacters, ...arrivalsRef.current]
      .filter((member, index, all) => all.findIndex((other) => other.id === member.id) === index)
    const candidates = roster.map((member) => {
      const affection = getRelationshipTrack(chat, member.id).affection ?? 0
      // Forms the story may pick (manual-only ones stay manual), their usual look included.
      const selectable = new Set(selectableOutfitIds(member.outfits, member.sprites, affection, flags))
      const forms = formChoices(member, affection, flags).filter((form) => selectable.has(form.id))
      return {
        id: member.id,
        name: member.card.name,
        aliases: member.aliases,
        current: appearanceForCharacter(branch.slice(0, index), {
          id: member.id, name: member.card.name, outfits: member.outfits, sprites: member.sprites, baseForm: member.baseForm, aliases: member.aliases,
        }, character.id, affection, flags),
        forms,
      }
    }).filter((candidate) => candidate.forms.length >= 2)
    if (!candidates.length) return
    const picked = await detectCharacterForms(visionClient, { text: replyText, candidates, fromPlayer: opts?.fromPlayer }, jobShaping.vision)
    if (!Object.keys(picked).length) return
    const fresh = await messagesApi.get(messageId)
    if (!fresh) return
    const activeSwipe = fresh.activeSwipe ?? 0
    const current = fresh.swipeScenes?.[activeSwipe] ?? fresh.scene ?? {}
    const scene = { ...current, appearances: { ...current.appearances, ...picked } }
    const swipeScenes = fresh.swipeScenes ? [...fresh.swipeScenes] : []
    swipeScenes[activeSwipe] = scene
    await messagesApi.update(messageId, { scene, swipeScenes })
  }, [jobShaping.vision, character, chat, chatId, visionClient, participantCharacters])

  const runGeneration = useCallback(
    async (
      historyForPrompt: ChatMessage[],
      targetMessageId: string,
      images: string[] = [],
      opts?: {
        continuing?: boolean
        speakerId?: string | null
        intent?: MessageIntent
        extraStyleGuidance?: string
        /** Remaining auto-retries on a hard fail (boundary cross / agency violation) — defaults to 1, decremented on each retry so a second bad attempt is just accepted rather than looping. */
        hardFailRetriesLeft?: number
        /** Only meaningful alongside `continuing: true` — the pre-continue snapshot to persist as `continueUndo`, constant across every auto-continue round of this same call. */
        continueUndo?: { text: string; rawText?: string; scene?: SceneTag }
        /** One reply of a Game Master beat: the beat runs the memory scribe once, after its last reply. */
        inGmBeat?: boolean
      },
    ) => {
      // Callers claim the generation lock themselves before reaching here (their own placeholder-message writes need to be inside it too) — this only mirrors state into the UI.
      if (!character || !chat) return
      const { active: speaker } = resolveSpeaker(opts?.speakerId)
      if (!speaker) return
      // A character with their own connection or model replies through it; everyone else through Story replies.
      const replyJob = replyJobFor(speaker)
      const replyClient = replyJob.client
      activeGenerationClientRef.current = replyClient
      // Relationship tracking/rapport stay scoped to the primary; choice suggestions apply to anyone.
      const isPrimarySpeaker = speaker.id === character.id
      // Hard max_length ceiling from this speaker's reply-length band, so a terse character stays
      // terse even if the model ignores the prose instruction. Only tightens the user's cap, never raises it.
      // `reasoningTokenReserve` (Settings → Generation) adds thinking headroom on top for reasoning models.
      const replyBand = resolveReplyLength(speaker.replyLength, speaker.card).band
      const effectiveMaxLength = replyMaxTokens(replyBand, sampler.max_length, reasoningTokenReserve)
      const bandCapsBelowUserMax = effectiveMaxLength < sampler.max_length
      // Becomes true once an auto-continue round kicks in — every remaining round then behaves like a manual continue.
      let continuing = !!opts?.continuing
      const wasOriginallyContinuing = continuing
      let currentHistory = historyForPrompt
      let accumulated = continuing ? (historyForPrompt[historyForPrompt.length - 1]?.text ?? '') : ''
      setIsGenerating(true)
      setStreamingText(accumulated)
      setGeneratingMessageId(targetMessageId)
      setGenStats(null)
      const genkey = makeGenKey()
      genKeyRef.current = genkey
      const abort = new AbortController()
      abortRef.current = abort

      let combined = ''
      let scene: ReturnType<typeof sanitizeSceneTag>
      let wroteAnything = false
      // Set when the loop ends on a reply that's still mid-sentence with no continuation coming — trimmed after the loop.
      let needsSentenceTrim = false

      try {
        // Auto-continues a reply that used its whole token budget (likely cut off mid-thought), capped so a model with no stop sequence can't loop forever.
        for (let round = 0; round <= MAX_AUTO_CONTINUE_ROUNDS; round++) {
          let built = await buildCurrentPrompt(currentHistory, {
            continueLastTurn: continuing,
            speakerId: opts?.speakerId,
            intent: opts?.intent,
            extraStyleGuidance: opts?.extraStyleGuidance,
          })
          if (!built) throw new Error('Could not build prompt: missing character or chat.')

          // Budget was already tight this turn — fold overflow into the summary and rebuild now rather than after the reply lands.
          if (autoSummarize && built.excludedMessageCount > 0) {
            await updateMemorySummary({ force: true })
            const rebuilt = await buildCurrentPrompt(currentHistory, {
              continueLastTurn: continuing,
              speakerId: opts?.speakerId,
              extraStyleGuidance: opts?.extraStyleGuidance,
            })
            if (rebuilt) built = rebuilt
          }

          // Template stop sequences + user's own, plus dynamic safe stops: a model can otherwise imitate
          // a card's own `<START>`/name-prefixed example-dialogue delimiters instead of stopping its turn.
          const personaName = persona?.name || 'You'
          const dynamicStops = ['<START>', `\n${personaName}:`, `\n${speaker.card.name}:`]
          const stopSequence = [...new Set([...templateFor(replyJob.kind).stopSequences, ...(sampler.stop_sequence ?? []), ...dynamicStops])]

          // A chat-completion backend needs its own native sampler params, not KoboldCpp's shape.
          const generationParams =
            usesChatCompletion(replyJob.kind)
              ? { max_context_length: sampler.max_context_length, ...chatCompletionSamplerToRequest(chatCompletionSampler) }
              : sampler

          const genStartedAt = performance.now()
          let firstTokenAt: number | null = null
          let streamedTokenCount = 0
          const builtForStats = built
          setContextUsage({ used: built.tokensUsed, budget: built.contextBudget, dropped: built.excludedMessageCount })
          let newText = ''
          try {
            newText = await replyClient.generateStream(
              {
                ...generationParams,
                max_length: effectiveMaxLength,
                stop_sequence: stopSequence,
                prompt: built.prompt,
                // KoboldClient ignores this; OpenAICompatibleClient uses it for a proper system/user split.
                messages: built.messages,
                genkey,
                images: images.length ? images : undefined,
              },
              (_token, full) => {
                const now = performance.now()
                if (firstTokenAt === null) firstTokenAt = now
                streamedTokenCount++
                setStreamingText(accumulated + stripSceneTagForDisplay(full))
                const elapsedSec = (now - firstTokenAt) / 1000
                setGenStats({
                  tokensPerSec: elapsedSec > 0 ? streamedTokenCount / elapsedSec : 0,
                  firstTokenMs: firstTokenAt - genStartedAt,
                  contextUsed: builtForStats.tokensUsed,
                  contextBudget: builtForStats.contextBudget,
                  measured: false,
                })
              },
              abort.signal,
            )
          } catch (streamErr) {
            // Some builds/proxies block SSE — fall back to non-streaming.
            console.warn('Streaming generation failed, falling back to non-streaming:', streamErr)
            newText = await replyClient.generate(
              {
                ...generationParams,
                max_length: effectiveMaxLength,
                stop_sequence: stopSequence,
                prompt: built.prompt,
                messages: built.messages,
                genkey,
                images: images.length ? images : undefined,
              },
              abort.signal,
            )
          }

          // Stats computed client-side from this round's own stream — KoboldCpp's `/api/extra/perf` can misattribute to a concurrent background assist call sharing the same server.
          if (streamedTokenCount > 0 && firstTokenAt !== null) {
            const finalElapsedSec = (performance.now() - firstTokenAt) / 1000
            setGenStats({
              tokensPerSec: finalElapsedSec > 0 ? streamedTokenCount / finalElapsedSec : 0,
              firstTokenMs: firstTokenAt - genStartedAt,
              contextUsed: builtForStats.tokensUsed,
              contextBudget: builtForStats.contextBudget,
              measured: true,
            })
          }

          const combinedRaw = (accumulated + newText).trimEnd()
          const speakerAffection = getRelationshipTrack(chat, speaker.id).affection ?? 0
          const unlockedExpressions = getUnlockedExpressionIds(speaker, speakerAffection)
          const unlockedBackgrounds = getUnlockedBackgroundIds(world, chat.affection ?? 0)
          const selectableOutfits = selectableOutfitIds(
            speaker.outfits,
            speaker.sprites,
            speakerAffection,
            new Set(chat.sceneFlags ?? []),
          )
          const { text: extractedText, scene: parsedScene } = extractSceneTag(combinedRaw)
          // Scrubbed before storing so a tell doesn't get fed back and imitated next turn. `combinedRaw` keeps the raw original for the Prompt Inspector's toggle.
          combined = cleanModelOutput(extractedText, { charName: speaker.card.name, personaName: persona?.name || 'You' })
          scene = sanitizeSceneTag(parsedScene, unlockedExpressions, unlockedBackgrounds, selectableOutfits)
          // Catches the model echoing recent history back as a "fresh" reply (tail-end repeat, concatenated turns, or a copy of the player's own line).
          const recentTextsForDuplicateCheck = historyForPrompt.slice(-6).map((m) => m.text)
          // Reconstructs the relationship-guidance text actually injected this turn, to catch a partial leak of it into the reply (primary speaker only).
          const relationshipDescriptionLeakText =
            isPrimarySpeaker
              ? substituteMacros(buildRelationshipDescription(chat, world, character) ?? '', {
                  charName: speaker.card.name,
                  userName: persona?.name || 'You',
                })
              : undefined
          // Empty, an echo of the prior message, or a duplicate of recent history/injected guidance all count as a real failure, not a blank/repeated "success".
          const isUsableReply =
            combined.trim().length > 0 &&
            !isVerbatimEcho(combined, historyForPrompt[historyForPrompt.length - 1]?.text) &&
            !isDuplicateOfRecentText(combined, [...recentTextsForDuplicateCheck, relationshipDescriptionLeakText])

          if (continuing) {
            const freshMsg = await messagesApi.get(targetMessageId)
            const swipes = freshMsg?.swipes?.length ? [...freshMsg.swipes] : [accumulated]
            const activeSwipe = freshMsg?.activeSwipe ?? 0
            swipes[activeSwipe] = combined
            const swipeScenes = freshMsg?.swipeScenes ? [...freshMsg.swipeScenes] : []
            swipeScenes[activeSwipe] = scene
            const swipeRawTexts = freshMsg?.swipeRawTexts ? [...freshMsg.swipeRawTexts] : []
            swipeRawTexts[activeSwipe] = combinedRaw
            await messagesApi.update(targetMessageId, {
              text: combined,
              swipes,
              swipeScenes,
              swipeRawTexts,
              rawText: combinedRaw,
              activeSwipe,
              scene,
              tokenCount: await countTokens(combined),
              failed: !isUsableReply,
              continueUndo: opts?.continueUndo ?? null,
              servedBy: servedByLabel(replyJob),
            })
          } else {
            const freshMsg = await messagesApi.get(targetMessageId)
            const existingSwipes = freshMsg?.swipes?.length ? [...freshMsg.swipes] : [combined]
            const activeSwipe = Math.min(freshMsg?.activeSwipe ?? 0, Math.max(0, existingSwipes.length - 1))
            existingSwipes[activeSwipe] = combined
            const swipeScenes = freshMsg?.swipeScenes ? [...freshMsg.swipeScenes] : []
            swipeScenes[activeSwipe] = scene
            const swipeRawTexts = freshMsg?.swipeRawTexts ? [...freshMsg.swipeRawTexts] : []
            swipeRawTexts[activeSwipe] = combinedRaw
            await messagesApi.update(targetMessageId, {
              text: combined,
              swipes: existingSwipes,
              swipeScenes,
              swipeRawTexts,
              rawText: combinedRaw,
              activeSwipe,
              scene,
              tokenCount: await countTokens(combined),
              failed: !isUsableReply,
              // A fresh (non-continue) generation replaces the whole reply, so any earlier continue is moot.
              continueUndo: null,
              servedBy: servedByLabel(replyJob),
            })
          }
          wroteAnything = wroteAnything || isUsableReply
          // Rolls world-info sticky/cooldown state forward for next turn.
          await chatsApi.update(chat.id, { worldInfoState: built.worldInfoState ?? {} })

          // Where the scene is now follows the branch itself (`chat/sceneSetting.ts`): a changed
          // background tag on this reply is replayed as a move, while a tag that only repeats the
          // nearest art is not — so a declared place with no art of its own is never overwritten.

          const generatedTokens = !abort.signal.aborted && newText.trim() ? await countTokens(newText) : 0
          const hitCap = !abort.signal.aborted && generatedTokens >= effectiveMaxLength - 1
          // A round that stopped well under the cap but leaves the reply mid-sentence was cut by a
          // stop sequence firing early (an over-eager end-of-turn token, a card's example-dialogue
          // delimiter, a stray persona-name line) — the same visibly-unfinished outcome as hitting
          // max_length, just a different cause. A reply that stops early *on a complete sentence* is
          // a legitimate short turn and is left alone.
          // Only worth *one* recovery round: a stop sequence that fires a second time (a card's
          // `<START>` in its examples, say) won't be fixed by generating into it again, and a model
          // that just punctuates poorly shouldn't cost three generations every reply.
          const endedMidThought =
            round === 0 && !abort.signal.aborted && !!newText.trim() && !hitCap && !endsCleanly(combined)
          // Extend a reply that ran into the user's real token budget, or one a stray stop cut off
          // mid-sentence — never one this character's reply-length band deliberately kept short.
          const looksTruncated = !bandCapsBelowUserMax && (hitCap || endedMidThought)
          if (!looksTruncated || round === MAX_AUTO_CONTINUE_ROUNDS) {
            // Band-capped, or still ragged after the last allowed round: tidy the tail below.
            needsSentenceTrim = !abort.signal.aborted && !endsCleanly(combined)
            break
          }

          continuing = true
          accumulated = combined
          currentHistory =
            round === 0
              ? [...historyForPrompt, { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined }]
              : [...currentHistory.slice(0, -1), { ...currentHistory[currentHistory.length - 1], text: combined }]
        }

        // A reply still mid-sentence when the loop ends gets trimmed to its last complete sentence and closed off; `rawText` stays untouched.
        if (needsSentenceTrim && !abort.signal.aborted) {
          const tidied = balanceTrailingMarkup(trimToLastSentence(combined))
          if (tidied && tidied !== combined) {
            combined = tidied
            const freshMsg = await messagesApi.get(targetMessageId)
            const swipes = freshMsg?.swipes?.length ? [...freshMsg.swipes] : [combined]
            const activeSwipe = Math.min(freshMsg?.activeSwipe ?? 0, Math.max(0, swipes.length - 1))
            swipes[activeSwipe] = combined
            await messagesApi.update(targetMessageId, { text: combined, swipes, tokenCount: await countTokens(combined) })
          }
        }

        // Deterministic hard rails: lexical checks against authored boundaries/POV/anti-patterns.
        let hardFailCorrection: string | undefined
        if (!abort.signal.aborted && combined.trim()) {
          const crossed = detectAnyBoundaryCrossing(speaker.boundaries, persona?.description, combined)
          if (crossed) {
            toastInfo(`This reply may have crossed a stated limit: "${crossed}". Worth a regenerate if it reads wrong.`)
          }
          const agencyViolation = detectPersonaAgencyViolation(persona?.name || 'You', combined)
          if (agencyViolation) {
            toastInfo(`This reply may have narrated ${persona?.name || 'your'} own reaction for you: "${agencyViolation}". Worth a regenerate if it reads wrong.`)
          }
          const flagCheckIntimacyLevel = resolveIntimacyLevel(world?.intimacyLevel, globalIntimacyLevel)
          // The same shared-scene resolution the prompt build uses: the scene this speaker is in may
          // be owned by another participant, and both checks below have to read what was handed to
          // the model rather than whatever happens to sit on the speaker's own track.
          const flagCheckActive = findActiveIntimacyScene(chat, (s: IntimacyScene) =>
            isIntimacySceneActive(s, countCharReplies(messages)),
          )
          const flagCheckScene =
            flagCheckActive && isSceneParticipant(flagCheckActive.scene, speaker.id, flagCheckActive.ownerId)
              ? flagCheckActive.scene
              : undefined
          const antiPatternUsed =
            flagCheckIntimacyLevel === 'explicit' && flagCheckScene
              ? detectExplicitAntiPatternUsed(combined, flagCheckScene.phase)
              : undefined
          if (antiPatternUsed) {
            toastInfo(`This reply used the stock phrase "${antiPatternUsed}" it was told to avoid. Worth a regenerate if it reads wrong.`)
          }
          // The second half of the state block: check what the model actually wrote against the state
          // it was handed. Scene-scoped, since that block is the only place these facts are asserted.
          // A declared background move is the app's own supported way to relocate a scene (see the
          // `scene.background` handling above), so location is only checked when nothing declared one.
          const sceneForContinuity = flagCheckScene
          // The location the prompt asserted: the branch's setting before this reply (`chat/sceneSetting.ts`).
          const assertedLocation = sceneForContinuity
            ? sceneSettingFrom(
                (await messagesApi.listByChat(chat.id)).filter((m) => m.id !== targetMessageId),
                chat.scene,
                (id) => backgroundLabel(id, world),
              ).location
            : undefined
          const declaredMove = !!scene?.background && backgroundLabel(scene.background, world) !== assertedLocation
          const continuityBreak = sceneForContinuity
            ? detectContinuityBreak(
                combined,
                {
                  clothing: clothingOf(sceneForContinuity, speaker.id),
                  // Only the persisted scene location, which is also what the state block asserted
                  // whenever one is set; a schedule-derived fallback isn't authoritative enough to
                  // call a contradiction on, so no location is checked in that case.
                  location: declaredMove ? undefined : assertedLocation,
                  knownLocations: declaredMove
                    ? undefined
                    : getUnlockedBackgroundIds(world, chat.affection ?? 0).map((id) => backgroundLabel(id, world)),
                  // Same per-chat override the prompt honours (see `promptPhaseIndex`), not the bare world clock.
                  timePhase: chat.scene?.timePhase || (world ? PHASES[world.currentPhaseIndex ?? 0] : undefined),
                  knownTimePhases: world ? [...PHASES] : undefined,
                },
                speaker.card.name,
                persona?.name || 'You',
              )
            : undefined
          if (continuityBreak) {
            toastInfo(`This reply contradicted the scene: ${describeContinuityBreak(continuityBreak)}.`)
          }
          // `?? null`, not omitted — clears a stale flag from a previous attempt once this one reads clean.
          messagesApi
            .update(targetMessageId, {
              boundaryFlag: crossed ?? null,
              povFlag: agencyViolation ?? null,
              explicitQualityFlag: antiPatternUsed ?? null,
              continuityFlag: continuityBreak ? describeContinuityBreak(continuityBreak) : null,
            })
            .catch(() => {})
          // A genuine hard fail (boundary/agency, not the lower-stakes anti-pattern wording) earns one
          // automatic retry with a short correction, rather than leaving a bad reply standing on the
          // strength of a toast alone. Never more than one — a second bad attempt is just accepted.
          if ((opts?.hardFailRetriesLeft ?? 1) > 0) {
            hardFailCorrection = hardFailCorrectionDirective(
              speaker.card.name,
              persona?.name || 'You',
              crossed,
              agencyViolation,
              continuityBreak ? describeContinuityBreak(continuityBreak) : undefined,
            )
          }
        }

        // A hard fail with a retry left: redo the whole reply fresh, with a concrete correction —
        // never the rejected attempt's own post-reply assists (the relationship judge fires at most
        // once per message id, so the retry, not the discarded attempt, must be the one it sees).
        if (hardFailCorrection) {
          await runGeneration(historyForPrompt, targetMessageId, images, {
            ...opts,
            hardFailRetriesLeft: (opts?.hardFailRetriesLeft ?? 1) - 1,
            extraStyleGuidance: [opts?.extraStyleGuidance, hardFailCorrection].filter(Boolean).join(' '),
          })
          return
        }

        // Post-reply assists — each fire-and-forget, routed through `runAssist` so the UI can show which are still running.
        const relationshipHistory = wasOriginallyContinuing
          ? [...historyForPrompt.slice(0, -1), { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined }]
          : [...historyForPrompt, { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined }]
        // A live date/hangout suppresses the normal per-turn scoring — resolved once at the end by endDateEvent instead.
        const inLiveDate = isLiveScene(chat.activeEvent)

        // The judge fires at most once per message id, on whichever attempt first lands usable text — otherwise a regenerate would stack a fresh delta on top of an already-applied one. Fetched fresh so this round's own `failed` write above is visible.
        const targetMsgForJudgeGate = await messagesApi.get(targetMessageId)
        const shouldRunRelationshipJudge = !targetMsgForJudgeGate?.failed && !targetMsgForJudgeGate?.relationshipJudged
        // Scores whichever character actually spoke, not only the primary. Task-detection, when also due, rides along in this same judge call instead of a second request.
        let tasksHandledByMerge = false
        if (modulesForWorld(world ?? { template: chat.mode }).relationships && effectiveAssistFlag(chat.assistOverrides?.autoTrackRelationship, autoTrackRelationship) && !inLiveDate && shouldRunRelationshipJudge) {
          const latestIntent = opts?.intent ?? [...messages].reverse().find((m) => m.role === 'user')?.intent
          // Marked judged NOW, while the caller still holds the generation lock — not inside the
          // fire-and-forget assist below, which finishes seconds later after the lock is released.
          // A regenerate clicked during that gap would otherwise re-read `relationshipJudged` as
          // false and stack a second stat delta on the same message. A judge that then fails just
          // means no delta this turn, same as any other best-effort assist failure.
          await messagesApi.update(targetMessageId, { relationshipJudged: true }).catch(() => {})
          if (autoDetectTasks) {
            tasksHandledByMerge = true
            runAssist('relationship', 'Updating relationship', async () => {
              // Fresh fetch — this runs after the reply already landed, so a stale objective read risks marking tasks against one that's since moved on.
              const objective = await objectivesApi.getActive(chat.id)
              const pending = objective?.tasks.filter((t) => t.status === 'pending') ?? []
              const completedIndices = await updateAffectionFromReply(chat.id, relationshipHistory, combined, latestIntent, speaker, pending)
              if (objective && completedIndices.length > 0) await applyCompletedTasks(objective, pending, completedIndices)
            })
          } else {
            runAssist('relationship', 'Updating relationship', async () => {
              await updateAffectionFromReply(chat.id, relationshipHistory, combined, latestIntent, speaker)
            })
          }
        }
        // During a live date, read how the scene is trending qualitatively instead of scoring stats.
        if (inLiveDate && isPrimarySpeaker) {
          const startedAt = chat.activeEvent?.startedAt ?? 0
          const rapportTail = [
            ...messages
              .filter((m) => m.createdAt >= startedAt && m.text.trim())
              .slice(-7)
              .map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text })),
            { id: targetMessageId, role: 'char' as const, name: speaker.card.name, text: combined },
          ]
          runAssist('rapport', 'Reading the room', async () => {
            const read = await assessRapport(trackingClient, {
              transcript: rapportTail,
              charName: character.card.name,
              userName: persona?.name || 'You',
              charPersonality: character.card.personality,
            }, jobShaping.tracking)
            if (!read) return
            // A genuine dealbreaker ends the date immediately; hangouts are stakes-free so a walkOut read is ignored there.
            if (read.walkOut && chat.activeEvent?.kind === 'date') {
              await endDateEvent({ walkedOut: true })
              return
            }
            await chatsApi.update(chat.id, { rapport: { ...read, updatedAt: Date.now() } })
          })
        }
        if (effectiveAssistFlag(chat.assistOverrides?.autoSuggestChoices, autoSuggestChoices)) {
          runAssist('choices', 'Suggesting replies', () => suggestChoicesForMessage(targetMessageId, relationshipHistory))
        }
        if (autoDetectTasks && !tasksHandledByMerge) {
          runAssist('tasks', 'Checking objective', () => detectAndMarkTasks(chat.id, combined))
        }
        if (autoSummarize) {
          runAssist('summary', 'Updating memory', () => updateMemorySummary())
        }
        if (characterMemoryOn && !opts?.inGmBeat) {
          runAssist('memory', 'Remembering', () => scribeMemories())
        }
        runAssist('vision', 'Reading the scene', async () => {
          if (visionSceneDetection) await refineSceneWithVision(targetMessageId, speaker, combined, images)
          else await refineExpressionFromText(targetMessageId, speaker, combined)
          await refineCharacterForms(targetMessageId, combined)
        })
      } catch (e) {
        toastError(errorMessage(e))
        // `wroteAnything` covers an auto-continue round failing after an earlier round already
        // persisted real content — that content stays rather than getting wiped just because a
        // later extension attempt errored out.
        if (!wasOriginallyContinuing && !wroteAnything) {
          // Empty text, not an error string baked into the message — that string would otherwise
          // get fed back into every future prompt as something the character genuinely said. The
          // UI shows the failure itself, driven by `failed`, not by message content.
          await messagesApi.update(targetMessageId, { text: '', failed: true })
        }
      } finally {
        activeGenerationClientRef.current = null
        setIsGenerating(false)
        setStreamingText('')
        setGeneratingMessageId(null)
      }
    },
    [
      applyCompletedTasks,
      autoDetectTasks,
      secrets,
      chatBackendModel,
      autoSummarize,
      autoSuggestChoices,
      autoTrackRelationship,
      buildCurrentPrompt,
      character,
      chat,
      client,
      modelSettings,
      jobClients,
      jobShaping,
      mainClient,
      replyJobFor,
      templateFor,
      trackingClient,
      countTokens,
      detectAndMarkTasks,
      messages,
      refineExpressionFromText,
      refineCharacterForms,
      refineSceneWithVision,
      resolveSpeaker,
      runAssist,
      sampler,
      suggestChoicesForMessage,
      template,
      updateAffectionFromReply,
      updateMemorySummary,
      visionSceneDetection,
    ],
  )

  /**
   * One Game Master decision (`world/gm.ts`) for the branch as it stands after `playerMsg`. Reads the
   * branch fresh from the server, gives the GM only public context, and validates its answer against
   * the recorded roll. Never throws: a backend failure becomes a deterministic fallback turn.
   */
  const decideGmTurn = useCallback(
    async (branch: StoredMessage[], playerMsg: StoredMessage): Promise<GmTurn | null> => {
      if (!world?.campaign || !character || !chatId) return null
      const rulesMode = modulesForWorld(world).campaignRules
      if (!rulesMode) return null
      // Its own Stop switch. It used to borrow the last reply's, so once a reply had been stopped
      // every ruling after it was cancelled the moment it started, until the page was reloaded.
      const gmAbort = new AbortController()
      abortRef.current = gmAbort
      const freshChat = (await chatsApi.get(chatId)) ?? chat
      const playerName = persona?.name || 'You'
      // The Game Master narrates the whole story, so it hears every earlier scene's recap.
      const gmScenes = freshChat?.storyId ? await storiesApi.scenes(freshChat.storyId).catch(() => [] as Chat[]) : []
      const gmStory = freshChat?.storyId ? await storiesApi.get(freshChat.storyId) : undefined
      const gmChapters = chaptersOf(gmStory, gmScenes.length ? gmScenes : freshChat ? [freshChat] : [])
      const narratorRecap = freshChat ? storyRecapBlock(sceneChain(gmScenes, freshChat), 'narrator', { maxTokens: 900, chapters: gmChapters }) : ''
      const fullRoster = await charactersApi.roster(world.id).catch(() =>
        [character, ...participantCharacters].map((c) => ({ id: c.id, name: c.card.name, occupation: c.occupation, gmEligible: c.gmEligible !== false, rank: sheetForWorld(c, world.id)?.rank })))
      const loadedIds = [character.id, ...(freshChat?.participants ?? [])]
      const presentIds = new Set(freshChat?.scene?.presentCharacterIds ?? loadedIds)
      // The card you play is never AI cast: matched by id, with the name check kept for stories
      // whose player predates cards and personas merging.
      const isPlayer = (c: { id: string; name: string }) => c.id === freshChat?.playerCharacterId || isPlayerCharacter(c.name, playerName)
      const upTo = branch.slice(0, branch.findIndex((m) => m.id === playerMsg.id) + 1)
      const eventsDone = [...(freshChat?.setEventsDone ?? []), ...setEventsDoneFrom(upTo)]
      // Characters the GM plays itself until their set event: not cast, not arrivals, not agents.
      const held = gmHeld(freshChat?.gmPlayed, eventsDone)
      const heldIds = new Set(held.map((p) => p.characterId))
      const cast = fullRoster.filter((c) => presentIds.has(c.id) && !isPlayer(c) && !heldIds.has(c.id))
      const available = fullRoster.filter((c) => !presentIds.has(c.id) && c.gmEligible !== false && !isPlayer(c) && !heldIds.has(c.id))
      const loadedRoster = available.filter((c) => loadedIds.includes(c.id))
      const scenery = currentScenery(upTo, freshChat?.scene)
      const lastTagged = [...upTo].reverse().find((m) => m.role === 'char' && m.scene?.background)?.scene?.background
      const night = sceneryIsNight(scenery, isNightPhase(world.currentPhaseIndex))
      const baseCtx: GmContext = {
        campaign: { ...world.campaign, mode: rulesMode },
        styleGuidance: promptOverride(world.promptOverrides, 'gm-style'),
        worldName: world.name,
        worldDescription: world.description,
        worldRules: world.rules,
        gmNotes: [world.gmNotes, freshChat?.gmNotes].filter(Boolean).join('\n\n'),
        scenario: freshChat?.authorNote?.text,
        storySoFar: [narratorRecap, freshChat?.summary].filter(Boolean).join('\n\n') || undefined,
        chapterBriefing: freshChat ? chapterBriefing(gmChapters, freshChat) || undefined : undefined,
        openThreads: activeFacts.filter((f) => f.unresolved).map((f) => f.text),
        activeObjective: activeObjective?.status === 'active'
          ? [activeObjective.title, ...activeObjective.tasks.filter((t) => t.status === 'pending').map((t) => t.description)].join(' — ')
          : undefined,
        canonFacts: (world.canonFacts ?? []).map((f) => f.text),
        ...(characterMemoryOn ? await (async () => {
          const memories = await memoriesApi.forChat(chatId).catch(() => [])
          const nameOf = (id: string) => (id === freshChat?.playerCharacterId ? playerName : fullRoster.find((c) => c.id === id)?.name)
          return {
            memoryDigest: gmMemoryDigest(memories, nameOf),
            // Present, the player, and anyone loaded to arrive: an entrance this beat must not arrive knowing too much.
            knowledgeGaps: knowledgeGaps(memories, [...cast.map((c) => c.id), ...(freshChat?.playerCharacterId ? [freshChat.playerCharacterId] : []), ...loadedRoster.map((c) => c.id)], nameOf),
          }
        })() : {}),
        branchConsequences: [...(freshChat?.carriedConsequences ?? []), ...branchConsequencesFrom(upTo)],
        recentRolls: recentRollsFrom(upTo.slice(0, -1)),
        scenery: describeScenery(scenery, scenery?.backgroundId ?? lastTagged ?? world.defaultBackgroundId, world, night),
        ...(() => {
          const setting = sceneSettingFrom(upTo, freshChat?.scene, (id) => backgroundLabel(id, world))
          return { location: setting.location, atmosphere: setting.atmosphere }
        })(),
        timeOfDay: (() => {
          const phase = freshChat?.scene?.timePhase ?? PHASES[world.currentPhaseIndex ?? 0]
          // The date matters to the GM once the world counts its own or the clock follows the story.
          return world.calendar || world.advanceClockInPlay ? `${phase}, ${formatCalendarDate(getCalendarInfo(world.currentDay ?? 0, world.calendar))}` : phase
        })(),
        clockFollowsNarration: !!world.advanceClockInPlay && modulesForWorld(world).worldSimulation,
        roster: cast,
        availableRoster: available,
        loadedRoster,
        cardedNames: fullRoster.filter((c) => !isPlayerCharacter(c.name, playerName) && !heldIds.has(c.id)).map((c) => c.name),
        gmPlayed: held.flatMap((p) => {
          const name = fullRoster.find((c) => c.id === p.characterId)?.name
          const until = p.until ? freshChat?.setEvents?.find((e) => e.id === p.until) : undefined
          return name ? [{ id: p.characterId, name, as: p.as, ...(p.form ? { form: p.form } : {}), ...(until ? { until } : {}) }] : []
        }),
        // Whose cards it may read, if it decides a beat needs them: who it plays, who is here, who could arrive.
        cardIndex: [...new Set([
          ...held.map((p) => fullRoster.find((c) => c.id === p.characterId)?.name),
          ...cast.map((c) => c.name),
          ...available.map((c) => c.name),
        ].filter((n): n is string => !!n))],
        canFork: !upTo.slice(-8).some((m) => !!m.gm?.fork),
        loreIndex: callableLore.map(({ id, title }) => ({ id, title })),
        playerName,
        playerId: freshChat?.playerCharacterId,
        // The state as of this action, including what its roll already changed.
        stateLines: world.campaign?.tracks?.length
          ? stateLines(gameStateFrom(world.campaign.tracks, freshChat?.gameState, upTo, { playerId: freshChat?.playerCharacterId }).state, world.campaign.tracks, {
              audience: 'gm',
              playerId: freshChat?.playerCharacterId,
              nameOf: (id) => (id === freshChat?.playerCharacterId ? playerName : fullRoster.find((c) => c.id === id)?.name),
            })
          : undefined,
        playerRank: playerCharacter ? sheetForWorld(playerCharacter, world.id)?.rank : undefined,
        transcript: upTo.slice(-13, -1).filter((m) => m.text.trim()).map((m) => ({
          speaker: m.role === 'user' ? playerName : m.name,
          text: m.text.slice(0, 800),
        })),
        // A requested check is rolled as a separate turn; adjudicate the original action, not
        // the short "I roll" declaration that carried its binding dice result.
        playerAction: playerMsg.campaignRoll?.action || playerMsg.text,
        recordedMove: playerMsg.campaignRoll,
        // Only when this turn has no dice of its own: a fresh roll always governs its own beat.
        earlierRoll: playerMsg.campaignRoll ? undefined : earlierRollFrom(upTo.slice(0, -1)),
        pendingChoice: playerMsg.campaignRoll ? undefined : pendingChoiceFrom(upTo.slice(0, -1)),
        setEvents: (freshChat?.setEvents ?? []).filter((event) => !eventsDone.includes(event.id)),
        maxSpeakers: 3,
      }
      let ctx = baseCtx
      try {
        const maxContext = await gmClient.getEffectiveMaxContext(8192)
        const requestRuling = (extra = '') => {
          const { system, user } = buildGmPrompt(ctx)
          const promptUser = extra ? `${user}\n\n${extra}` : user
          return generateWithTimeout(gmClient, {
            max_length: 700,
            max_context_length: maxContext,
            temperature: 0.7,
            top_p: 0.95,
            rep_pen: 1.05,
            jsonOutput: true,
            prompt: `${system}\n\n${promptUser}`,
            messages: [{ role: 'system', content: system }, { role: 'user', content: promptUser }],
          }, 'Game Master', gmAbort.signal, jobShaping.gm)
        }
        let raw = await requestRuling()
        // It decided this beat needs someone's card: read it, and rule again with it in hand.
        const called = cardCallsFrom(raw, ctx)
        if (called.length) {
          const calledCards = (await Promise.all(called.map(async (name) => {
            const id = fullRoster.find((c) => c.name === name)?.id
            const card = id ? await charactersApi.get(id).catch(() => undefined) : undefined
            return card ? { name, card: cardBrief(card, { userName: playerName }) } : undefined
          }))).filter((c): c is { name: string; card: string } => !!c?.card)
          ctx = { ...ctx, calledCards }
          raw = await requestRuling()
        }
        let turn = parseGmTurn(raw, ctx)
        if (turn.fallback?.startsWith('The GM did not answer a question earned by')) {
          turn = parseGmTurn(await requestRuling(`Correction: ${playerName}'s question is already paid for by the recorded ${ctx.earlierRoll?.moveName} result. Answer it directly in adjudication.outcome, set followUp true, and do not request another roll.`), ctx)
        }
        // Which connection ruled, when it wasn't Main.
        const servedBy = servedByLabel(jobClients.gm)
        if (servedBy) turn = { ...turn, servedBy }
        return turn
      } catch (e) {
        return fallbackGmTurn(baseCtx, `GM model call failed: ${errorMessage(e)}`)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeFacts, activeObjective, character, characterMemoryOn, chat, chatId, gmClient, jobClients.gm, participantCharacters, persona, world, callableLore],
  )

  /** The GM rules, its turn is stored as its own message, then each chosen character agent replies in order. */
  const runGmBeat = useCallback(
    async (playerMsg: StoredMessage, startAt: number) => {
      if (!chatId || !character) return
      setAssistTasks((t) => ({ ...t, gm: 'Game Master is ruling' }))
      setIsGmRuling(true)
      let turn: GmTurn | null
      try {
        turn = await decideGmTurn(await messagesApi.listByChat(chatId), playerMsg)
      } finally {
        setAssistTasks(({ gm: _gm, ...rest }) => rest)
        setIsGmRuling(false)
      }
      // Stopped while the GM was ruling: the beat ends there, with no fallback ruling posted.
      if (!turn || abortRef.current?.signal.aborted) return
      const gmMsg: StoredMessage = {
        id: newId(),
        chatId,
        role: 'char',
        name: GM_NAME,
        speakerId: GM_SPEAKER_ID,
        text: formatGmMessage(turn),
        gm: turn,
        createdAt: startAt,
        // A result waiting on the player's pick offers its options as one-tap replies.
        ...(turn.adjudication?.awaitingChoice?.length ? {
          choiceCards: turn.adjudication.awaitingChoice.map((option) => ({ id: newId(), kind: 'action' as const, label: option, text: `I choose ${option}.` })),
          choices: turn.adjudication.awaitingChoice.map((option) => `I choose ${option}.`),
        } : {}),
      }
      await messagesApi.create(gmMsg)
      // The player's message and the GM's narration, read together, move the clock once.
      await followStoryTime([playerMsg.text, turn.narration])
      if (turn.addCharacterIds?.length) {
        const fresh = await chatsApi.get(chatId)
        if (fresh) {
          const participants = [...new Set([...(fresh.participants ?? []), ...turn.addCharacterIds])].filter((id) => id !== fresh.characterId && id !== fresh.playerCharacterId)
          const scene = fresh.scene?.presentCharacterIds
            ? { ...fresh.scene, presentCharacterIds: [...new Set([...fresh.scene.presentCharacterIds, ...turn.addCharacterIds])] }
            : fresh.scene
          await chatsApi.update(chatId, { participants, scene })
        }
        // Someone new to the story meets everyone present now, and learns names as they hear them.
        const newcomers = (turn.handedOver ?? []).map((h) => h.id)
        if (newcomers.length) {
          const latest = await chatsApi.get(chatId)
          if (latest) {
            const present = latest.scene?.presentCharacterIds ?? [latest.characterId, ...(latest.participants ?? [])]
            const strangers = { ...latest.strangers }
            for (const id of newcomers) strangers[id] ??= strangersFor(id, present, latest.playerCharacterId, gmMsg.createdAt)
            await chatsApi.update(chatId, { strangers } as Partial<Chat>)
          }
        }
        // Handed over in a new form: the stage shows them in it from now on.
        const forms = Object.fromEntries((turn.handedOver ?? []).filter((h) => h.form).map((h) => [h.id, h.form!]))
        if (Object.keys(forms).length) {
          const latest = await chatsApi.get(chatId)
          if (latest?.scene) await chatsApi.update(chatId, { scene: { ...latest.scene, appearanceOverrides: { ...latest.scene.appearanceOverrides, ...forms } } })
        }
        const arrivals = await Promise.all(turn.addCharacterIds.map((id) => charactersApi.get(id).catch(() => undefined)))
        arrivalsRef.current = [...arrivalsRef.current, ...arrivals.filter((c): c is Character => !!c)]
        // Whoever arrives hears the beat that brought them: the player's call and the GM's framing.
        for (const beatMsg of await messagesApi.listByChat(chatId)) {
          if (beatMsg.id !== playerMsg.id && beatMsg.id !== gmMsg.id) continue
          const presentIds = [...new Set([...(beatMsg.presentIds ?? []), ...turn.addCharacterIds])]
          await messagesApi.update(beatMsg.id, { presentIds }).catch(() => {})
        }
      }
      const remoteCards = turn.remoteIds?.length
        ? (await Promise.all(turn.remoteIds.map((id) => charactersApi.get(id).catch(() => undefined)))).filter((c): c is Character => !!c)
        : []
      remoteRef.current = remoteCards
      if (remoteCards.length) {
        // Whoever was reached heard the player's message, and only that. Read the saved presence
        // (the server stamps it on create), so the people here stay witnesses too.
        const saved = await messagesApi.get(playerMsg.id).catch(() => undefined)
        const presentIds = [...new Set([...(saved?.presentIds ?? playerMsg.presentIds ?? []), ...remoteCards.map((c) => c.id)])]
        await messagesApi.update(playerMsg.id, { presentIds }).catch(() => {})
      }
      runAssist('vision', 'Reading the scene', () => refineCharacterForms(gmMsg.id, gmMsg.text))
      if (turn.fork) {
        try {
          const forked = await chatsApi.fork(chatId, gmMsg.id)
          await chatsApi.update(forked.id, { title: turn.fork.title })
          await messagesApi.update(gmMsg.id, { gm: { ...turn, fork: { ...turn.fork, chatId: forked.id } } })
        } catch (e) {
          await messagesApi.update(gmMsg.id, { gm: { ...turn, fork: undefined, corrections: [...(turn.corrections ?? []), `Could not create branch: ${errorMessage(e)}`] } })
        }
      }
      const playerName = persona?.name || 'You'
      // Each agent is told who speaks before and after it this beat, so it can answer the others.
      const castNow = [...participantCharacters, ...arrivalsRef.current, ...remoteCards]
      const nameOfAgent = (id: string) => (id === character.id ? character : castNow.find((c) => c.id === id))?.card.name
      const isRemote = (id: string) => !!turn.remoteIds?.includes(id)
      // A remote reply is private between the player and whoever was reached; the others speak among themselves.
      const beatOrder = turn.speakerIds.filter((id) => !isRemote(id)).map(nameOfAgent).filter((n): n is string => !!n && !isPlayerCharacter(n, playerName))
      const remoteNames = remoteCards.map((c) => c.card.name)
      let at = startAt + 1
      for (const speakerId of turn.speakerIds) {
        const agent = speakerId === character.id ? character : castNow.find((c) => c.id === speakerId)
        if (!agent || isPlayerCharacter(agent.card.name, playerName)) continue
        const replyMsg: StoredMessage = {
          id: newId(),
          chatId,
          role: 'char',
          name: agent.card.name,
          speakerId: agent.id !== character.id ? agent.id : undefined,
          text: '',
          createdAt: at++,
          swipes: [],
          activeSwipe: 0,
          // Only the player and the one reached share a remote reply.
          ...(isRemote(agent.id) ? { presentIds: [agent.id, ...(chat?.playerCharacterId ? [chat.playerCharacterId] : [])] } : {}),
        }
        await messagesApi.create(replyMsg)
        // Each agent hears the GM and whoever already answered this beat — the public transcript only.
        const history: ChatMessage[] = (await messagesApi.listByChat(chatId))
          .filter((m) => m.id !== replyMsg.id)
          .map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
        await runGeneration(history, replyMsg.id, [], {
          speakerId: agent.id,
          inGmBeat: true,
          extraStyleGuidance: [
            isRemote(agent.id)
              ? gmDirectionFor(turn, agent.card.name, playerName, [agent.card.name], false, true)
              : gmDirectionFor(turn, agent.card.name, playerName, beatOrder, !!turn.addCharacterIds?.includes(agent.id) && !turn.handedOver?.some((h) => h.id === agent.id)),
            !isRemote(agent.id) && remoteNames.length
              ? `${remoteNames.join(' and ')} answered ${playerName} from afar; only ${playerName} heard it. ${agent.card.name} knows only what ${playerName} says aloud about it.`
              : '',
            ...(turn.loreCallIds ?? []).map((id) => callableLore.find((l) => l.id === id)?.content.slice(0, 2400)).filter((s): s is string => !!s),
          ].filter(Boolean).join('\n\n'),
        })
        if (abortRef.current?.signal.aborted) break
      }
      remoteRef.current = []
      if (characterMemoryOn) runAssist('memory', 'Remembering', () => scribeMemories())
    },
    [character, chat?.playerCharacterId, characterMemoryOn, chatId, decideGmTurn, followStoryTime, participantCharacters, persona, runAssist, runGeneration, scribeMemories, callableLore, refineCharacterForms],
  )

  /** The roll is durable before the model starts; a failed model call cannot change the dice. */
  const rollCampaignMove = useCallback(async (input: { messageId: string; moveId: string; modifier: number; action: string; text: string; target?: number; rollMode?: 'normal' | 'advantage' | 'disadvantage'; pendingGmMessageId?: string }) => {
    if (!chatId) throw new Error('No active story.')
    if (!beginGeneration()) throw new Error('Wait for the current reply to finish.')
    try {
      const playerMsg = await chatsApi.roll(chatId, input)
      void runGmBeat(playerMsg, playerMsg.createdAt + 1)
        .catch((error) => toastError(`The roll was saved, but the GM could not finish: ${errorMessage(error)}`))
        .finally(endGeneration)
    } catch (error) {
      endGeneration()
      throw error
    }
  }, [beginGeneration, chatId, endGeneration, runGmBeat])

  /** Resume after a reload or model failure when the dice were saved but the GM turn was not. */
  const resumeRecordedRoll = useCallback(async (messageId: string) => {
    if (!chatId || !beginGeneration()) return
    try {
      const branch = await messagesApi.listByChat(chatId)
      const last = branch[branch.length - 1]
      if (!last || last.id !== messageId || !last.campaignRoll) return
      await runGmBeat(last, last.createdAt + 1)
    } finally {
      endGeneration()
    }
  }, [beginGeneration, chatId, endGeneration, runGmBeat])

  /**
   * The player's answer to a GM proposal. A world-scope confirmation also becomes shared canon.
   * `changes` replaces a proposal's tracked-state changes when the player corrected them first.
   */
  const decideGmProposal = useCallback(
    async (messageId: string, proposalId: string, decision: 'confirmed' | 'rejected', changes?: TrackEffect[]) => {
      const msg = await messagesApi.get(messageId)
      const proposal = msg?.gm?.proposals.find((p) => p.id === proposalId)
      if (!msg?.gm || !proposal || proposal.status !== 'pending') return
      const proposals = msg.gm.proposals.map((p) => (p.id === proposalId
        ? { ...p, status: decision, decidedAt: Date.now(), ...(changes && decision === 'confirmed' ? { changes: changes.length ? changes : undefined } : {}) }
        : p))
      await messagesApi.update(messageId, { gm: { ...msg.gm, proposals } })
      if (decision === 'confirmed' && proposal.scope === 'world' && world) {
        const fresh = await worldsApi.get(world.id)
        if (fresh) {
          await worldsApi.update(world.id, {
            canonFacts: [...(fresh.canonFacts ?? []), { id: newId(), text: proposal.text, createdAt: Date.now(), sourceChatId: chatId ?? undefined }],
          })
        }
      }
    },
    [chatId, world],
  )

  /** Records the player's scenery choice on the latest message of this branch (see `vn/scenery.ts`). */
  const setScenery = useCallback(
    async (choice: { backgroundId: string | null; variant: 'auto' | 'day' | 'night' }) => {
      if (!chatId) return
      const scenery = { ...choice, setAt: Date.now() }
      const branch = await messagesApi.listByChat(chatId)
      const last = branch[branch.length - 1]
      if (last) {
        await messagesApi.update(last.id, { scenery })
      } else {
        const fresh = await chatsApi.get(chatId)
        await chatsApi.update(chatId, { scene: { turnPolicy: 'manual', ...fresh?.scene, scenery } })
      }
    },
    [chatId],
  )

  const sendUserMessage = useCallback(
    async (
      text: string,
      attachments: PendingAttachment[] = [],
      opts?: { choice?: ChoiceOption; intent?: MessageIntent; intimacyOptionId?: string; withdrawCheck?: boolean },
    ) => {
      if (!chatId || !beginGeneration()) return
      try {
        // Read fresh rather than the hook's possibly stale `chat` — needed by both the gift block and the scene-policy resolution below.
        const freshChat = await chatsApi.get(chatId)
        if (!freshChat) return
        if (freshChat.endedAt) {
          toastInfo('This scene has ended. Carry on in the next scene.')
          return
        }
        // A gift moves the chosen target's own track, not always the primary's — same "reply as" picker the composer already exposes.
        const { active: giftTarget } = resolveSpeaker(replyAsCharacterId)
        let giftId: string | undefined
        // One-shot reaction steer for the character's next reply turn.
        let giftReactionDirective: string | undefined
        if (opts?.choice?.kind === 'gift' && opts.choice.giftId && giftTarget) {
          const inventory = { ...(freshChat.giftInventory ?? defaultGiftInventory(world)) }
          const inStock = inventory[opts.choice.giftId] ?? 0
          if (inStock <= 0) {
            toastError('That gift is out of stock. Buy another from the relationship panel.')
            return
          }
          inventory[opts.choice.giftId] = inStock - 1
          if (inventory[opts.choice.giftId] <= 0) delete inventory[opts.choice.giftId]
          const gift = giftById(opts.choice.giftId, world)
          const preferenceScore = Math.max(-2, Math.min(3, Number(giftTarget.giftPreferences?.[opts.choice.giftId] ?? 0)))
          const track = getRelationshipTrack(freshChat, giftTarget.id)
          // Recency (not just lifetime count) of this exact gift, so a re-gift reads differently from a first-time one.
          const priorTimesGivenThisGift = track.giftsGiven?.[opts.choice.giftId] ?? 0
          const sameGiftRun = trailingSameGiftRun(track.giftLog, opts.choice.giftId)
          const isMismatch = preferenceScore <= -0.5
          const isBirthdayToday =
            giftTarget.birthday !== undefined && daysUntilAnnualDate(world?.currentDay ?? 0, giftTarget.birthday, world?.calendar) === 0
          // Any gifts (not just this exact one) given in the recent turn window — the soft "don't
          // gift-spam" cap, distinct from sameGiftRun's "not the same gift over and over" one.
          const recentCount = recentGiftCount(track.giftLog, messages.length)
          const baseDelta = giftImpactBase(opts.choice.giftId, world) + preferenceScore
          const birthdayOrRepetitionScaled = giftBirthdayMultiplier(baseDelta, isBirthdayToday, sameGiftRun)
          const giftDelta = Math.round(
            (isBirthdayToday ? birthdayOrRepetitionScaled : birthdayOrRepetitionScaled * giftCadenceMultiplier(recentCount)) +
              giftMismatchPenalty(preferenceScore, priorTimesGivenThisGift),
          )
          const affection = clampAffection((track.affection ?? 0) + giftDelta)
          const warmth = computeWarmth(affection, getRelationshipStats(track))
          const giftsGiven = { ...(track.giftsGiven ?? {}) }
          giftsGiven[opts.choice.giftId] = (giftsGiven[opts.choice.giftId] ?? 0) + 1
          // A gift that genuinely lands opens a short reciprocity window (`gifts.ts`'s `ReciprocityCue`).
          const reciprocityCue: ReciprocityCue | undefined =
            preferenceScore >= 2 ? { startedAtTurn: countCharReplies(messages), reason: 'gift_received' } : undefined
          await chatsApi.update(chatId, {
            ...patchRelationshipTrack(freshChat, giftTarget.id, {
              affection,
              relationshipStage: relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds)),
              giftsGiven,
              giftLog: appendGiftLog(track.giftLog, opts.choice.giftId, messages.length),
              ...(reciprocityCue ? { reciprocityCue } : {}),
            }),
            // The owned-stock side of a gift stays a shared wallet, not tied to one relationship.
            giftInventory: inventory,
          })
          giftId = opts.choice.giftId
          if (gift) {
            text = `*I give ${giftTarget.card.name} ${withIndefiniteArticle(gift.name)}.* ${text}`
            // A birthday supersedes the normal taste-based read entirely, not just amplifies it.
            giftReactionDirective = isBirthdayToday
              ? birthdayGiftGuidance(giftTarget.card.name, gift.name)
              : giftReactionGuidance(
                  giftTarget.card.name,
                  persona?.name || 'You',
                  gift.name,
                  sameGiftRun,
                  isMismatch,
                  priorTimesGivenThisGift,
                  recentCount,
                  isMismatch ? undefined : { rarity: gift.rarity, preferenceScore },
                )
            // A genuinely meaningful gift, the first couple of times, earns a durable remembered fact so the character can call back to it later.
            if (preferenceScore >= 2 && priorTimesGivenThisGift < 2) {
              chatFactsApi
                .create({
                  chatId,
                  text: `${persona?.name || 'You'} gave ${giftTarget.card.name} ${withIndefiniteArticle(gift.name)}, and it really meant something to them.`,
                  importance: 0.6,
                  valence: 0.7,
                })
                .catch(() => {})
            }
          }
        }
        // Same `<i>`/`**` → `*action*` normalization the model's own output gets, so stored text/history/display all agree.
        const composedText = composeMessageText(normalizeRpMarkup(text), attachments).trim()
        const apiImages = collectImageBase64(attachments)
        if (!composedText && apiImages.length === 0) return
        if (!reducedAudio) playSendBlip()

        const storedImages = attachments.filter((a) => a.kind === 'image').map((a) => a.dataUrl)

        // An explicit-tier intimacy action puts the character into their designated intimate outfit right away, stamped onto the player's message so it takes effect immediately.
        const usedIntimacyOption = opts?.intimacyOptionId ? intimacyItemById(opts.intimacyOptionId, world) : undefined
        const startsIntimateScene = !!usedIntimacyOption && isExplicitCategory(usedIntimacyOption.category) && !!giftTarget
        const intimateOutfit =
          startsIntimateScene && giftTarget
            ? intimateOutfitFor(giftTarget.outfits, giftTarget.sprites, getRelationshipTrack(freshChat, giftTarget.id).affection ?? 0, new Set(freshChat.sceneFlags ?? []))
            : undefined
        // Opens the aftercare window (`dating/aftercare.ts`) on the same signal that changes the
        // outfit: the app knows an intimate scene is starting because the player deliberately
        // started one, so neither needs inferring from the prose. Re-opening while one is already
        // live just restarts the clock, which is the right reading of a second scene.
        if (startsIntimateScene && giftTarget) {
          const priorTargetTrack = getRelationshipTrack(freshChat, giftTarget.id)
          // Item 12's escalation-shape memory: only a still-*live* prior scene counts as a
          // continuation (see `startOrShiftIntimacyScene`'s own doc comment) — a stale one (left over
          // from a rewind/fork) isn't this relationship's actual current scene and shouldn't have its
          // shape carried forward.
          //
          // Looked up chat-wide, not on the clicked character's own track: choosing an intimate
          // action on a second character while a scene is already running means bringing them *into*
          // that scene, which is the app's one deliberate signal for a multi-participant scene. A
          // per-track lookup would find nothing for them and start a rival state machine instead.
          const liveScene = findActiveIntimacyScene(freshChat, (sc: IntimacyScene) =>
            isIntimacySceneActive(sc, countCharReplies(messages)),
          )
          const priorSceneForShape = liveScene?.scene
          // The scene keeps its original owner when someone joins it — one scene, one place it lives.
          const sceneOwner = liveScene?.ownerId ?? giftTarget.id
          const roster = liveScene
            ? withParticipant(liveScene.scene, giftTarget.id, liveScene.ownerId)
            : [giftTarget.id]
          // The aftercare window is per-relationship and belongs to whoever was just chosen; the scene
          // itself belongs to its owner. The two coincide except when someone is joining a scene, so
          // they are patched separately and chained, since `patchRelationshipTrack` rewrites the whole
          // participant map for a non-primary.
          const afterglowPatch = patchRelationshipTrack(freshChat, giftTarget.id, {
              afterglow: {
                startedAtTurn: countCharReplies(messages),
                sourceLabel: usedIntimacyOption!.label,
                momentumAtStart: priorTargetTrack.momentum ?? 0,
              },
          })
          const startedScene = {
              // Starts (or re-centers) the intimacy scene at `building`, tracking what's now physically happening.
              // A scene continuing from a live one keeps its shape; a fresh one picks the most specific
              // scenario this relationship and content dial actually allow (`dating/scenarios.ts`).
              intimacyScene: startOrShiftIntimacyScene(
                resolveIntimacyPromptNote(usedIntimacyOption!, giftTarget.card.name),
                usedIntimacyOption!.category,
                countCharReplies(messages),
                priorSceneForShape,
                intimacyArousalWeight(usedIntimacyOption!),
                priorSceneForShape
                  ? scenarioById(getScenarioCatalog(world), priorSceneForShape.scenarioId)
                  : selectScenario(getScenarioCatalog(world), {
                      arousal: 0,
                      intimacyLevel: resolveIntimacyLevel(world?.intimacyLevel, globalIntimacyLevel),
                      ownedItemIds: new Set(Object.entries(freshChat.toyInventory ?? {}).filter(([, n]) => n > 0).map(([id]) => id)),
                      relationship: {
                        affection: priorTargetTrack.affection ?? 0,
                        warmth: computeWarmth(priorTargetTrack.affection ?? 0, getRelationshipStats(priorTargetTrack)),
                        stats: getRelationshipStats(priorTargetTrack),
                        flags: new Set((freshChat.sceneFlags ?? []) as SceneFlag[]),
                        commitmentStatus: priorTargetTrack.commitmentStatus ?? 'none',
                        day: world?.currentDay,
                      },
                    }),
                // How this character feels about what was just chosen, frozen onto the scene: an
                // eager kink speeds every gain that follows, a disliked one slows them.
                combinedValence(giftTarget.kinkProfile, intimacyEntryKinks(usedIntimacyOption!)),
                // Kept alongside that stance so every *other* participant's own feelings about the
                // same content can be scored against their own profile each turn.
                intimacyEntryKinks(usedIntimacyOption!),
                roster,
              ),
          }
          const afterglowApplied = { ...freshChat, ...afterglowPatch }
          await chatsApi.update(chatId, {
            ...afterglowPatch,
            ...patchRelationshipTrack(afterglowApplied, sceneOwner, startedScene),
          })
        }
        // A `kissing_spot` click unlocks the commitment ladder's first-kiss gate immediately, rather than waiting on next turn's AI classifier to notice it in prose.
        if (usedIntimacyOption?.category === 'kissing_spot' && !(freshChat.sceneFlags ?? []).includes(FIRST_KISS_FLAG)) {
          await chatsApi.update(chatId, { sceneFlags: [...(freshChat.sceneFlags ?? []), FIRST_KISS_FLAG] })
        }

        const now = Date.now()
        const userMsg: StoredMessage = {
          id: newId(),
          chatId,
          role: 'user',
          name: persona?.name || 'You',
          text: composedText,
          giftId,
          intent: opts?.intent,
          intimacyAction: usedIntimacyOption
            ? { label: usedIntimacyOption.label, category: usedIntimacyOption.category, optionId: usedIntimacyOption.id }
            : undefined,
          scene: intimateOutfit ? { outfit: intimateOutfit } : undefined,
          images: storedImages.length ? storedImages : undefined,
          createdAt: now,
        }
        await messagesApi.create(userMsg)

        // Follow a time-of-day the player just narrated ("the next morning", "at lunch", "that night"):
        // a per-chat override of the shared world clock's phase, cleared back to null once the
        // narration lands back on the world clock's own phase.
        // A GM beat reads this message together with its own narration (`runGmBeat`).
        const gmTurns = !!world?.campaign && modulesForWorld(world).campaignRules && (freshChat.scene?.turnPolicy ?? 'manual') === 'gm' && !opts?.withdrawCheck
        const clockFollowsStory = !!world?.advanceClockInPlay && modulesForWorld(world).worldSimulation
        if (!gmTurns) await followStoryTime([composedText])
        // With the clock following the story it is the one time of day; the looser per-scene guess
        // below (which "good night" or "this morning" would trip) is for worlds whose clock doesn't.
        const narratedPhase = clockFollowsStory ? undefined : detectNarratedPhase(composedText)
        if (narratedPhase) {
          const worldPhase = PHASES[world?.currentPhaseIndex ?? 0]
          const nextPhaseOverride = narratedPhase === worldPhase ? null : narratedPhase
          if ((freshChat.scene?.timePhase ?? null) !== nextPhaseOverride) {
            await chatsApi.update(chatId, {
              scene: { turnPolicy: 'manual', ...freshChat.scene, timePhase: nextPhaseOverride },
            })
          }
        }

        // Who actually replies, per the chat's turn policy — `manual` keeps the "reply as" choice above; the others need a roster to pick from.
        let speaker = giftTarget
        const turnPolicy = freshChat.scene?.turnPolicy ?? 'manual'
        // Withdrawal cancels an unresolved declaration without asking the GM to adjudicate it.
        if (opts?.withdrawCheck) return
        if (world?.campaign && modulesForWorld(world).campaignRules && turnPolicy === 'gm') {
          // The Game Master rules on what the player attempts, so a form change waits for its result
          // (read from the GM's own message), not the player's proposal.
          await runGmBeat(userMsg, now + 1)
          return
        }
        // With no Game Master to rule on it, a form the player narrates or asks for ("{change her to
        // human form}") is settled before anyone replies, so the reply, and the stage, already show it.
        await refineCharacterForms(userMsg.id, composedText, { fromPlayer: true }).catch(() => {})
        if (turnPolicy !== 'manual' && character && participantCharacters.length > 0) {
          const roster = rosterFrom(character, participantCharacters)
          if (turnPolicy === 'round_robin') {
            const next = nextRoundRobinSpeaker(roster, freshChat.scene?.roundRobinIndex)
            if (next) {
              speaker = resolveSpeaker(next.id).active
              // Advanced immediately so a rapid second send can't reuse this same index while this one is still generating.
              await chatsApi.update(chatId, { scene: { ...freshChat.scene!, roundRobinIndex: next.nextIndex } })
            }
          } else if (turnPolicy === 'mention') {
            const mention = parseMention(text, roster)
            if (mention) speaker = resolveSpeaker(mention.id).active
          } else if (turnPolicy === 'director') {
            const historyForDirector: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
            const pickedId = await pickDirectorSpeaker(gmClient, {
              roster,
              history: historyForDirector,
              userName: persona?.name || 'You',
              sceneLocation: sceneSettingFrom(messages, freshChat.scene, (id) => backgroundLabel(id, world)).location,
            }, jobShaping.gm)
            if (pickedId) speaker = resolveSpeaker(pickedId).active
          }
        }

        // createdAt offset by 1ms so this reply sorts after the user's turn despite both being created synchronously.
        const charMsg: StoredMessage = {
          id: newId(),
          chatId,
          role: 'char',
          name: speaker?.card.name || character?.card.name || 'Character',
          speakerId: speaker && speaker.id !== character?.id ? speaker.id : undefined,
          text: '',
          createdAt: now + 1,
          swipes: [],
          activeSwipe: 0,
        }
        await messagesApi.create(charMsg)

        const historyForPrompt: ChatMessage[] = [...messages, userMsg].map((m) => ({
          id: m.id,
          role: m.role,
          name: m.name,
          text: m.text,
        }))
        // Names what was just initiated explicitly — a terse action alone reads like a stage direction the model can skip past.
        const intimacyDirective =
          usedIntimacyOption && speaker
            ? intimacyActionDirective(usedIntimacyOption, persona?.name || 'You', speaker.card.name)
            : undefined
        await runGeneration(historyForPrompt, charMsg.id, apiImages, {
          speakerId: speaker?.id ?? null,
          intent: opts?.intent,
          // Both directives are one-shot corrections for this exact reply turn only, never persisted.
          extraStyleGuidance: [intimacyDirective, giftReactionDirective].filter(Boolean).join(' ') || undefined,
        })
      } finally {
        endGeneration()
      }
    },
    [beginGeneration, character, chatId, gmClient, endGeneration, followStoryTime, messages, participantCharacters, persona, reducedAudio, refineCharacterForms, replyAsCharacterId, resolveSpeaker, runGeneration, runGmBeat, world],
  )

  const regenerate = useCallback(
    async (messageId: string) => {
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      // Claimed after the lookup, and before the blanking write below, so a second rapid click can't land on a run already streaming into this row.
      if (!beginGeneration()) return
      try {
        const priorMessages = messages.slice(0, idx)
        // Re-ruling after character replies would leave those replies attached to an obsolete
        // decision (possibly even a different check result). Rewind that beat first.
        if (messages[idx].gm) {
          const nextUserIndex = messages.findIndex((m, i) => i > idx && m.role === 'user')
          const beatEnd = nextUserIndex < 0 ? messages.length : nextUserIndex
          if (messages.slice(idx + 1, beatEnd).some((m) => m.role === 'char')) {
            toastInfo('Rewind the character replies before regenerating this GM ruling.')
            return
          }
          const playerMsg = [...priorMessages].reverse().find((m) => m.role === 'user')
          setIsGmRuling(true)
          let turn: GmTurn | null = null
          try {
            turn = playerMsg ? await decideGmTurn(messages, playerMsg) : null
          } finally {
            setIsGmRuling(false)
          }
          // A stopped re-ruling keeps the ruling that was there rather than a fallback.
          if (turn && !abortRef.current?.signal.aborted) await messagesApi.update(messageId, { text: formatGmMessage(turn), gm: turn })
          return
        }
        const historyForPrompt: ChatMessage[] = priorMessages.map((m) => ({
          id: m.id,
          role: m.role,
          name: m.name,
          text: m.text,
        }))
        await messagesApi.update(messageId, { text: '', failed: false, boundaryFlag: null, povFlag: null, explicitQualityFlag: null, continuityFlag: null })
        // An agent reply inside a GM beat keeps the GM's ruling as its steer on a regenerate too.
        const beatStart = [...priorMessages].reverse().find((m) => m.role === 'user' || m.gm)
        const speakerCard = messages[idx].speakerId ? participantCharacters.find((c) => c.id === messages[idx].speakerId) : character
        const beatOrder = (beatStart?.gm?.speakerIds ?? [])
          .map((id) => (id === character?.id ? character : participantCharacters.find((c) => c.id === id))?.card.name)
          .filter((n): n is string => !!n)
        const gmSteer = beatStart?.gm && speakerCard ? gmDirectionFor(beatStart.gm, speakerCard.card.name, persona?.name || 'You', beatOrder) : undefined
        // Keeps whoever originally spoke — switching speaker is a distinct, explicit edit action.
        await runGeneration(historyForPrompt, messageId, latestImages(priorMessages), { speakerId: messages[idx].speakerId, extraStyleGuidance: gmSteer })
      } finally {
        endGeneration()
      }
    },
    [beginGeneration, character, decideGmTurn, endGeneration, messages, participantCharacters, persona, runGeneration],
  )

  /**
   * Item 4's player-facing "steer" control — separate from both intent chips (which color the
   * player's own next line) and Author's Note (a standing, persistent steer). Re-generates one
   * specific reply with a strong, explicit, one-shot correction (`dating/steer.ts`) folded into
   * `extraStyleGuidance` for just this call — nothing is written to the chat, the character card, or
   * any persistent prompt section. Byte-for-byte mirrors `regenerate` otherwise (same lock, same
   * "keep whoever originally said it" rule); a blank `steerText` just falls back to a plain
   * regenerate rather than silently doing nothing.
   */
  const regenerateWithSteer = useCallback(
    async (messageId: string, steerText: string) => {
      const trimmed = steerText.trim()
      if (!trimmed) return regenerate(messageId)
      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) return
      if (!beginGeneration()) return
      try {
        const priorMessages = messages.slice(0, idx)
        const historyForPrompt: ChatMessage[] = priorMessages.map((m) => ({
          id: m.id,
          role: m.role,
          name: m.name,
          text: m.text,
        }))
        await messagesApi.update(messageId, { text: '', failed: false, boundaryFlag: null, povFlag: null, explicitQualityFlag: null, continuityFlag: null })
        const speakerId = messages[idx].speakerId
        const charName = (speakerId ? participantCharacters.find((c) => c.id === speakerId) : character)?.card.name ?? character?.card.name ?? 'the character'
        await runGeneration(historyForPrompt, messageId, latestImages(priorMessages), {
          speakerId,
          extraStyleGuidance: buildSteerDirective(trimmed, charName),
        })
      } finally {
        endGeneration()
      }
    },
    [beginGeneration, character, endGeneration, messages, participantCharacters, regenerate, runGeneration],
  )

  const swipe = useCallback(
    async (messageId: string, direction: 'left' | 'right') => {
      const msg = messages.find((m) => m.id === messageId)
      if (!msg) return
      const swipes = msg.swipes ?? [msg.text]
      const current = msg.activeSwipe ?? 0
      if (direction === 'right' && current === swipes.length - 1) {
        // Only this branch generates; the lock also covers the `swipes` append so two fast clicks can't both push an empty swipe.
        if (!beginGeneration()) return
        try {
          const idx = messages.findIndex((m) => m.id === messageId)
          const priorMessages = messages.slice(0, idx)
          const historyForPrompt: ChatMessage[] = priorMessages.map((m) => ({
            id: m.id,
            role: m.role,
            name: m.name,
            text: m.text,
          }))
          const newSwipes = [...swipes, '']
          await messagesApi.update(messageId, {
            swipes: newSwipes,
            activeSwipe: newSwipes.length - 1,
            text: '',
            boundaryFlag: null,
            povFlag: null,
            explicitQualityFlag: null,
            continuityFlag: null,
          })
          await runGeneration(historyForPrompt, messageId, latestImages(priorMessages), { speakerId: msg.speakerId })
        } finally {
          endGeneration()
        }
        return
      }
      const nextIndex = direction === 'left' ? Math.max(0, current - 1) : Math.min(swipes.length - 1, current + 1)
      await messagesApi.update(messageId, {
        activeSwipe: nextIndex,
        text: swipes[nextIndex],
        scene: msg.swipeScenes?.[nextIndex],
        rawText: msg.swipeRawTexts?.[nextIndex],
        // Flags aren't tracked per-swipe (unlike `scene`) — cleared here rather than left attached to different content.
        boundaryFlag: null,
        povFlag: null,
        explicitQualityFlag: null,
        continuityFlag: null,
      })
    },
    [beginGeneration, endGeneration, messages, runGeneration],
  )

  const continueMessage = useCallback(async () => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'char' || !last.text.trim()) return
    if (!beginGeneration()) return
    try {
      const historyForPrompt: ChatMessage[] = messages.map((m) => ({
        id: m.id,
        role: m.role,
        name: m.name,
        text: m.text,
      }))
      const continueUndo = { text: last.text, rawText: last.rawText, scene: last.scene }
      await runGeneration(historyForPrompt, last.id, latestImages(messages), {
        continuing: true,
        speakerId: last.speakerId,
        continueUndo,
      })
    } finally {
      endGeneration()
    }
  }, [beginGeneration, endGeneration, messages, runGeneration])

  const canContinue =
    messages.length > 0 &&
    messages[messages.length - 1].role === 'char' &&
    // A GM turn is a ruling, not prose to extend in some character's voice.
    !messages[messages.length - 1].gm &&
    !!messages[messages.length - 1].text.trim()

  const canUndoLastContinue =
    messages.length > 0 && messages[messages.length - 1].role === 'char' && !!messages[messages.length - 1].continueUndo

  /** Reverts the last message back to how it read right before its most recent "Continue" — discards the appended segment entirely rather than regenerating it. */
  const undoLastContinue = useCallback(async () => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'char') return
    const freshMsg = await messagesApi.get(last.id)
    const undo = freshMsg?.continueUndo
    if (!undo) return
    const activeSwipe = freshMsg?.activeSwipe ?? 0
    const swipes = freshMsg?.swipes?.length ? [...freshMsg.swipes] : [undo.text]
    swipes[activeSwipe] = undo.text
    const swipeScenes = freshMsg?.swipeScenes ? [...freshMsg.swipeScenes] : []
    swipeScenes[activeSwipe] = undo.scene
    const swipeRawTexts = freshMsg?.swipeRawTexts ? [...freshMsg.swipeRawTexts] : []
    swipeRawTexts[activeSwipe] = undo.rawText
    await messagesApi.update(last.id, {
      text: undo.text,
      rawText: undo.rawText,
      scene: undo.scene,
      swipes,
      swipeScenes,
      swipeRawTexts,
      activeSwipe,
      tokenCount: await countTokens(undo.text),
      continueUndo: null,
    })
  }, [messages])

  /** Re-runs just the "Continue" step from the same pre-continue point, discarding the current appended segment for a freshly generated one instead. */
  const regenerateLastContinueSegment = useCallback(async () => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'char' || !last.continueUndo) return
    if (!beginGeneration()) return
    try {
      const continueUndo = last.continueUndo
      const historyForPrompt: ChatMessage[] = messages.map((m) => ({
        id: m.id,
        role: m.role,
        name: m.name,
        text: m.id === last.id ? continueUndo.text : m.text,
      }))
      await runGeneration(historyForPrompt, last.id, latestImages(messages), {
        continuing: true,
        speakerId: last.speakerId,
        continueUndo,
      })
    } finally {
      endGeneration()
    }
  }, [beginGeneration, endGeneration, messages, runGeneration])

  /** Suggests what the persona might say next, in their voice — returned for the caller to drop into the composer, never auto-sent. */
  const impersonate = useCallback(async (): Promise<string> => {
    if (!character || !chat) return ''
    const historyForPrompt: ChatMessage[] = messages.map((m) => ({
      id: m.id,
      role: m.role,
      name: m.name,
      text: m.text,
    }))
    const built = await buildCurrentPrompt(historyForPrompt, { impersonateAsUser: true })
    if (!built) return ''
    const text = await generateWithTimeout(
      client,
      { ...sampler, prompt: built.prompt, genkey: makeGenKey() },
      'Suggest a reply',
    )
    // Strips a leading "Kai: "-style label echo the same way the character reply path does.
    const cleaned = cleanModelOutput(text, { charName: persona?.name || 'You', personaName: character.card.name })
    // Same empty/echo/duplicate guard the char-turn pipeline uses for `isUsableReply`.
    const recentTexts = historyForPrompt.slice(-6).map((m) => m.text)
    if (!cleaned.trim() || isVerbatimEcho(cleaned, historyForPrompt[historyForPrompt.length - 1]?.text) || isDuplicateOfRecentText(cleaned, recentTexts)) {
      throw new Error("Couldn't come up with a suggestion that fit — try again.")
    }
    return cleaned
  }, [buildCurrentPrompt, character, chat, client, messages, persona?.name, sampler])

  /** Drafts the player's action line for a Relationship-panel intimacy option, adapted to the current scene rather than one fixed sentence. Returned for the composer, never auto-sent. */
  const draftIntimacyAction = useCallback(
    async (optionId: string): Promise<string> => {
      if (!character || !chat) return ''
      const option = intimacyItemById(optionId, world)
      if (!option) return ''
      const personaName = persona?.name || 'You'
      const charName = character.card.name
      const historyForPrompt: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
      // Explicitly a deliberate change FROM whatever was happening, not a continuation — a drafted action can otherwise drift back onto the prior beat instead of the one actually clicked.
      const directive = [
        `${personaName} is choosing to do exactly this, right now: ${resolveIntimacyPromptNote(option, charName)}.`,
        `This is a deliberate change FROM whatever was just happening in the scene, not a continuation of it — write ${personaName} actually transitioning into THIS specific action. The current mood, position, and what everyone is or isn't wearing are still there to adapt the transition around, never a reason to keep doing the previous act instead of this one.`,
        `One to three sentences, present tense, in ${personaName}'s voice. Actions in *asterisks*, anything said aloud in "quotes".`,
        `A starting point, only if it helps: ${composeIntimacyActionText(option, charName)}`,
      ].join(' ')
      const built = await buildCurrentPrompt(historyForPrompt, { impersonateAsUser: true, extraStyleGuidance: directive })
      if (!built) return ''
      const text = await generateWithTimeout(
        client,
        { ...sampler, prompt: built.prompt, genkey: makeGenKey() },
        'Adapt intimacy action',
      )
      return cleanModelOutput(text, { charName: personaName, personaName: charName })
    },
    [buildCurrentPrompt, character, chat, client, messages, persona?.name, sampler, world],
  )

  const createObjective = useCallback(
    async (title: string, description: string, createdBy: 'user' | 'ai' = 'user') => {
      if (!chatId || !title.trim()) return
      // Only one objective can be active per chat — retire whatever was active before.
      const existing = await objectivesApi.listByChat(chatId, 'active')
      for (const o of existing) await objectivesApi.update(o.id, { status: 'abandoned' })
      await objectivesApi.create({
        chatId,
        title: title.trim(),
        description: description.trim(),
        tasks: [],
        status: 'active',
        createdBy,
      })
    },
    [chatId],
  )

  const generateTasksForActiveObjective = useCallback(async () => {
    if (!activeObjective || !character) return
    const tasks = await generateTasks(
      trackingClient,
      activeObjective.title,
      activeObjective.description ?? '',
      character.card,
      4,
      jobShaping.tracking,
    )
    const newTasks: ObjectiveTask[] = tasks.map((description) => ({
      id: newId(),
      description,
      status: 'pending',
    }))
    await objectivesApi.update(activeObjective.id, { tasks: [...activeObjective.tasks, ...newTasks] })
  }, [activeObjective, character, trackingClient])

  const addManualTask = useCallback(
    async (description: string) => {
      if (!activeObjective || !description.trim()) return
      const task: ObjectiveTask = { id: newId(), description: description.trim(), status: 'pending' }
      await objectivesApi.update(activeObjective.id, { tasks: [...activeObjective.tasks, task] })
    },
    [activeObjective],
  )

  const toggleTask = useCallback(
    async (taskId: string) => {
      if (!activeObjective) return
      const now = Date.now()
      const tasks = activeObjective.tasks.map((t) =>
        t.id === taskId
          ? { ...t, status: t.status === 'done' ? ('pending' as const) : ('done' as const), completedAt: now }
          : t,
      )
      await objectivesApi.update(activeObjective.id, { tasks })
    },
    [activeObjective],
  )

  const setObjectiveStatus = useCallback(
    async (status: 'completed' | 'abandoned') => {
      if (!activeObjective) return
      await objectivesApi.update(activeObjective.id, { status })
      // `null`, not `undefined` — JSON.stringify would drop an undefined key and leave the stale activeEvent in place.
      if (chatId) await chatsApi.update(chatId, { activeEvent: null })
      // Completing an objective is an earning moment too, distinct from a date/hangout's own payout. Only 'completed' grants coins.
      if (status === 'completed' && chatId) {
        const coinsGranted = await getCoinMutex(chatId).run(async () => {
          const liveChat = await chatsApi.get(chatId)
          if (!liveChat) return 0
          await chatsApi.update(chatId, { giftCoins: Math.max(0, (liveChat.giftCoins ?? 0) + OBJECTIVE_COMPLETE_COIN_BONUS) })
          return OBJECTIVE_COMPLETE_COIN_BONUS
        })
        if (coinsGranted) toastSuccess(`Objective complete — +${coinsGranted} coins`, { chime: true })
      }
    },
    [activeObjective, chatId],
  )

  /** Proposes a plausible objective from the character + persona — returned for the caller to review before creating it. */
  const suggestObjectiveIdea = useCallback(async (): Promise<{ title: string; description: string }> => {
    if (!character) return { title: '', description: '' }
    return suggestObjective(
      trackingClient,
      character.card,
      { name: persona?.name || 'You', description: persona?.description || '' },
      jobShaping.tracking,
    )
  }, [character, trackingClient, persona])

  const suggestDateEventIdea = useCallback(async (): Promise<DateEventCard | null> => {
    if (!character || !chat) return null
    const availableBackgrounds = getUnlockedBackgroundIds(world, chat.affection ?? 0)
    return suggestDateEvent(trackingClient, {
      characterName: character.card.name,
      characterDescription: character.card.description,
      personaName: persona?.name || 'You',
      worldDescription: world?.description,
      availableBackgrounds,
      affection: chat.affection ?? 0,
      commitmentStatus: chat.commitmentStatus ?? 'none',
      recentGiftName: recentMeaningfulGiftName(chat.giftLog, character.giftPreferences, world),
    }, jobShaping.tracking)
  }, [character, chat, trackingClient, persona?.name, world])

  /** Starting a date/hangout spends one of the world's daily energy actions; gift/milestone cards stay free. No world means energy doesn't apply. */
  const startDateEvent = useCallback(
    async (event: DateEventCard) => {
      if (!chatId || !event.title.trim() || !event.objectiveTitle.trim()) return
      // Snapshotted before the energy spend below can roll the world clock to next morning, so the opener still grounds on the moment the activity is actually happening in.
      let openingMomentNote: string | undefined
      if ((event.kind === 'date' || event.kind === 'hangout') && world) {
        const freshWorld = await worldsApi.get(world.id)
        const day = freshWorld?.currentDay ?? 0
        const phaseIndex = freshWorld?.currentPhaseIndex ?? 0
        // `free` (a world-triggered scene, never a player-picked one) skips the energy gate and
        // spend entirely — the player didn't choose to spend a day's action on this, so it
        // shouldn't cost one, and it must not silently fail to fire just because today's are gone.
        if (!event.free && getEnergyRemaining(day, phaseIndex) <= 0) {
          toastError(`No energy left today — get some rest before starting another ${event.kind === 'hangout' ? 'hangout' : 'date'}.`)
          return
        }
        if (character) {
          const moment = activityPhase(day, phaseIndex)
          // `styleGuidance` isn't macro-substituted, so macros are resolved here rather than leaking literally into the prompt.
          openingMomentNote = substituteMacros(
            describeWorldMoment({
              worldId: world.id,
              characterId: character.id,
              day: moment.day,
              phaseIndex: moment.phaseIndex,
              weatherPreferences: character.weatherPreferences,
              calendar: world.calendar,
            }),
            { charName: character.card.name, userName: persona?.name || 'You' },
          )
        }
        if (!event.free) {
          const result = spendEnergy(day, phaseIndex)
          await worldsApi.update(world.id, { currentDay: result.day, currentPhaseIndex: result.phaseIndex })
          // The world clock just moved — a narrated-time override from before is stale now.
          if (chat?.scene?.timePhase) await chatsApi.update(chatId, { scene: { ...chat.scene, timePhase: null } })
          if (result.slept) {
            const weather = getWeather(world.id, result.day, world.calendar)
            toastSuccess(`Tired after a full day, you call it a night. A new morning dawns — ${describeWeather(weather)}.`)
          }
        }
      }
      await createObjective(event.objectiveTitle, event.objectiveDescription ?? event.description ?? '', 'ai')
      // Best-effort hidden agenda for what the character secretly wants from this date; never blocks starting it.
      let hiddenAgenda: string | undefined
      if (event.kind === 'date' && character) {
        const warmthLabel = formatRelationshipStage(
          relationshipStageForWarmth(
            computeWarmth(chat?.affection ?? 0, getRelationshipStats({ relationshipStats: chat?.relationshipStats })),
            relationshipMilestonesFor(world?.relationshipThresholds),
          ),
        )
        hiddenAgenda =
          (await draftHiddenAgenda(trackingClient, {
            charName: character.card.name,
            charPersonality: character.card.personality,
            charGoals: character.goals,
            charBoundaries: character.boundaries,
            eventTitle: event.title,
            warmthLabel,
          }, jobShaping.tracking).catch(() => null)) ?? undefined
      }
      // Marks this as a live, scored date/hangout; also the cutoff `endDateEvent` uses to gather its transcript. Clears any leftover rapport read.
      await chatsApi.update(chatId, { activeEvent: { ...event, startedAt: Date.now(), hiddenAgenda }, rapport: null })

      // The character opens the scene themselves the instant it starts, rather than leaving an empty composer waiting on the player.
      if ((event.kind === 'date' || event.kind === 'hangout') && character) {
        const sceneNoun = event.kind === 'hangout' ? 'hangout' : 'date'
        // The lock claim doubles as a liveness check: another generation could still be in flight, and runGeneration's shared refs can't run two at once.
        if (!beginGeneration()) {
          toastInfo(`${event.title} has started — ${character.card.name} will pick it up as soon as the current reply finishes, or send a message yourself.`)
        } else {
          try {
            const openerId = newId()
            await messagesApi.create({
              id: openerId,
              chatId,
              role: 'char',
              name: character.card.name,
              text: '',
              createdAt: Date.now(),
              swipes: [],
              activeSwipe: 0,
            })
            const historyForPrompt: ChatMessage[] = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
            await runGeneration(historyForPrompt, openerId, [], {
              extraStyleGuidance: [
                `This is the very start of the ${sceneNoun} — ${character.card.name} arrives and opens the moment themselves (a greeting, a glance, a first line or gesture), rather than waiting for ${persona?.name || 'them'} to speak first. Do not narrate that you are waiting, and do not ask what happens next.`,
                openingMomentNote,
              ]
                .filter(Boolean)
                .join(' '),
            })
          } finally {
            endGeneration()
          }
        }
      }
    },
    [beginGeneration, character, chat?.affection, chat?.relationshipStats, chatId, trackingClient, createObjective, endGeneration, messages, persona?.name, runGeneration, world],
  )
  // Kept current every render — see `startDateEventRef`'s own doc comment, above `askForCommitment`.
  startDateEventRef.current = startDateEvent

  /** Ends an active date/hangout with one validated judge pass over its whole transcript. A scene with no messages just closes quietly. */
  const endDateEvent = useCallback(async (opts?: { walkedOut?: boolean }) => {
    if (!chatId || !character) return
    const freshChat = await chatsApi.get(chatId)
    const event = freshChat?.activeEvent
    if (!freshChat || !event?.startedAt) return
    const startedAt = event.startedAt

    const closeOutEvent = async () => {
      // Rapport is scene-scoped, so it clears with the date it belonged to.
      await chatsApi.update(chatId, { activeEvent: null, rapport: null })
      if (activeObjective) await objectivesApi.update(activeObjective.id, { status: 'completed' })
    }

    const dateMessages = messages.filter((m) => m.createdAt >= startedAt && m.text.trim())
    const transcript: ChatMessage[] = dateMessages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: m.text }))
    const intents = dateMessages.filter((m) => m.role === 'user' && m.intent).map((m) => m.intent as string)
    if (transcript.length === 0) {
      await closeOutEvent()
      toastSuccess(`${event.title} ended without anything happening.`)
      return
    }

    const currentAffection = freshChat.affection ?? 0
    const currentStats = getRelationshipStats(freshChat)
    const existingFlags = new Set((freshChat.sceneFlags ?? []) as SceneFlag[])
    const outcome = await assessDateOutcome(trackingClient, {
      transcript,
      eventTitle: event.title,
      charName: character.card.name,
      userName: persona?.name || 'You',
      current: { affection: currentAffection, ...currentStats },
      knownFacts: activeFacts.map((f) => f.text),
      customFlags: world?.customSceneFlags,
      intents,
      hiddenAgenda: event.hiddenAgenda,
      walkedOut: opts?.walkedOut,
      sceneKind: event.kind === 'hangout' ? 'hangout' : 'date',
    }, jobShaping.tracking)
    const deltas = scaleDeltasForDifficulty(outcome.deltas, relationshipDifficulty)
    outcome.newFlags.forEach((flag) => existingFlags.add(flag))
    if (outcome.newFacts.length > 0) {
      const sourceMessageId = transcript[transcript.length - 1]?.id
      for (const f of outcome.newFacts) {
        chatFactsApi
          .create({ chatId, text: f.text, sourceMessageId, importance: f.importance, valence: f.valence, unresolved: f.unresolved || undefined })
          .catch(() => {})
      }
    }
    const affection = clampAffection(currentAffection + deltas.affection)
    let nextStats = { ...currentStats }
    for (const dim of RELATIONSHIP_DIMENSIONS) nextStats[dim] = clampStat(currentStats[dim] + deltas[dim])
    const milestones = relationshipMilestonesFor(world?.relationshipThresholds)
    const previousStage = relationshipStageForWarmth(computeWarmth(currentAffection, currentStats), milestones)
    const risk = applyRelationshipRisk({
      charName: character.card.name,
      commitmentStatus: freshChat.commitmentStatus ?? 'none',
      stats: nextStats,
      existingWarning: freshChat.relationshipWarning,
      breakupCount: freshChat.breakupCount ?? 0,
    })
    nextStats = risk.stats
    const warmth = computeWarmth(affection, nextStats)
    const relationshipStage = relationshipStageForWarmth(warmth, milestones)

    const unlockedSet = new Set(freshChat.unlockedGalleryIds ?? [])
    const previouslyUnlockedIds = new Set(unlockedSet)
    unlockedEndingIds(character.gallery, relationshipStage, unlockedSet).forEach((id) => unlockedSet.add(id))
    const lockedGallery = (character.gallery ?? []).filter(
      (g) => !g.isEnding && !unlockedSet.has(g.id) && hasRequiredFlags(g.requiredFlags, existingFlags),
    )
    if (lockedGallery.length > 0) {
      const unlockedIds = await detectGalleryUnlocks(trackingClient, {
        character,
        locked: lockedGallery,
        affection,
        latestReply: outcome.recap,
      }, jobShaping.tracking)
      unlockedIds.forEach((id) => unlockedSet.add(id))
    }

    // Coins scale with how the date actually went. Balance is re-read inside the coin mutex, not the possibly-stale `freshChat` snapshot, so a mid-date Shop purchase can't race it.
    const coinsEarned = Math.max(0, Math.round(deltas.affection * 2))
    await getCoinMutex(chatId).run(async () => {
      const liveChat = (await chatsApi.get(chatId)) ?? freshChat
      const nextCoins = (liveChat.giftCoins ?? 0) + coinsEarned
      await chatsApi.update(chatId, {
        affection,
        relationshipStats: nextStats,
        relationshipStage,
        sceneFlags: [...existingFlags],
        unlockedGalleryIds: [...unlockedSet],
        giftCoins: nextCoins,
        commitmentStatus: risk.commitmentStatus,
        relationshipWarning: risk.relationshipWarning ?? null,
        breakupCount: risk.breakupCount,
      })
    })
    await closeOutEvent()

    const changedDeltas = Object.fromEntries(Object.entries(deltas).filter(([, v]) => v !== 0))
    relationshipEventsApi
      .create({
        chatId,
        reason: `${event.title}: ${outcome.recap}`,
        deltas: changedDeltas,
        newFlags: outcome.newFlags.length ? outcome.newFlags : undefined,
        sourceMessageId: transcript[transcript.length - 1]?.id,
      })
      .catch(() => {})

    // A walkout is a real, bad outcome — a red toast, not the usual congratulatory tone.
    if (opts?.walkedOut) toastError(outcome.recap)
    else toastSuccess(outcome.recap)
    if (coinsEarned > 0) toastSuccess(`Earned ${coinsEarned} coins from the ${event.kind === 'hangout' ? 'hangout' : 'date'}`)
    await announceMilestone({
      charName: character.card.name,
      personaName: persona?.name || 'You',
      chatId,
      previousStage,
      relationshipStage,
      sourceMessageId: transcript[transcript.length - 1]?.id,
      characterId: character.id,
      turnCount: countCharReplies(messages),
    })
    for (const id of unlockedSet) {
      if (previouslyUnlockedIds.has(id)) continue
      const entry = character.gallery?.find((g) => g.id === id)
      toastSuccess(entry?.isEnding ? `An ending unlocked: ${entry.title}` : `New gallery scene unlocked: ${entry?.title ?? 'untitled'}`)
    }
  }, [activeFacts, activeObjective, character, chatId, trackingClient, messages, persona?.name, relationshipDifficulty, world])

  /**
   * Runs one activity picked from `DayPlannerPanel`. A 'rest' just spends the world's energy and
   * advances the clock, mirroring the energy-spend block already inside `startDateEvent` — no
   * scene, no objective, no `activeEvent` touched, so it's free of any LLM cost. A 'hangout'
   * (Meet/Text) builds a deterministic `DateEventCard` and hands it to the *existing*,
   * already-tested `startDateEvent`/`endDateEvent` pipeline unchanged, then — only for Meet, the
   * one gap that pipeline actually has — calls `updateScene({ location })` so the scene picks up
   * the activity's location instead of staying wherever it last was.
   */
  const runDayPlannerActivity = useCallback(
    async (activity: DayPlannerActivity) => {
      if (activity.kind === 'rest') {
        if (!world) return
        const freshWorld = await worldsApi.get(world.id)
        const day = freshWorld?.currentDay ?? 0
        const phaseIndex = freshWorld?.currentPhaseIndex ?? 0
        const result = spendEnergy(day, phaseIndex)
        await worldsApi.update(world.id, { currentDay: result.day, currentPhaseIndex: result.phaseIndex })
        if (chatId && chat?.scene?.timePhase) await chatsApi.update(chatId, { scene: { ...chat.scene, timePhase: null } })
        const weather = getWeather(world.id, result.day, world.calendar)
        toastSuccess(
          result.slept
            ? `You call it a night. A new morning dawns — ${describeWeather(weather)}.`
            : `You take some time to rest and recharge.`,
        )
        return
      }
      if (!character) return
      const card = dateEventCardForActivity(activity, character.card.name)
      await startDateEvent(card)
      if (activity.location) await updateScene({ location: activity.location })
    },
    [character, startDateEvent, updateScene, world],
  )

  const forkChat = useCallback(
    async (messageId?: string) => {
      if (!chatId) return
      try {
        const forked = await chatsApi.fork(chatId, messageId)
        setActiveChatId(forked.id)
        toastSuccess('Forked into a new chat — the original is untouched.')
      } catch (e) {
        toastError(errorMessage(e))
      }
    },
    [chatId, setActiveChatId],
  )

  const editMessage = useCallback(async (messageId: string, text: string) => {
    const msg = await messagesApi.get(messageId)
    const swipes = msg?.swipes ? [...msg.swipes] : [text]
    if (msg?.activeSwipe !== undefined && swipes[msg.activeSwipe] !== undefined) {
      swipes[msg.activeSwipe] = text
    }
    // A hand-edit is the player's own words now — the old flag no longer describes what's there.
    await messagesApi.update(messageId, { text, swipes, boundaryFlag: null, povFlag: null, explicitQualityFlag: null, continuityFlag: null })
  }, [])

  const deleteMessage = useCallback(async (messageId: string) => {
    await messagesApi.remove(messageId)
  }, [])

  /**
   * Section 15's "Rewind" — the bulk case one-at-a-time delete doesn't cover: back out of a scene
   * that went several turns in an unwanted direction by deleting a message and everything after
   * it, in one action. Deliberately not a new server endpoint — `messages` (already loaded,
   * already in order) tells us exactly which ids that is; no bulk-delete route exists or is needed
   * for a local single-user app's message counts. Unlike forking (section 4), which is for
   * *keeping* both branches, this discards the tail outright.
   */
  /**
   * Rewinds the scene to `messageId` on the server (#57): the message and everything after it go, and
   * so do the memories, facts, relationship changes and objective progress they made; the scene's
   * relationships, gifts and scene state come back from the checkpoint saved with the message.
   * `restoreClock` also puts the shared world clock back.
   */
  const rewindToMessage = useCallback(
    async (messageId: string, opts?: { restoreClock?: boolean }) => {
      if (!chatId) return undefined
      // Nothing still writing into the part being removed.
      abortRef.current?.abort()
      return chatsApi.rewind(chatId, { messageId, restoreClock: opts?.restoreClock })
    },
    [chatId],
  )

  const togglePinMessage = useCallback(async (messageId: string) => {
    const msg = await messagesApi.get(messageId)
    await messagesApi.update(messageId, { pinned: !msg?.pinned })
  }, [])

  const abortGeneration = useCallback(async () => {
    abortRef.current?.abort()
    if (genKeyRef.current) await (activeGenerationClientRef.current ?? client).abort(genKeyRef.current)
    setIsGenerating(false)
  }, [client])

  return {
    chat,
    character,
    persona,
    playerCharacter,
    world,
    activeObjective,
    participantCharacters,
    replyAsCharacterId,
    setReplyAsCharacterId,
    messages,
    isGenerating,
    isGmRuling,
    streamingText,
    generatingMessageId,
    genStats,
    assistActivity,
    sendUserMessage,
    rollCampaignMove,
    resumeRecordedRoll,
    regenerate,
    regenerateWithSteer,
    swipe,
    editMessage,
    deleteMessage,
    rewindToMessage,
    decideGmProposal,
    setScenery,
    togglePinMessage,
    abortGeneration,
    previewPrompt,
    updateAuthorNote,
    updateScene,
    updateGmNotes,
    updateSetEvents,
    updateGmPlayed,
    changeLead,
    editGameState,
    updateParticipants,
    switchPlayer,
    story,
    storyScenes,
    contextUsage,
    draftSceneRecap,
    draftChapterRecap,
    updateChapter,
    finishScene,
    updateMemorySummary,
    continueMessage,
    canContinue,
    canUndoLastContinue,
    undoLastContinue,
    regenerateLastContinueSegment,
    impersonate,
    draftIntimacyAction,
    createObjective,
    generateTasksForActiveObjective,
    addManualTask,
    toggleTask,
    setObjectiveStatus,
    suggestObjectiveIdea,
    suggestDateEventIdea,
    startDateEvent,
    endDateEvent,
    runDayPlannerActivity,
    regenerateChoices,
    buyGift,
    buyItem,
    buyToy,
    buyOutfit,
    chooseIntimacyBranch,
    useItem,
    askForCommitment,
    initiateFirstTime,
    endRelationship,
    forkChat,
    client,
  }
}
