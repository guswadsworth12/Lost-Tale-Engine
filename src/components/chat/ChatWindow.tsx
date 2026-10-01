import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Menu,
  Backpack,
  BookOpen,
  CalendarDays,
  CalendarHeart,
  Clapperboard,
  Download,
  Drama,
  Dices,
  GitFork,
  Heart,
  ImagePlus,
  MessageCircle,
  NotebookPen,
  MapPin,
  ScrollText,
  Search,
  SlidersHorizontal,
  Star,
  Sunrise,
  Target,
  Users,
  Wrench,
  X,
} from 'lucide-react'
import { useChatSession } from '@/lib/hooks/useChatSession'
import { BrandWordmark } from '@/components/ui/BrandMark'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, momentsApi, worldsApi } from '@/lib/api/client'
import { generateWithTimeout } from '@/lib/api/generateWithTimeout'
import { takeMessageJump } from '@/lib/scrollToMessage'
import { useModelFor } from '@/lib/hooks/useModelFor'
import { buildImprovePromptRequest, type MomentContext, type MomentKind, type StoryMoment } from '@/lib/story/moments'
import { PictureThisDialog } from '@/components/story/PictureThisDialog'
import { IconButton } from '@/components/ui/IconButton'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { scrollToMessage } from '@/lib/scrollToMessage'
import { buildChatTranscriptHtml, chatTranscriptFilename, downloadChatTranscript } from '@/lib/export/chatTranscript'
import { parseSfxWordList } from '@/lib/text/messageSegments'
import { useBgmSceneStore } from '@/lib/store/useBgmSceneStore'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { getEnergyRemaining, PHASES, presenceLabel, resolveScheduledPresence } from '@/lib/world/calendar'
import { getWorldTemplate, modulesForWorld } from '@/lib/world/worldTemplates'
import { sheetForWorld } from '@/lib/world/campaign'
import {
  computeWarmth,
  formatRelationshipStage,
  getRelationshipStats,
  isLiveScene,
  relationshipMilestonesFor,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { ChatToolbar, type ChatToolbarAction } from './ChatToolbar'
import { PlaySession } from './PlaySession'
import { StoryPanel, type StoryTab } from './StoryPanel'
import { useVnChromeStore } from '@/lib/store/useVnChromeStore'
import { ChoiceList } from './ChoiceList'
import { QuickReplyBar } from './QuickReplyBar'
import { IntentChips } from './IntentChips'
import { LiveRapport } from './LiveRapport'
import { StageMeter } from '@/components/ui/Stage'
import type { MessageIntent } from '@/lib/dating/intent'
import { GenerationHud } from './GenerationHud'
import { Composer } from './Composer'
import { ConnectionBadge } from './ConnectionBadge'
import { PromptInspector } from './PromptInspector'
import { ObjectivePanel } from './ObjectivePanel'
import { DateEventPanel } from './DateEventPanel'
import { DayPlannerPanel } from './DayPlannerPanel'
import { CalendarPanel } from './CalendarPanel'
import { RelationshipPanel } from './RelationshipPanel'
import { AuthorNotePanel } from './AuthorNotePanel'
import { AssistActivityBar } from './AssistActivityBar'
import { SearchPanel } from './SearchPanel'
import { PinnedMessagesPanel } from './PinnedMessagesPanel'
import { BagPanel } from './BagPanel'
import { DirectorPanel } from './DirectorPanel'
import { TuningPanel } from './TuningPanel'
import { ReactivePortrait } from './ReactivePortrait'
import { ScenePanel } from './ScenePanel'
import { CampaignMovePanel } from './CampaignMovePanel'
import { SceneryPicker } from './SceneryPicker'
import { GmActionsContext } from './GmTurnCard'
import type { TrackEffect } from '@/lib/world/gameState'
import { currentScenery } from '@/lib/vn/scenery'
import { sceneSettingFrom } from '@/lib/chat/sceneSetting'
import { backgroundLabel } from '@/lib/vn/backgrounds'
import { GM_NAME, GM_SPEAKER_ID, branchConsequencesFrom, earlierRollFrom } from '@/lib/world/gm'
import { ContextMeter } from '@/components/story/ContextMeter'
import { EndSceneDialog, type EndSceneConfirmInput } from '@/components/story/EndSceneDialog'
import { EndedSceneBanner } from '@/components/story/EndedSceneBanner'
import { StoryTranscript } from '@/components/story/StoryTranscript'
import { nextSceneOf } from '@/lib/story/library'
import { sceneBreakHint } from '@/lib/story/sceneBreak'
import { sceneLabel } from '@/lib/story/recaps'
import { chapterIdOf, chapterLabel, chaptersOf } from '@/lib/story/chapters'
import type { RecapDraft } from '@/lib/story/recapWriter'
import { MAIN_STORYLINE_ID } from '@/lib/types'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { TextAreaField } from '@/components/ui/Field'
import { nextRoundRobinSpeaker, rosterFrom } from '@/lib/chat/scene'
import { resolveExpressionSprite } from '@/lib/vn/expressions'
import { appearanceForCharacter } from '@/lib/vn/appearances'
import { isVnReady } from '@/lib/vn/artHint'
import { countCharReplies } from '@/lib/dating/aftercare'
import { getGiftCatalog } from '@/lib/dating/gifts'
import { getItemCatalog } from '@/lib/dating/items'
import { composeIntimacyActionText, intimacyItemById, type IntimacyUnlockable } from '@/lib/dating/intimacyCatalog'

/**
 * The main chat screen: header, toolbar, and either the default message-log layout or VNStage's
 * visual-novel layout, plus every side panel (relationship, objective, scene, inspector, etc.)
 * they share. Wires `useChatSession`'s state/actions together with settings and display state.
 */
export function ChatWindow({
  chatId,
  onBack,
  onOpenStudio,
  onOpenMenu,
  onOpenSettings,
  onNavigateToWorld,
}: {
  chatId: string | null
  onBack?: () => void
  onOpenStudio?: () => void
  /** The app menu while playing: expands the desktop rail, or opens the phone drawer. */
  onOpenMenu?: () => void
  /** Deep link from the Quick tuning panel's "Open full Generation settings" — optional so ChatWindow stays usable without a view-switcher in scope. */
  onOpenSettings?: () => void
  /** The Relationship panel's "Customize in World editor" link — optional for the same reason as `onOpenSettings`. */
  onNavigateToWorld?: (worldId: string, tab?: string) => void
}) {
  const session = useChatSession(chatId)
  const {
    chat,
    character,
    persona,
    playerCharacter,
    world,
    participantCharacters,
    replyAsCharacterId,
    setReplyAsCharacterId,
    messages,
    isGenerating,
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
    updateParticipants,
    switchPlayer,
    story,
    storyScenes,
    contextUsage,
    draftSceneRecap,
    draftChapterRecap,
    finishScene,
    updateMemorySummary,
    continueMessage,
    canContinue,
    canUndoLastContinue,
    undoLastContinue,
    regenerateLastContinueSegment,
    impersonate,
    draftIntimacyAction,
    activeObjective,
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
  } = session

  const globalVisualNovelMode = useSettingsStore((s) => s.visualNovelMode)
  // Story moments (`story/moments.ts`): pictures made from this scene, shown by the line they picture.
  const allMoments = useApiQuery('moments', () => momentsApi.list(), []) ?? []
  const momentsByMessage = useMemo(() => {
    const map = new Map<string, StoryMoment[]>()
    for (const m of allMoments) if (m.chatId === chat?.id && m.messageId) map.set(m.messageId, [...(map.get(m.messageId) ?? []), m])
    return map
  }, [allMoments, chat?.id])
  const [picturing, setPicturing] = useState<{ messageId?: string } | null>(null)
  const [stageMoment, setStageMoment] = useState<StoryMoment | null>(null)
  const autoImprovePicture = useSettingsStore((s) => s.autoImprovePicturePrompt)
  const pictureIncludeEveryone = useSettingsStore((s) => s.pictureIncludeEveryone)
  const storyModel = useModelFor('images')
  const improvePicturePrompt = async (prompt: string, kind: MomentKind, context: MomentContext) => (await generateWithTimeout(storyModel, {
    prompt: buildImprovePromptRequest(prompt, kind, context), max_length: 400, max_context_length: await storyModel.getEffectiveMaxContext(4096), temperature: 0.7, top_p: 0.95, rep_pen: 1.05,
  }, 'Improve picture prompt')).trim()
  const vnInputMode = useSettingsStore((s) => s.vnInputMode)
  const autoTrackRelationship = useSettingsStore((s) => s.autoTrackRelationship)
  const quickReplies = useSettingsStore((s) => s.quickReplies)
  const showGenerationHud = useSettingsStore((s) => s.showGenerationHud)
  const regexScripts = useSettingsStore((s) => s.regexScripts)
  const sfxBursts = useSettingsStore((s) => s.sfxBursts)
  const sfxWords = useSettingsStore((s) => s.sfxWords)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)
  const firstReplyTipDismissed = useSettingsStore((s) => s.firstReplyTipDismissed)
  const dismissFirstReplyTip = useSettingsStore((s) => s.dismissFirstReplyTip)
  // For the Scene panel's invite picker and Play As, not the roster itself (`participantCharacters`).
  const allCharacters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const otherCharacters = character ? allCharacters.filter((c) => c.id !== character.id) : allCharacters
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showInspector, setShowInspector] = useState(false)
  const [showObjective, setShowObjective] = useState(false)
  const [showEvent, setShowEvent] = useState(false)
  const [showDayPlanner, setShowDayPlanner] = useState(false)
  const [showCalendar, setShowCalendar] = useState(false)
  const [showRelationship, setShowRelationship] = useState(false)
  const [showAuthorNote, setShowAuthorNote] = useState(false)
  const [showScene, setShowScene] = useState(false)
  const [showCampaignMove, setShowCampaignMove] = useState(false)
  const [pendingCheck, setPendingCheck] = useState<{ messageId: string; moveId: string; action: string; target?: number } | null>(null)
  const [showScenery, setShowScenery] = useState(false)
  const [showWorldFact, setShowWorldFact] = useState(false)
  const [worldFactText, setWorldFactText] = useState('')
  const [savingWorldFact, setSavingWorldFact] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [showPinned, setShowPinned] = useState(false)
  const [showBag, setShowBag] = useState(false)
  const [showDirector, setShowDirector] = useState(false)
  const [showTuning, setShowTuning] = useState(false)
  const [showStoryPanel, setShowStoryPanel] = useState(false)
  const [showEndScene, setShowEndScene] = useState(false)
  const [recapDraft, setRecapDraft] = useState<RecapDraft | null>(null)
  const [draftingRecap, setDraftingRecap] = useState(false)
  const [recapError, setRecapError] = useState<string | undefined>()
  const [showTranscript, setShowTranscript] = useState(false)
  const [storyPanelPinned, setStoryPanelPinned] = useState(false)
  const [storyTab, setStoryTab] = useState<StoryTab>('scene')
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [draft, setDraft] = useState('')
  const [armedIntent, setArmedIntent] = useState<MessageIntent | null>(null)
  // Set when a Relationship-panel intimacy action populates the composer; carries the outfit/aftercare side effects into the next send.
  const [armedIntimacyOptionId, setArmedIntimacyOptionId] = useState<string | null>(null)
  const [refreshingChoices, setRefreshingChoices] = useState(false)
  const [exporting, setExporting] = useState(false)
  // VN quick menu's Auto toggle — off by default, never persisted, and reset below on every chat
  // switch, so it can never silently keep running somewhere the user forgot about. See
  // `handleAutoAdvanceFire`'s own doc comment for the rest of the safety rails.
  const [autoAdvance, setAutoAdvance] = useState(false)
  const autoAdvanceCountRef = useRef(0)
  const autoAdvanceStartRef = useRef<number | null>(null)

  useEffect(() => {
    setArmedIntent(null)
    setArmedIntimacyOptionId(null)
    setAutoAdvance(false)
  }, [chatId])

  useEffect(() => {
    if (autoAdvance) {
      autoAdvanceCountRef.current = 0
      autoAdvanceStartRef.current = Date.now()
    }
  }, [autoAdvance])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, streamingText])

  // Publishes the last reply's scene for the app-level music player (GlobalBgm).
  const setBgmScene = useBgmSceneStore((s) => s.setScene)
  const lastChar = [...messages].reverse().find((m) => m.role === 'char')
  const lastCharScene = lastChar?.swipeScenes?.[lastChar.activeSwipe ?? 0] ?? lastChar?.scene
  useEffect(() => {
    setBgmScene(lastCharScene)
  }, [lastCharScene?.mood, lastCharScene?.background, setBgmScene])

  // A failed reply never re-arms `handleAutoAdvanceFire` on its own — `dialogueComplete` in
  // `VNStage` requires `!failed`, so its schedule effect just never fires again for this message.
  // That's already safe (no retry storm), but the toggle would otherwise sit there still showing
  // "on" and pulsing while actually dormant — this turns it off outright so the UI doesn't lie.
  useEffect(() => {
    if (autoAdvance && lastChar?.failed) setAutoAdvance(false)
  }, [autoAdvance, lastChar?.failed])

  useEffect(() => {
    setDraft('')
  }, [chatId])

  useEffect(() => {
    if (highlightedId) scrollToMessage(scrollRef.current, highlightedId)
  }, [highlightedId])

  // Arrow-key swipe navigation on the latest reply; never triggers a new-swipe generation at the last index.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      const last = [...messages].reverse().find((m) => m.role === 'char')
      if (!last) return
      const swipes = last.swipes ?? [last.text]
      const current = last.activeSwipe ?? 0
      const dir = e.key === 'ArrowLeft' ? 'left' : 'right'
      if (dir === 'left' && current === 0) return
      if (dir === 'right' && current >= swipes.length - 1) return
      e.preventDefault()
      swipe(last.id, dir)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [messages, swipe])

  // A jump from search or the pinned panel; VNStage handles its own scroll-to since it must open its backlog drawer first.
  const jumpToMessage = (id: string) => {
    setShowSearch(false)
    setShowPinned(false)
    setHighlightedId(id)
    if (highlightTimeoutRef.current) clearTimeout(highlightTimeoutRef.current)
    highlightTimeoutRef.current = setTimeout(() => setHighlightedId(null), 2200)
  }

  // A jump from the Gallery's story moments, once the message it pictures has loaded.
  useEffect(() => {
    if (!chat?.id) return
    const target = takeMessageJump(chat.id, (id) => messages.some((m) => m.id === id))
    if (target) jumpToMessage(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id, messages.length])

  const jumpToChat = (otherChatId: string) => {
    setShowSearch(false)
    setShowPinned(false)
    setActiveChatId(otherChatId)
  }

  const exportTranscript = async () => {
    if (!chat || exporting) return
    setExporting(true)
    try {
      const html = await buildChatTranscriptHtml({
        chat,
        character,
        persona,
        messages,
        cast: participantCharacters,
        regexScripts,
        sfx: !sfxBursts
          ? { disabled: true }
          : { extraWords: [...parseSfxWordList(sfxWords), ...(character?.sfxWords ?? [])] },
      })
      downloadChatTranscript(html, chatTranscriptFilename(chat.title))
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  // Chat-level override wins over the global Settings → Appearance default. Either can be `'auto'`
  // — resolved to a real boolean via `isVnReady` (character has sprites, world has scene art) so
  // 'auto' never shows a blank void, and everything past this point reads the resolved boolean.
  // Computed here, above the early return below, because the effect that publishes it is a hook.
  const visualNovelModule = modulesForWorld(world ?? { template: chat?.mode }).visualNovel
  const vnModeSetting = chat?.assistOverrides?.visualNovelMode ?? (visualNovelModule ? globalVisualNovelMode : false)
  const resolvedVisualNovelMode = !!chat && (vnModeSetting === 'auto' ? isVnReady(character, world) : vnModeSetting)
  // Panels opened over the stage wear its glass rather than the app's own surface — see
  // `useVnChromeStore`. Cleared on unmount so leaving the chat can't strand a dialog in VN dress.
  const setVnChrome = useVnChromeStore((s) => s.setActive)
  useEffect(() => {
    setVnChrome(resolvedVisualNovelMode)
    return () => setVnChrome(false)
  }, [resolvedVisualNovelMode, setVnChrome])

  if (!chatId || !chat) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <BrandWordmark size={44} className="mb-2" />
        <p className="text-xl font-medium text-text">Pick a story to continue</p>
        <p className="text-sm text-text-muted">Or start a new one from the chats list. Every tale needs a first line.</p>
      </div>
    )
  }

  // In-chat VN toggle: writes an explicit per-chat override (never 'auto' — that's only reachable
  // from Settings/RelationshipPanel), clearing back to "inherit" when the new value would just
  // match the global default. Same precedence contract as RelationshipPanel's own override selects.
  const toggleVnForChat = () => {
    const next = { ...(chat.assistOverrides ?? {}) }
    const target = !resolvedVisualNovelMode
    if (target === (visualNovelModule ? globalVisualNovelMode : false)) delete next.visualNovelMode
    else next.visualNovelMode = target
    chatsApi.update(chat.id, { assistOverrides: next }).catch((e) => toastError(errorMessage(e)))
  }
  // Post-first-reply tip: a one-time nudge toward the two changes that most alter the experience,
  // once there's an actual completed reply to react to and at least one of them still applies.
  // Dismissing it is permanent (`firstReplyTipDismissed`) — this is a first-run orientation, not a
  // recurring reminder.
  const showFirstReplyTip =
    !firstReplyTipDismissed && !isGenerating && !!lastChar?.text && !lastChar.failed && (!resolvedVisualNovelMode || !character?.worldId)
  const pinnedCount = messages.filter((m) => m.pinned).length
  // Reactive portrait for the default (non-VN) layout, using the same expression resolution as VNStage's sprite.
  const reactivePortraitExpression = lastCharScene?.expression || 'neutral'
  const reactivePortraitUrl = resolveExpressionSprite(
    character?.sprites,
    character?.spriteUnlocks,
    character?.avatarDataUrl,
    reactivePortraitExpression,
    chat.affection ?? 0,
    character ? appearanceForCharacter(messages, {
      id: character.id, name: character.card.name, outfits: character.outfits, sprites: character.sprites,
    }, character.id, chat.affection ?? 0, new Set(chat.sceneFlags ?? []), chat.scene?.appearanceOverrides?.[character.id]) : undefined,
    { variants: character?.spriteVariants, seed: lastChar?.id ?? 'no-message' },
  )
  // Only meaningful for a world-bound character with an authored schedule; most stay unbadged.
  // Uses the same scene-reconciled presence the prompt does (per-chat time-of-day override, an
  // established scene location) so the badge can't say "in class" while the scene is elsewhere.
  // Where the scene is now, replayed from the branch (`chat/sceneSetting.ts`).
  const sceneSetting = sceneSettingFrom(messages, chat.scene, (id) => backgroundLabel(id, world))
  const sceneEnded = !!chat.endedAt
  // Dropped transcript messages mean the scene no longer fits, whatever the raw token count says.
  const contextRatio = contextUsage && contextUsage.budget > 0
    ? Math.max(contextUsage.used / contextUsage.budget, contextUsage.dropped > 0 ? 0.9 : 0)
    : 0
  const breakHint = sceneEnded
    ? null
    : sceneBreakHint({
        contextRatio,
        messagesInScene: messages.length,
        locationChanged: sceneSetting.source !== 'chat' && sceneSetting.location && sceneSetting.location !== chat.scene?.location ? sceneSetting.location : undefined,
      })
  const draftRecap = () => {
    setDraftingRecap(true)
    setRecapError(undefined)
    draftSceneRecap()
      .then(setRecapDraft)
      .catch((e) => setRecapError(errorMessage(e)))
      .finally(() => setDraftingRecap(false))
  }
  const openEndScene = () => {
    setShowEndScene(true)
    setRecapDraft(null)
    draftRecap()
  }
  const contextMeter = contextUsage && !sceneEnded ? (
    <span data-tour="context-meter" className="flex shrink-0 items-center">
      <ContextMeter used={contextUsage.used} budget={contextUsage.budget} hint={breakHint} onEndScene={openEndScene} compact />
    </span>
  ) : null
  const modules = modulesForWorld(world ?? { template: chat.mode })
  const openStoryTab = (next: StoryTab) => { setStoryTab(next); setShowStoryPanel(true) }
  const presence =
    world && character?.schedule?.length
      ? resolveScheduledPresence(
          character.schedule,
          world.currentDay ?? 0,
          chat.scene?.timePhase ? PHASES.indexOf(chat.scene.timePhase) : (world.currentPhaseIndex ?? 0),
          sceneSetting.location,
        )
      : undefined
  // Always the primary character's warmth, unlike VNStage's Bond card — this header's identity is always the primary's.
  const warmth = computeWarmth(chat.affection ?? 0, getRelationshipStats(chat))
  // Computed live rather than trusted from the stored `chat.relationshipStage`, so it can't drift out of sync.
  const relationshipStage = relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds))

  // Built once, rendered as the header toolbar (tone="chrome") or folded into VNStage's overlay (tone="glass").
  const toolbarTone = resolvedVisualNovelMode ? 'glass' : 'chrome'
  const romanceFocus = modules.romanceEmphasis === 'focus'
  const showDateControls = modules.dating && (chat.assistOverrides?.showDateEventButton ?? romanceFocus)
  const scenery = currentScenery(messages, chat.scene)
  const lastMessage = messages[messages.length - 1]
  const pendingGmAdjudication = lastMessage?.gm?.adjudication
  const pendingGmMessageId = pendingGmAdjudication?.source === 'roll_needed' ? lastMessage.id : undefined
  const pendingRollMessageId = lastMessage?.campaignRoll ? lastMessage.id : undefined
  const pendingRulingMessageId = lastMessage?.gm?.mode === 'mechanical' && lastMessage.gm.fallback && !lastMessage.gm.adjudication ? lastMessage.id : undefined
  const earnedQuestions = modules.campaignRules === 'mechanical' && chat.scene?.turnPolicy === 'gm' ? earlierRollFrom(messages) : undefined
  const gmActions = {
    decideProposal: (messageId: string, proposalId: string, decision: 'confirmed' | 'rejected', changes?: TrackEffect[]) =>
      void decideGmProposal(messageId, proposalId, decision, changes).catch((e) => toastError(errorMessage(e))),
    nameOf: (id: string) =>
      id === GM_SPEAKER_ID ? GM_NAME : [character, ...participantCharacters].find((c) => c?.id === id)?.card.name ?? id,
    openChat: (id: string) => setActiveChatId(id),
    pendingCheckMessageId: pendingGmMessageId,
    rollForCheck: (messageId: string, moveId: string, action: string) => {
      if (messageId !== pendingGmMessageId) return
      setPendingCheck({ messageId, moveId, action, target: pendingGmAdjudication?.target })
      setShowCampaignMove(true)
    },
    tracks: modules.campaignRules ? world?.campaign?.tracks : undefined,
    people: allCharacters.map((c) => ({ id: c.id, name: c.card.name })),
  }
  const toolbarActions: ChatToolbarAction[] = [
    {
      key: 'relationship',
      icon: Heart,
      label: 'Relationship',
      priority: 'primary',
      hidden: world?.campaign?.relationships === false,
      onClick: () => setShowRelationship(true),
    },
    {
      key: 'campaign-move',
      icon: Dices,
      label: 'Resolve a campaign move',
      priority: 'primary',
      hidden: modules.campaignRules !== 'mechanical' || !world?.campaign?.moves?.length,
      onClick: () => setShowCampaignMove(true),
    },
    {
      key: 'scenery',
      icon: MapPin,
      label: scenery?.backgroundId ? `Scenery: ${backgroundLabel(scenery.backgroundId, world)} (pinned)` : 'Scenery: follows the story',
      priority: 'primary',
      active: !!scenery?.backgroundId,
      hidden: !world,
      onClick: () => setShowScenery(true),
    },
    {
      key: 'world-fact',
      icon: NotebookPen,
      label: 'Record a world fact',
      hidden: !world,
      onClick: () => setShowWorldFact(true),
    },
    {
      key: 'tuning',
      icon: SlidersHorizontal,
      label: 'Quick tuning: sampler & system prompt',
      priority: 'primary',
      active: showTuning,
      onClick: () => setShowTuning((v) => !v),
    },
    {
      key: 'vn-mode',
      icon: Drama,
      label: resolvedVisualNovelMode ? 'Visual Novel mode: on (switch to chat view)' : 'Visual Novel mode: off (switch to scene view)',
      priority: 'primary-desktop',
      active: resolvedVisualNovelMode,
      onClick: toggleVnForChat,
    },
    {
      key: 'event',
      icon: CalendarHeart,
      label: chat.activeEvent?.title ? `Event: ${chat.activeEvent.title}` : 'Start a date or event',
      priority: romanceFocus ? 'primary-desktop' : 'secondary',
      active: !!chat.activeEvent,
      // An author-level opt-out, or this chat's own mode saying "no romance mechanics" — either
      // way hidden entirely rather than just disabled. Never hides a genuinely active event,
      // though, even if the mode override would otherwise say no — nothing to strand the user with.
      hidden: world?.campaign?.dating === false || !!character?.dateModeOptOut || (!showDateControls && !chat.activeEvent),
      onClick: () => setShowEvent(true),
    },
    {
      key: 'day-planner',
      icon: Sunrise,
      label: 'Plan your day',
      priority: romanceFocus ? 'primary-desktop' : 'secondary',
      // Same "romance-flavored surface" bucket the event button already opts out of — this just
      // leads into the same scored-hangout machinery through a different door — plus no bound
      // world at all, since there's no clock/energy to plan around without one.
      hidden: !world || world.campaign?.dating === false || !!character?.dateModeOptOut || !showDateControls,
      onClick: () => setShowDayPlanner(true),
    },
    {
      key: 'objective',
      icon: Target,
      label: activeObjective ? `Objective: ${activeObjective.title}` : 'Set an objective',
      priority: 'primary-desktop',
      active: !!activeObjective,
      onClick: () => setShowObjective(true),
    },
    {
      key: 'calendar',
      icon: CalendarDays,
      label: 'Key dates',
      // An occasional-reference view, not a per-turn action — stays in the overflow menu rather
      // than competing for primary space with the day planner/event buttons. No bound world means
      // no clock at all to plan a birthday or anniversary against.
      hidden: !world,
      onClick: () => setShowCalendar(true),
    },
    {
      key: 'author-note',
      icon: NotebookPen,
      label: chat.authorNote?.text ? "Author's note (set)" : "Author's note",
      active: !!chat.authorNote?.text,
      onClick: () => setShowAuthorNote(true),
    },
    {
      key: 'scene',
      icon: Clapperboard,
      label: chat.scene ? `Scene (${chat.scene.turnPolicy.replace('_', ' ')})` : 'Scene',
      // Also how a first participant gets invited into an empty chat; hidden only when nobody else exists to invite.
      hidden: otherCharacters.length === 0,
      active: !!chat.scene && (!!chat.scene.location || !!chat.scene.atmosphere || chat.scene.turnPolicy !== 'manual'),
      onClick: () => setShowScene(true),
    },
    {
      key: 'pinned',
      icon: Star,
      label: pinnedCount > 0 ? `Pinned moments (${pinnedCount})` : 'Pinned moments',
      active: pinnedCount > 0,
      onClick: () => setShowPinned(true),
    },
    { key: 'search', icon: Search, label: 'Search messages', onClick: () => setShowSearch(true) },
    { key: 'picture', icon: ImagePlus, label: 'Picture this', onClick: () => setPicturing({}) },
    { key: 'bag', icon: Backpack, label: 'Bag: give a gift you own', onClick: () => setShowBag(true) },
    { key: 'inspector', icon: ScrollText, label: 'Inspect prompt & memory', onClick: () => setShowInspector(true) },
    {
      key: 'director',
      icon: Wrench,
      label: 'Director: adjust world & relationship state',
      onClick: () => setShowDirector(true),
    },
    {
      key: 'export',
      icon: Download,
      label: exporting ? 'Exporting…' : 'Export as HTML transcript',
      disabled: exporting,
      onClick: exportTranscript,
    },
  ]
  const toolbar = <ChatToolbar tone={toolbarTone} actions={toolbarActions
    .filter((action) => ['tuning', 'inspector', 'director', 'export'].includes(action.key))
    .map((action) => ({ ...action, priority: 'secondary' as const }))} />

  const parentChatLink = chat.parentChatId ? (
    <button
      onClick={() => setActiveChatId(chat.parentChatId!)}
      title="This chat was forked from another one. Jump back to it"
      className="flex shrink-0 items-center gap-1 hover:text-text"
    >
      <GitFork size={11} strokeWidth={2} />
      original chat
    </button>
  ) : null

  const activeChoices = (() => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'char' || isGenerating || !last.choiceCards?.length) return null
    return last
  })()

  // For the Prompt Inspector's raw/processed toggle.
  const lastCharMessage = [...messages].reverse().find((m) => m.role === 'char')

  const choiceListNode = (variant: 'default' | 'vn') =>
    activeChoices && (
      <ChoiceList
        variant={variant}
        choices={activeChoices.choiceCards!}
        onPick={(choice) => sendUserMessage(choice.text, [], { choice })}
        refreshing={refreshingChoices}
        onRefresh={() => {
          setRefreshingChoices(true)
          regenerateChoices(activeChoices.id).finally(() => setRefreshingChoices(false))
        }}
      />
    )

  const quickReplyNode = (variant: 'default' | 'vn') =>
    !activeChoices &&
    !isGenerating && (
      <QuickReplyBar variant={variant} replies={quickReplies} onPick={(reply) => sendUserMessage(reply.message, [])} />
    )

  // Intent chips: offered while relationship tracking is on for this chat (its override, else the
  // global default) — unless the mode itself has its own opinion (`showIntentChips`), which wins
  // either way (e.g. a Freeform chat where the player later turned relationship tracking back on
  // for some other reason still doesn't want "Flirt/Tease" chips; that vocabulary is genre, not tracking).
  const relationshipTrackingActive = modules.relationships && (chat?.assistOverrides?.autoTrackRelationship ?? autoTrackRelationship)
  const showIntentChips = relationshipTrackingActive && (chat?.assistOverrides?.showIntentChips ?? romanceFocus) && !isGenerating && !!character
  const liveDateActive = isLiveScene(chat?.activeEvent)

  const AUTO_ADVANCE_MAX_TURNS = 5
  const AUTO_ADVANCE_MAX_MS = 10 * 60 * 1000
  /**
   * Real VN autoplay: called once per completed reply while Auto is on (`VNStage` owns the "when",
   * timed to that reply's length). Never auto-picks an AI-suggested choice — a real decision point
   * always waits for the player, same as autoplay pausing at a branch in any other VN. Stops itself
   * on a live date/event, a failed generation, or a capped number of turns/wall-clock time, so
   * leaving it on by accident can't run away unattended.
   */
  const handleAutoAdvanceFire = () => {
    if (!autoAdvance || isGenerating) return
    if (activeChoices) return
    if (liveDateActive || lastCharMessage?.failed) {
      setAutoAdvance(false)
      return
    }
    const elapsed = autoAdvanceStartRef.current ? Date.now() - autoAdvanceStartRef.current : 0
    if (autoAdvanceCountRef.current >= AUTO_ADVANCE_MAX_TURNS || elapsed >= AUTO_ADVANCE_MAX_MS) {
      setAutoAdvance(false)
      return
    }
    const preferred = quickReplies.find((q) => q.id === 'qr-time-skip') ?? quickReplies[0]
    if (!preferred) {
      setAutoAdvance(false)
      return
    }
    autoAdvanceCountRef.current += 1
    sendUserMessage(preferred.message, [])
  }
  // During a live scene, tension is frozen, so surface Reassure/Apologize off the live rapport read instead.
  const intentStats = (() => {
    const base = getRelationshipStats({ relationshipStats: chat?.relationshipStats })
    const strained = liveDateActive && (chat?.rapport?.trajectory === 'pulling_back' || chat?.rapport?.trajectory === 'on_edge')
    return strained ? { ...base, tension: Math.max(base.tension, 15) } : base
  })()

  const sendWithIntent = (text: string, attachments: Parameters<typeof sendUserMessage>[1] = []) => {
    const opts =
      armedIntent || armedIntimacyOptionId
        ? { ...(armedIntent ? { intent: armedIntent } : {}), ...(armedIntimacyOptionId ? { intimacyOptionId: armedIntimacyOptionId } : {}) }
        : undefined
    sendUserMessage(text, attachments, opts)
    setArmedIntent(null)
    setArmedIntimacyOptionId(null)
  }

  // Model rewrites the action line into the composer for review (never auto-sent); falls back to the canned line on failure.
  const onIntimacyAction = async (option: IntimacyUnlockable) => {
    let text = ''
    try {
      text = await draftIntimacyAction(option.id)
    } catch {
      /* fall through to the canned line */
    }
    setDraft(text.trim() || composeIntimacyActionText(option, character?.card.name ?? 'them'))
    setArmedIntimacyOptionId(option.id)
    setShowRelationship(false)
  }

  // Answering a branch the scene is blocked on: the stage moves in the hook, and an option that names a
  // catalog entry then goes through the ordinary clicked-action path so it lands in the composer for
  // review like any other deliberate move.
  const onIntimacyChoice = async (characterId: string, optionId: string) => {
    const entryId = await chooseIntimacyBranch(characterId, optionId)
    const entry = entryId ? intimacyItemById(entryId, world) : undefined
    if (entry) await onIntimacyAction(entry)
  }

  // Once a non-'manual' policy is active, the composer's "reply as" picker gives way to a read-only hint.
  const turnPolicy = chat.scene?.turnPolicy ?? 'manual'
  const turnPolicyHint =
    turnPolicy === 'gm'
      ? 'The Game Master rules on your action and picks who acts'
      : turnPolicy === 'manual' || participantCharacters.length === 0
      ? undefined
      : turnPolicy === 'round_robin'
        ? (() => {
            const roster = rosterFrom(character, participantCharacters)
            const next = nextRoundRobinSpeaker(roster, chat.scene?.roundRobinIndex)
            return next ? `Next: ${roster.find((r) => r.id === next.id)?.name}` : undefined
          })()
        : turnPolicy === 'director'
          ? 'AI picks who replies'
          : 'Type @Name to address them'

  // `fillHeight` only in VN's inline input mode, where the composer *is* the dialogue box's body
  // and has to hold its fixed height rather than hug its content.
  // An ended scene is history: the banner points on to the next scene instead of a composer. VN
  // shows it through `assistSlot`, which the stage always renders; its composer slot can be hidden.
  const endedBanner = sceneEnded ? (
    <EndedSceneBanner scene={chat} nextScene={nextSceneOf(storyScenes, chat.id)} onOpenScene={setActiveChatId} />
  ) : null
  const composerNode = (variant: 'default' | 'vn') => sceneEnded ? (
    variant === 'vn' ? null : <div className="border-t border-border/50 bg-bg-elevated p-3">{endedBanner}</div>
  ) : (
    <Composer
      variant={variant}
      fillHeight={variant === 'vn' && vnInputMode === 'inline'}
      value={draft}
      onChangeValue={(v) => {
        setDraft(v)
        // Clearing the composer discards the armed intimacy action too.
        if (!v.trim()) setArmedIntimacyOptionId(null)
      }}
      disabled={!character || !!pendingGmMessageId || !!pendingRollMessageId || !!pendingRulingMessageId}
      isGenerating={isGenerating}
      canContinue={canContinue}
      onSend={sendWithIntent}
      onAbort={abortGeneration}
      onContinue={continueMessage}
      onImpersonate={impersonate}
      canUndoLastContinue={canUndoLastContinue}
      onUndoLastContinue={undoLastContinue}
      onRegenerateLastContinueSegment={regenerateLastContinueSegment}
      replyAsOptions={
        character ? [{ id: character.id, name: character.card.name }, ...participantCharacters.map((c) => ({ id: c.id, name: c.card.name }))] : []
      }
      replyAsId={replyAsCharacterId}
      onChangeReplyAs={(id) => setReplyAsCharacterId(id === character?.id ? null : id)}
      turnPolicyHint={turnPolicyHint}
      intentRequired={!!pendingGmMessageId || !!pendingRollMessageId || !!pendingRulingMessageId}
      intentSlot={(pendingGmMessageId || pendingRollMessageId || pendingRulingMessageId || earnedQuestions || showIntentChips || (modules.campaignRules === 'mechanical' && !!world?.campaign?.moves?.length)) ? <div className="flex flex-wrap items-center gap-2">
        {pendingGmMessageId && pendingGmAdjudication?.moveId ? <>
          <button type="button" disabled={isGenerating} onClick={() => gmActions.rollForCheck(pendingGmMessageId, pendingGmAdjudication.moveId!, pendingGmAdjudication.action)} className="inline-flex items-center gap-1.5 rounded-lg bg-warning/15 px-2.5 py-1.5 text-xs font-medium text-warning hover:bg-warning/25 disabled:opacity-50"><Dices size={14} />Roll {pendingGmAdjudication.moveName}</button>
          <button type="button" disabled={isGenerating} onClick={() => sendUserMessage('I withdraw my previous action before rolling.', [], { withdrawCheck: true })} className="rounded-lg px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-sunken disabled:opacity-50">Withdraw action</button>
        </> : pendingRollMessageId ? <button type="button" disabled={isGenerating} onClick={() => void resumeRecordedRoll(pendingRollMessageId).catch((error) => toastError(errorMessage(error)))} className="inline-flex items-center gap-1.5 rounded-lg bg-warning/15 px-2.5 py-1.5 text-xs font-medium text-warning hover:bg-warning/25 disabled:opacity-50"><Dices size={14} />Resolve recorded roll</button> : pendingRulingMessageId ? <>
          <button type="button" disabled={isGenerating} onClick={() => void regenerate(pendingRulingMessageId).catch((error) => toastError(errorMessage(error)))} className="rounded-lg bg-warning/15 px-2.5 py-1.5 text-xs font-medium text-warning hover:bg-warning/25 disabled:opacity-50">Retry Game Master</button>
          <button type="button" disabled={isGenerating} onClick={() => sendUserMessage('I withdraw my previous action.', [], { withdrawCheck: true })} className="rounded-lg px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-sunken disabled:opacity-50">Withdraw action</button>
        </> : <>
          {earnedQuestions && <button type="button" onClick={() => setDraft((current) => current.trim() ? current : `Question from ${earnedQuestions.moveName}: `)} className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 px-2.5 py-1.5 text-xs text-text hover:bg-bg-sunken">Ask earned question ({earnedQuestions.remaining} left)</button>}
          {showIntentChips && <IntentChips variant={variant} stats={intentStats} armed={armedIntent} onArm={setArmedIntent} />}
          {modules.campaignRules === 'mechanical' && !!world?.campaign?.moves?.length && <button type="button" onClick={() => { setPendingCheck(null); setShowCampaignMove(true) }} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-text hover:bg-bg-sunken"><Dices size={14} />Make a move / roll</button>}
        </>}
      </div> : undefined}
    />
  )

  return (
    // overflow-clip is load-bearing: TuningPanel's closed (translate-x-full) state still counts
    // toward scrollWidth without it, causing a permanent horizontal scrollbar. Panels that need to
    // escape this box use position: fixed instead, which plain overflow doesn't clip.
    <GmActionsContext.Provider value={gmActions}>
    <div className="relative flex flex-1 flex-col min-w-0 overflow-clip">
      {showFirstReplyTip && (
        // `fixed` (not `absolute`) so it floats consistently above whichever layout is active
        // (VNStage is full-bleed and doesn't otherwise have a slot for this) — same reasoning the
        // comment above gives for TuningPanel. One-time orientation nudge, not a recurring one.
        <div className="fixed inset-x-4 bottom-6 z-40 mx-auto max-w-sm rounded-2xl border border-border bg-bg-elevated p-4 shadow-lg sm:inset-x-auto sm:right-6">
          <button
            onClick={dismissFirstReplyTip}
            aria-label="Dismiss tip"
            className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
          >
            <X size={13} strokeWidth={2} />
          </button>
          <p className="pr-5 text-sm text-text">Two changes that most alter the experience:</p>
          <ul className="mt-2 space-y-1.5 text-xs text-text-muted">
            {!resolvedVisualNovelMode && (
              <li>
                <button onClick={toggleVnForChat} className="font-medium text-accent hover:underline">
                  Turn on Visual Novel mode
                </button>
                {': '}full-bleed scene art and a dialogue box, instead of the plain chat log.
              </li>
            )}
            {!character?.worldId && (
              <li>
                <span className="font-medium text-text">Bind a world</span> in the character
                editor's Character tab, for scene backgrounds and a shared clock.
              </li>
            )}
          </ul>
        </div>
      )}
      {!resolvedVisualNovelMode && (
        <header className="flex items-center justify-between gap-4 border-b border-border bg-bg-elevated px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {onOpenMenu && (
              <IconButton tone="chrome" icon={Menu} title="Menu" onClick={onOpenMenu} data-tour="play-menu" />
            )}
            {onBack && (
              <IconButton tone="chrome" icon={ArrowLeft} title="Back to Stories" onClick={onBack} />
            )}
            {onOpenStudio && <button onClick={onOpenStudio} className="hidden rounded-lg px-2 py-1 text-xs text-text-muted hover:bg-bg-sunken hover:text-text sm:block">Studio</button>}
            {character?.avatarDataUrl && (
              <img src={character.avatarDataUrl} className="h-10 w-10 shrink-0 rounded-xl object-cover" />
            )}
            {/* Three tiers, deliberately unequal: who you're talking to, then the one stat that
                moves while you play, then the standing context. The third is the first to
                truncate — and the first to disappear entirely on a phone. */}
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 text-base font-display text-text">
                <span className="truncate">{character?.card.name ?? '…'}</span>
                {parentChatLink && <span className="shrink-0 text-xs font-normal text-text-muted">{parentChatLink}</span>}
              </div>
              {showDateControls && <div className="flex min-w-0 items-center gap-2 text-xs text-text-muted">
                {liveDateActive && chat.rapport ? (
                  // Warmth is frozen during a live scene, so show the qualitative rapport read instead.
                  <LiveRapport read={chat.rapport} label={chat?.activeEvent?.kind === 'hangout' ? 'Live hangout' : 'Live date'} />
                ) : (
                  <>
                    <StageMeter value={warmth} className="w-16 shrink-0" />
                    {/* Stage label truncates first on a narrow header; the warmth number never does. */}
                    <span className="truncate first-letter:uppercase">{formatRelationshipStage(relationshipStage)}</span>
                    <span className="shrink-0 tabular-nums text-text">{warmth}</span>
                  </>
                )}
              </div>}
              <div className="hidden min-w-0 items-center gap-1.5 text-[11px] text-text-muted/80 sm:flex">
                <span className="shrink-0">as {persona?.name ?? 'You'}</span>
                {chat.mode && (
                  <>
                    <span className="shrink-0 text-border">·</span>
                    <span className="shrink-0">{getWorldTemplate(chat.mode).label}</span>
                  </>
                )}
                {presence && (
                  <>
                    <span className="shrink-0 text-border">·</span>
                    <span
                      className="flex min-w-0 items-center gap-1.5"
                      title={presence.activity ? `${presence.activity}${presence.location ? ` @ ${presence.location}` : ''}` : undefined}
                    >
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${presence.status === 'available' ? 'bg-accent' : 'bg-text-muted'}`} />
                      {/* `first-letter:uppercase`, not `capitalize`: the activity is a whole clause
                          ("at her table on the library's second floor"), and CSS `capitalize` was
                          Title Casing every word of it — including the "S" after an apostrophe. */}
                      <span className="truncate first-letter:uppercase">
                        {presenceLabel(presence.status)}
                        {presence.activity && `. ${presence.activity}`}
                      </span>
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button onClick={() => openStoryTab('scene')} title="Open scene in Story panel" className="hidden max-w-32 truncate rounded-lg bg-bg-sunken px-2 py-1.5 text-xs text-text-muted hover:text-text sm:block">{sceneSetting.location ?? 'Scene'}</button>
            <button onClick={() => openStoryTab('goals')} title="Open goals in Story panel" className="hidden max-w-32 truncate rounded-lg bg-bg-sunken px-2 py-1.5 text-xs text-text-muted hover:text-text md:block">{activeObjective?.title ?? 'Goal'}</button>
            {contextMeter}
            <button onClick={() => openStoryTab('scene')} data-tour="story-panel" className="rounded-lg px-2 py-1.5 text-xs text-text-muted hover:bg-bg-sunken hover:text-text" title="Open Story panel">Story</button>
            <IconButton tone="chrome" icon={Drama} title="Switch to Visual Novel view" onClick={toggleVnForChat} data-tour="vn-toggle" />
            <IconButton tone="chrome" icon={Search} title="Search story" onClick={() => setShowSearch(true)} />
            {toolbar}
            <div className="mx-1.5 h-5 w-px bg-border" />
            <ConnectionBadge />
          </div>
        </header>
      )}
      {showInspector && (
        <PromptInspector
          loadPrompt={previewPrompt}
          summary={chat.summary}
          onUpdateSummary={() => updateMemorySummary({ force: true })}
          onClose={() => setShowInspector(false)}
          lastReply={lastCharMessage ? { processed: lastCharMessage.text, raw: lastCharMessage.rawText } : undefined}
        />
      )}
      {showObjective && (
        <ObjectivePanel
          activeObjective={activeObjective}
          onClose={() => setShowObjective(false)}
          onCreate={createObjective}
          onSuggest={suggestObjectiveIdea}
          onGenerateTasks={generateTasksForActiveObjective}
          onAddTask={addManualTask}
          onToggleTask={toggleTask}
          onSetStatus={setObjectiveStatus}
        />
      )}
      {showEvent && (
        <DateEventPanel
          currentEvent={chat.activeEvent}
          energyRemaining={world ? getEnergyRemaining(world.currentDay ?? 0, world.currentPhaseIndex ?? 0) : undefined}
          onClose={() => setShowEvent(false)}
          onSuggest={suggestDateEventIdea}
          onStart={async (event) => {
            await startDateEvent(event)
            setShowEvent(false)
          }}
          onEnd={endDateEvent}
        />
      )}
      {showDayPlanner && character && world && (
        <DayPlannerPanel
          character={character}
          world={world}
          activeEvent={chat.activeEvent}
          onOpenActiveEvent={() => {
            setShowDayPlanner(false)
            setShowEvent(true)
          }}
          onPick={runDayPlannerActivity}
          onClose={() => setShowDayPlanner(false)}
        />
      )}
      {showCalendar && character && world && (
        <CalendarPanel
          world={world}
          character={character}
          participantCharacters={participantCharacters}
          chat={chat}
          onClose={() => setShowCalendar(false)}
        />
      )}
      {showRelationship && (
        <RelationshipPanel
          chat={chat}
          character={character}
          participantCharacters={participantCharacters}
          world={world}
          onClose={() => setShowRelationship(false)}
          onBuyGift={buyGift}
          onBuyItem={buyItem}
          onBuyToy={buyToy}
          onBuyOutfit={buyOutfit}
          onAskCommitment={askForCommitment}
          onInitiateFirstTime={initiateFirstTime}
          onEndRelationship={endRelationship}
          onNavigateToWorld={onNavigateToWorld}
          charReplyCount={countCharReplies(messages)}
          personaName={persona?.name || 'You'}
          onIntimacyAction={onIntimacyAction}
          onIntimacyChoice={onIntimacyChoice}
        />
      )}
      {showAuthorNote && (
        <AuthorNotePanel
          note={chat.authorNote}
          onClose={() => setShowAuthorNote(false)}
          onSave={updateAuthorNote}
        />
      )}
      {showScene && (
        <ScenePanel
          scene={chat.scene ? { ...chat.scene, location: sceneSetting.location ?? null, atmosphere: sceneSetting.atmosphere ?? null } : chat.scene}
          gmNotes={chat.gmNotes}
          participantIds={chat.participants ?? []}
          otherCharacters={otherCharacters.map((c) => ({ id: c.id, name: c.card.name }))}
          onClose={() => setShowScene(false)}
          onSave={updateScene}
          onSaveGmNotes={updateGmNotes}
          onSaveParticipants={updateParticipants}
          campaignAvailable={!!world?.campaign}
          leadId={chat.characterId}
          playerCharacterId={chat.playerCharacterId}
          playableCharacters={allCharacters}
          onSwitchPlayer={switchPlayer}
        />
      )}
      {showTranscript && (
        <StoryTranscript
          open
          onClose={() => setShowTranscript(false)}
          story={story}
          scenes={storyScenes.length ? storyScenes : [chat]}
          fromSceneId={chat.id}
        />
      )}
      {showEndScene && (
        <EndSceneDialog
          open
          onClose={() => setShowEndScene(false)}
          drafting={draftingRecap}
          draft={recapDraft}
          error={recapError}
          onRedraft={draftRecap}
          sceneLabel={sceneLabel(chat)}
          cast={[character, ...participantCharacters]
            .filter((c): c is NonNullable<typeof c> => !!c && c.id !== chat.playerCharacterId)
            .map((c) => ({ id: c.id, name: c.card.name, present: c.id === chat.characterId || (chat.scene?.presentCharacterIds ?? chat.participants ?? []).includes(c.id) }))}
          leadId={chat.characterId}
          location={sceneSetting.location}
          storylines={[{ id: MAIN_STORYLINE_ID, name: 'Main story' }, ...(story?.storylines ?? [])]}
          currentStorylineId={chat.storylineId ?? MAIN_STORYLINE_ID}
          consequences={[...(chat.carriedConsequences ?? []), ...branchConsequencesFrom(messages)]}
          chapter={(() => {
            const chapters = chaptersOf(story, storyScenes.length ? storyScenes : [chat])
            const current = chapters.find((c) => c.id === chapterIdOf(chat)) ?? chapters[0]
            return { label: chapterLabel(current), nextNumber: Math.max(...chapters.map((c) => c.number)) + 1, canEnd: !current.endedAt, onDraft: draftChapterRecap }
          })()}
          onConfirm={async (input: EndSceneConfirmInput) => {
            const next = await finishScene(input)
            setShowEndScene(false)
            setActiveChatId(next.id)
          }}
        />
      )}
      {showCampaignMove && world?.campaign && (
        <CampaignMovePanel
          campaign={world.campaign}
          sheet={sheetForWorld(playerCharacter, world.id)}
          sheetWorldMismatch={!!playerCharacter && !!(playerCharacter.sheet || Object.keys(playerCharacter.sheets ?? {}).length) && !sheetForWorld(playerCharacter, world.id)}
          playerName={playerCharacter?.card.name}
          pendingCheck={pendingCheck ?? undefined}
          onClose={() => { setShowCampaignMove(false); setPendingCheck(null) }}
          onSubmit={async (moveId, modifier, action, messageId, target, rollMode) => {
            const moveName = world.campaign?.moves.find((move) => move.id === moveId)?.name ?? 'the check'
            await rollCampaignMove({
              messageId,
              moveId,
              modifier,
              target,
              rollMode,
              pendingGmMessageId: pendingCheck?.messageId,
              action,
              text: pendingCheck ? `I roll ${moveName} to resolve my previous action.` : action,
            })
            setPendingCheck(null)
          }}
        />
      )}
      {showScenery && world && (
        <SceneryPicker
          world={world}
          current={scenery}
          shownBackgroundId={scenery?.backgroundId ?? [...messages].reverse().find((m) => m.scene?.background)?.scene?.background}
          onChoose={setScenery}
          onClose={() => setShowScenery(false)}
        />
      )}
      {showWorldFact && world && (
        <Modal title="Record world canon" description="This fact becomes true across every chat in this world. Use it for lasting story consequences you want all characters to inherit." onClose={() => setShowWorldFact(false)}>
          <TextAreaField label="What happened?" value={worldFactText} onChange={(event) => setWorldFactText(event.target.value)} rows={4} />
          <Button variant="primary" disabled={!worldFactText.trim() || savingWorldFact} onClick={async () => {
            setSavingWorldFact(true)
            try {
              const fresh = await worldsApi.get(world.id)
              if (!fresh) throw new Error('World no longer exists')
              await worldsApi.update(world.id, { canonFacts: [...(fresh.canonFacts ?? []), { id: crypto.randomUUID(), text: worldFactText.trim(), createdAt: Date.now(), sourceChatId: chat.id }] })
              setWorldFactText('')
              setShowWorldFact(false)
            } catch (error) { toastError(errorMessage(error)) } finally { setSavingWorldFact(false) }
          }}>{savingWorldFact ? 'Saving…' : 'Record fact'}</Button>
        </Modal>
      )}
      {picturing && (
        <PictureThisDialog
          chat={chat}
          world={world}
          cast={[character, ...participantCharacters, playerCharacter]
            .filter((c, i, all): c is NonNullable<typeof c> => !!c && all.findIndex((o) => o?.id === c.id) === i)
            .filter((c) => c.id === chat.characterId || c.id === chat.playerCharacterId || (chat.scene?.presentCharacterIds ?? chat.participants ?? []).includes(c.id))}
          message={picturing.messageId ? messages.find((m) => m.id === picturing.messageId) : [...messages].reverse().find((m) => !m.failed && m.text.trim())}
          history={messages}
          location={sceneSetting.location}
          timeOfDay={chat.scene?.timePhase ?? (world ? PHASES[world.currentPhaseIndex ?? 0] : undefined)}
          improve={improvePicturePrompt}
          autoImprove={autoImprovePicture}
          includeEveryone={pictureIncludeEveryone}
          onClose={() => setPicturing(null)}
        />
      )}
      {showSearch && (
        <SearchPanel
          chatId={chat.id}
          messages={messages}
          onClose={() => setShowSearch(false)}
          onJumpToMessage={jumpToMessage}
          onJumpToChat={jumpToChat}
        />
      )}
      {showPinned && (
        <PinnedMessagesPanel
          messages={messages}
          onClose={() => setShowPinned(false)}
          onJump={jumpToMessage}
          onUnpin={togglePinMessage}
        />
      )}

      {showBag && character && (
        <BagPanel
          giftCatalog={getGiftCatalog(world)}
          giftInventory={chat.giftInventory ?? {}}
          itemCatalog={getItemCatalog(world)}
          itemInventory={chat.itemInventory ?? {}}
          // A gift goes to whoever "reply as" is set to, not always the primary — copy must say so.
          characterName={(replyAsCharacterId && participantCharacters.find((c) => c.id === replyAsCharacterId)?.card.name) || character.card.name}
          onClose={() => setShowBag(false)}
          onGive={(gift) => {
            sendUserMessage('', [], {
              choice: { id: `bag-${gift.id}`, kind: 'gift', label: gift.name, text: '', giftId: gift.id, giftName: gift.name },
            })
            setShowBag(false)
          }}
          onUseItem={(item) => {
            useItem(item.id)
            setShowBag(false)
          }}
        />
      )}

      {showDirector && (
        <DirectorPanel
          chat={chat}
          character={character}
          participantCharacters={participantCharacters}
          world={world}
          charReplyCount={countCharReplies(messages)}
          personaName={persona?.name || 'You'}
          onClose={() => setShowDirector(false)}
        />
      )}

      <TuningPanel
        open={showTuning}
        onClose={() => setShowTuning(false)}
        character={character}
        onOpenSettings={
          onOpenSettings
            ? () => {
                setShowTuning(false)
                onOpenSettings()
              }
            : undefined
        }
      />

      <PlaySession
        visualNovel={resolvedVisualNovelMode}
        vn={{
          character,
          persona,
          participantCharacters,
          chat,
          world,
          messages,
          streamingText,
          generatingMessageId,
          highlightedMessageId: highlightedId,
          onSwipe: swipe,
          onRegenerate: regenerate,
          onSteer: regenerateWithSteer,
          onDelete: deleteMessage,
          onRewind: rewindToMessage,
          onEdit: editMessage,
          onFork: forkChat,
          onTogglePin: togglePinMessage,
          onSelectSpeaker: turnPolicy === 'manual' ? (id) => setReplyAsCharacterId(id) : undefined,
          onAppearanceChange: (id, appearanceId) => {
            const appearanceOverrides = { ...chat.scene?.appearanceOverrides }
            if (appearanceId) appearanceOverrides[id] = appearanceId
            else delete appearanceOverrides[id]
            void updateScene({ appearanceOverrides }).catch((error) => toastError(errorMessage(error)))
          },
          onStageChange: (stage) => {
            chatsApi.update(chat.id, { stage: stage ?? null }).catch((error) => toastError(errorMessage(error)))
          },
          onPicture: (id) => setPicturing({ messageId: id }),
          momentsByMessage,
          stageMoment,
          onShowMoment: setStageMoment,
          onStageLayoutsChange: world ? async (change) => {
            try {
              // From the freshest copy, so another scene's save in the meantime isn't lost.
              const fresh = await worldsApi.get(world.id)
              await worldsApi.update(world.id, { stageLayouts: change(fresh?.stageLayouts ?? []) })
            } catch (error) {
              toastError(errorMessage(error))
              throw error
            }
          } : undefined,
          sideActions: [
            ...(onOpenStudio ? [{ key: 'studio', icon: Users, label: 'Studio', onClick: onOpenStudio }] : []),
            { key: 'goals', icon: Target, label: activeObjective?.title ? `Goals: ${activeObjective.title}` : 'Goals', onClick: () => openStoryTab('goals') },
            { key: 'story', icon: BookOpen, label: 'Story panel', onClick: () => openStoryTab('scene') },
            { key: 'transcript', icon: Drama, label: 'Switch to transcript view', onClick: toggleVnForChat },
            { key: 'search', icon: Search, label: 'Search story', onClick: () => setShowSearch(true) },
            ...toolbarActions.filter((action) => ['picture', 'tuning', 'inspector', 'director', 'export'].includes(action.key)),
          ],
          contextMeter,
          onBack,
          onOpenMenu,
          parentChatLink,
          choiceListSlot: sceneEnded ? null : quickReplyNode('vn'),
          activeChoiceData: activeChoices && !sceneEnded ? {
            choices: activeChoices.choiceCards!,
            onPick: (choice) => { sendUserMessage(choice.text, [], { choice }) },
            onRefresh: () => {
              setRefreshingChoices(true)
              regenerateChoices(activeChoices.id).finally(() => setRefreshingChoices(false))
            },
            refreshing: refreshingChoices,
          } : undefined,
          assistSlot: <>
            {endedBanner}
            {showGenerationHud && <GenerationHud stats={genStats} variant="vn" />}
            <AssistActivityBar items={assistActivity} variant="vn" />
          </>,
          composerSlot: composerNode('vn'),
          composerHasDraft: !!draft.trim(),
          autoAdvance,
          onToggleAutoAdvance: () => setAutoAdvance((v) => !v),
          onAutoAdvanceFire: handleAutoAdvanceFire,
          scenery,
          onOpenScenery: world ? () => setShowScenery(true) : undefined,
        }}
        classic={{
          scrollRef,
          log: {
                messages,
                character,
                persona,
                participantCharacters,
                generatingMessageId,
                streamingText,
                highlightedMessageId: highlightedId,
                onEdit: editMessage,
                onDelete: deleteMessage,
                onRewind: rewindToMessage,
                onRegenerate: regenerate,
                onSteer: regenerateWithSteer,
                onSwipe: swipe,
                onFork: forkChat,
                onTogglePin: togglePinMessage,
                onPicture: (id) => setPicturing({ messageId: id }),
                momentsByMessage,
          },
          portrait: liveDateActive && character ? <ReactivePortrait spriteUrl={reactivePortraitUrl} alt={character.card.name} /> : undefined,
          choices: choiceListNode('default') || quickReplyNode('default'),
          hud: showGenerationHud ? <GenerationHud stats={genStats} /> : undefined,
          assist: <AssistActivityBar items={assistActivity} />,
          composer: composerNode('default'),
        }}
        storyPanel={showStoryPanel ? <StoryPanel
          key={chat.id}
          session={session}
          modules={modules}
          setting={sceneSetting}
          tab={storyTab}
          onTabChange={setStoryTab}
          pinned={storyPanelPinned}
          onPin={() => setStoryPanelPinned((value) => !value)}
          onClose={() => setShowStoryPanel(false)}
          onJump={jumpToMessage}
          onSwitchPlayer={switchPlayer}
          allCharacters={allCharacters}
          onOpenRelationship={() => setShowRelationship(true)}
          onOpenObjective={() => setShowObjective(true)}
          onOpenScenery={() => setShowScenery(true)}
          onOpenCalendar={() => setShowCalendar(true)}
          onOpenWorldFact={() => setShowWorldFact(true)}
          onOpenScene={() => setShowScene(true)}
          story={story}
          scenes={storyScenes.length ? storyScenes : undefined}
          currentSceneId={chat.id}
          onOpenStoryScene={setActiveChatId}
          onEndScene={openEndScene}
          onReadStory={() => setShowTranscript(true)}
          onDeleteScene={async (sceneId) => {
            const { openSceneId } = await chatsApi.removeScene(sceneId)
            if (sceneId === chat.id) setActiveChatId(openSceneId)
          }}
          datingToolsVisible={showDateControls}
          onOpenEvent={() => setShowEvent(true)}
          onOpenDayPlanner={() => setShowDayPlanner(true)}
          onOpenBag={() => setShowBag(true)}
        /> : undefined}
      />
    </div>
    </GmActionsContext.Provider>
  )
}
