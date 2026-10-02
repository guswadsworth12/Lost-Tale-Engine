import { Suspense, lazy, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowLeft,
  Menu,
  Move,
  PanelRightClose,
  PanelRightOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  EyeOff,
  GitFork,
  Hand,
  Heart,
  History,
  Loader2,
  MapPin,
  Play,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Smile,
  Star,
  Sunrise,
  Trash2,
  Volume1,
  Volume2,
  X,
} from 'lucide-react'
import type { Character } from '@/lib/characters/cardSpec'
import type { ChoiceOption, Chat, Persona, StoredMessage, WorldCard } from '@/lib/types'
import { ChoiceList } from './ChoiceList'
import { VNCenteredChoices } from './VNCenteredChoices'
import { VNDialogueBox } from './VNDialogueBox'
import { sceneGradient } from '@/lib/vn/placeholder'
import { resolveSceneBackground } from '@/lib/vn/resolveBackground'
import { backgroundLabel } from '@/lib/vn/backgrounds'
import { scrollToMessage } from '@/lib/scrollToMessage'
import { renderMessageText } from '@/lib/text/messageText'
import { useSpriteCrossfade } from '@/lib/hooks/useSpriteCrossfade'
import { useTypewriterReveal } from '@/lib/hooks/useTypewriterReveal'
import {
  computeWarmth,
  formatRelationshipStage,
  getRelationshipStats,
  getRelationshipTrack,
  isLiveScene,
  relationshipMilestonesFor,
  findActiveIntimacyScene,
  relationshipStageForWarmth,
} from '@/lib/dating/stage'
import { countCharReplies } from '@/lib/dating/aftercare'
import { isIntimacySceneActive } from '@/lib/dating/intimacyScene'
import type { IntimacyScene } from '@/lib/dating/intimacyScene'
import { isSceneParticipant } from '@/lib/dating/sceneParticipants'
import { getScenarioCatalog, scenarioById } from '@/lib/dating/scenarios'
import { SceneStateCard } from '@/components/chat/SceneStateCard'
import { StageLabel, StageMeter, StageRow } from '@/components/ui/Stage'
import { triggeredCg } from '@/lib/vn/cgTrigger'
import { pickVariant } from '@/lib/vn/pickVariant'
import { MessageLog } from './MessageLog'
import { SakuraPetals } from './SakuraPetals'
import { LiveRapport } from './LiveRapport'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { SERVER_SIDE_TTS, synthesizeSpeech } from '@/lib/voice/ttsProviders'
import { resolveCharacterVoice, voiceTarget } from '@/lib/api/services'
import { GM_SPEAKER_ID } from '@/lib/world/gm'
import { modulesForWorld } from '@/lib/world/worldTemplates'
import { splitSpeechText, splitVoiceSegments } from '@/lib/voice/speakableText'
import { parseSfxWordList } from '@/lib/text/messageSegments'
import { sfxConfigFor } from '@/lib/text/sfx'
import { resolveExpressionSprite } from '@/lib/vn/expressions'
import { appearanceForCharacter, availableAppearances } from '@/lib/vn/appearances'
import { BASE_OUTFIT_ID } from '@/lib/vn/outfits'
import { vnArtHint } from '@/lib/vn/artHint'
import { getWorldTemplate } from '@/lib/world/worldTemplates'
import { getEnergyRemaining, getMaxEnergyForDay, isNightPhase } from '@/lib/world/calendar'
import { sceneryIsNight, type SceneryChoice } from '@/lib/vn/scenery'
import { sceneSettingFrom } from '@/lib/chat/sceneSetting'
import { moveStagePoint, stagePointStyle, type StageAreaSettings, type StagePoint } from '@/lib/vn/stageArea'
import {
  STAGE_TRANSITIONS,
  applyLayout,
  captureLayout,
  figureLayer,
  figureWidthCaps,
  phoneFocusId,
  pinCue,
  resolveStage,
  sceneStageFromLegacy,
  type ResolvedFigure,
  type SceneStage,
  type StageCue,
  type StageLayout,
  type StageTransition,
} from '@/lib/vn/stageDirection'
import type { StoryMoment } from '@/lib/story/moments'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import type { ChatToolbarAction } from './ChatToolbar'

/**
 * Visual-novel presentation of a chat: full-bleed scene background, each cast member's sprite
 * standing at full height, and one floating glass dialogue box of fixed height over their feet.
 * The ordinary transcript is available as a collapsible log.
 *
 * The composition rule everything here follows: **the art is the subject, the UI is furniture.**
 * Only the dialogue lives inside the box; choices, quick replies, the assist strip and the
 * per-line utilities all float outside it, so the box's height is a constant and the scene behind
 * it never resizes turn to turn. Under `vnInputMode: 'inline'` the box is also where the player
 * writes — the same frame, in the same place, with the nameplate and the accent rail switched over
 * to their persona so it is never ambiguous whose line is being composed.
 */

// three.js + three-vrm only load once some cast member actually has a VRM model enabled.
const VrmFigure = lazy(() => import('./VrmFigure'))

// Petals only make sense outdoors.
const OUTDOOR_BACKGROUNDS = new Set([
  'park', 'forest', 'rooftop', 'city-street', 'beach',
  'school-rooftop', 'school-gate', 'school-courtyard', 'shrine', 'festival', 'fireworks-viewing', 'onsen',
])

type StageDepth = 'foreground' | 'midground' | 'background'

/** Where scenes were arranged before direction was saved with the chat: this browser only, by chat id. */
const STAGE_AREAS_KEY = 'rp-vn-stage-areas'

/** A scene's arrangement from browser storage, removed from there as it's taken. */
function takeLegacyStageArea(chatId: string): Partial<StageAreaSettings> | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const value = JSON.parse(window.localStorage.getItem(STAGE_AREAS_KEY) ?? '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value) || !value[chatId]) return undefined
    const area = value[chatId]
    delete value[chatId]
    if (Object.keys(value).length) window.localStorage.setItem(STAGE_AREAS_KEY, JSON.stringify(value))
    else window.localStorage.removeItem(STAGE_AREAS_KEY)
    return area
  } catch { return undefined }
}

/** Stable muted identity hue per speaker, used for group-scene nameplates/accents. Solo chats keep the usual relationship-pink instead. */
function nameplateHue(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** One cast member's sprite, split out so each can crossfade independently. */
function VNCharacterSprite({
  spriteUrl,
  name,
  hue,
  isActive,
  depth,
  onClick,
  phase,
  vrmUrl,
  vrmMotions,
  expression,
  speaking,
  gesture,
  gestureNonce,
  reducedMotion,
  transition = 'rise',
}: {
  /** Optional 3D model; the sprite below stays the fallback while it loads or if it fails. */
  vrmUrl?: string
  vrmMotions?: import('@/lib/vn/vrmMotion').VrmMotions
  /** Expression id the model shows (the sprite already resolved its own art from it). */
  expression?: string
  /** True while this member's reply is streaming, for the model's mouth. */
  speaking?: boolean
  gesture?: 'wave' | 'smile'
  gestureNonce?: number
  reducedMotion?: boolean
  spriteUrl: string | undefined
  name: string
  /** Identity hue matching this speaker's nameplate. */
  hue: number
  isActive: boolean
  depth: StageDepth
  /** Doubles as the "reply as" picker; omitted when turn policy isn't manual. */
  onClick?: () => void
  /** Sprite staging: a brief slide+fade the moment this member joins or leaves the roster. Unset once settled. */
  phase?: 'entering' | 'exiting'
  /** How they enter or leave (`phase`); `rise` unless the scene's direction says otherwise. */
  transition?: StageTransition
}) {
  const { displaySrc, visible, fadeMs } = useSpriteCrossfade(spriteUrl)
  const [vrmFailed, setVrmFailed] = useState<string | null>(null)
  const use3d = !!vrmUrl && vrmFailed !== vrmUrl

  const spriteInner = displaySrc ? (
    <img
      src={displaySrc}
      alt={name}
      className={`vn-sprite h-full w-full object-contain object-bottom transition-opacity ease-out ${
        visible ? 'opacity-100' : 'opacity-0'
      } ${isActive ? 'drop-shadow-2xl' : ''}`}
      style={{ transitionDuration: `${fadeMs}ms` }}
    />
  ) : (
    // No sprite/avatar yet — a standing placeholder: monogram pillar + name.
    <div className="relative flex h-full w-full items-end justify-center">
      <div
        className="relative flex h-[94%] w-full max-w-[150px] flex-col items-center rounded-t-[46%] pt-[16%] sm:max-w-[210px]"
        style={{ background: `linear-gradient(to bottom, hsl(${hue} 32% 52% / 0.3), hsl(${hue} 30% 42% / 0.12) 55%, transparent)` }}
      >
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full font-display text-lg text-white shadow-xl ring-1 ring-white/15 sm:h-20 sm:w-20 sm:text-2xl"
          style={{ backgroundColor: `hsl(${hue} 48% 50%)` }}
        >
          {initialsOf(name)}
        </span>
        <span className="mt-2.5 font-display text-[13px] text-white/75 sm:text-sm">{name}</span>
      </div>
    </div>
  )

  const inner = use3d ? (
    <Suspense fallback={spriteInner}>
      <VrmFigure
        url={vrmUrl!}
        motions={vrmMotions}
        label={name}
        expression={expression ?? 'neutral'}
        speaking={!!speaking}
        gesture={gesture}
        gestureNonce={gestureNonce}
        reducedMotion={!!reducedMotion}
        onError={(e) => {
          console.warn(`VRM for ${name} failed to load; showing the 2D sprite instead.`, e)
          setVrmFailed(vrmUrl!)
        }}
      />
    </Suspense>
  ) : (
    spriteInner
  )

  return (
    <div
      className={`relative flex h-full w-full items-end justify-center transition-[filter,opacity] duration-500 ease-out ${
        depth === 'foreground'
          ? 'opacity-100'
          : depth === 'midground'
            ? 'opacity-[0.94] [filter:brightness(0.82)_saturate(0.9)]'
            : 'opacity-[0.86] [filter:brightness(0.7)_saturate(0.82)]'
      } ${phase === 'entering' ? 'vn-sprite-enter-anim' : phase === 'exiting' ? 'vn-sprite-exit-anim pointer-events-none' : ''} ${
        phase && transition !== 'rise' ? `vn-sprite-${transition}` : ''}`}
    >
      {isActive && (
        <div className="pointer-events-none absolute inset-x-[2%] bottom-0 -z-10 h-20 rounded-[50%] bg-white/20 blur-2xl" />
      )}
      {inner}
      {onClick && (
        <button
          type="button"
          onClick={onClick}
          title={`Reply as ${name}`}
          aria-label={`Reply as ${name}`}
          className="absolute inset-0 rounded-xl border-0 bg-transparent transition-[background-color,box-shadow] hover:bg-white/[0.04] hover:ring-2 hover:ring-white/40"
        />
      )}
    </div>
  )
}

interface VNStageProps {
  character?: Character
  persona?: Persona
  /** Other speakable characters in a group scene; the whole roster stands on stage, with the active speaker lit. */
  participantCharacters?: Character[]
  chat: Chat
  world?: WorldCard
  messages: StoredMessage[]
  streamingText: string
  generatingMessageId: string | null
  /** Message id to scroll to and flash; opens the log drawer if collapsed. */
  highlightedMessageId?: string | null
  onSwipe: (id: string, dir: 'left' | 'right') => void
  onRegenerate: (id: string) => void
  /** Mid-scene correction, reachable via the backlog drawer's MessageLog only. */
  onSteer: (id: string, steerText: string) => void
  onDelete: (id: string) => void
  onRewind: (id: string) => void
  onEdit: (id: string, text: string) => void
  onFork: (id: string) => void
  onTogglePin: (id: string) => void
  /** Lets the cast double as the "reply as" picker; omitted under any non-manual turn policy. */
  onSelectSpeaker?: (id: string | null) => void
  /** Persist or clear a per-character stage appearance override. */
  onAppearanceChange?: (characterId: string, appearanceId: string | null) => void
  /** Story and tool actions shown in the Visual Novel side rail. */
  sideActions?: ChatToolbarAction[]
  contextMeter?: ReactNode
  /** Back to the Stories library. */
  onBack?: () => void
  /** The app menu (desktop rail / phone drawer), first in the toolbar so navigation is never out of reach. */
  onOpenMenu?: () => void
  /** "Original chat" jump-back link, shown only for forked chats. */
  parentChatLink?: ReactNode
  /** Quick-reply pills (variant="vn"), shown when there's no active AI-suggested choice — always
   *  docked regardless of `vnChoiceStyle`, since a casual quick reply isn't a real decision point. */
  choiceListSlot?: ReactNode
  /** AI-suggested choices — VNStage renders these itself (docked pills or a centered choice screen,
   *  per Settings → Appearance's `vnChoiceStyle`) rather than taking a pre-rendered node, since which
   *  one it picks is its own presentation call. Omitted when there's nothing to choose from. */
  activeChoiceData?: {
    choices: ChoiceOption[]
    onPick: (choice: ChoiceOption) => void
    onRefresh: () => void
    refreshing: boolean
  }
  /** "Background assists running" strip, omitted when nothing is running. */
  assistSlot?: ReactNode
  /** Message composer (variant="vn"). Under `vnInputMode: 'inline'` this is rendered *inside* the
   *  dialogue box while the player is writing; under 'docked' it sits in its own bar below it. */
  composerSlot: ReactNode
  /** Whether the composer currently holds text. Keeps the inline box open for a draft the player
   *  didn't type themselves (an impersonation suggestion, a prefilled intimacy action), which would
   *  otherwise be composed somewhere they can't see. */
  composerHasDraft?: boolean
  /** Off by default; the quick menu's Auto toggle. Once a reply finishes typing, waits a beat scaled
   *  to its length and calls `onAutoAdvanceFire` — real VN autoplay, so `ChatWindow` owns the actual
   *  "what to send" + safety-cap decision (never picks an AI-suggested choice, stops on a live date,
   *  a failed generation, chat switch, or its own turn/time cap). */
  autoAdvance?: boolean
  onToggleAutoAdvance?: () => void
  onAutoAdvanceFire?: () => void
  /** The player's scenery choice on this branch (`vn/scenery.ts`) — a pinned place outranks scene tags. */
  scenery?: SceneryChoice
  /** Opens the in-chat scenery picker from the stage's location chip. */
  onOpenScenery?: () => void
  /** Saves this scene's stage direction (`Chat.stage`). `null` returns it to automatic. */
  onStageChange?: (stage: SceneStage | null) => void
  /** Changes the world's saved stage layouts, applied to its freshest copy. */
  onStageLayoutsChange?: (change: (layouts: StageLayout[]) => StageLayout[]) => Promise<void>
  /** "Picture this" for a line in the backlog. */
  onPicture?: (messageId: string) => void
  /** Story moments by the message they picture, shown in the backlog. */
  momentsByMessage?: Map<string, StoryMoment[]>
  /** A story moment shown full-bleed on the stage until dismissed. */
  stageMoment?: StoryMoment | null
  onShowMoment?: (moment: StoryMoment | null) => void
}

export function VNStage({
  character,
  persona,
  participantCharacters,
  chat,
  world,
  messages,
  streamingText,
  generatingMessageId,
  highlightedMessageId,
  onSwipe,
  onRegenerate,
  onSteer,
  onDelete,
  onRewind,
  onEdit,
  onFork,
  onTogglePin,
  onSelectSpeaker,
  onAppearanceChange,
  sideActions = [],
  contextMeter,
  onBack,
  onOpenMenu,
  parentChatLink,
  choiceListSlot,
  activeChoiceData,
  assistSlot,
  composerSlot,
  composerHasDraft = false,
  autoAdvance = false,
  onToggleAutoAdvance,
  onAutoAdvanceFire,
  scenery,
  onOpenScenery,
  onStageChange,
  onStageLayoutsChange,
  onPicture,
  momentsByMessage,
  stageMoment,
  onShowMoment,
}: VNStageProps) {
  const [showLog, setShowLog] = useState(false)
  // Universal VN convention: hides everything but the background/sprites/CG, restored by clicking
  // anywhere on the scene (see the root `onClick` below) — same discoverability contract as every
  // other VN's hide-UI, so no on-screen hint is needed to find your way back.
  const [hideUI, setHideUI] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const stageRootRef = useRef<HTMLDivElement>(null)
  const sideRailRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; pointerId: number; clientX: number; clientY: number; point: StagePoint; width: number; height: number; moved: boolean } | null>(null)
  const [sideExpanded, setSideExpanded] = useState(false)
  const [vrmGesture, setVrmGesture] = useState<{ kind: 'wave' | 'smile'; nonce: number }>({ kind: 'wave', nonce: 0 })
  const [arrangingStage, setArrangingStage] = useState(false)
  // Scene direction (`vn/stageDirection.ts`) is saved with the chat, saved layouts with the world.
  // An edit shows at once and is saved when it settles: a drag ends, a slider is let go.
  const [draftStage, setDraftStage] = useState<{ chatId: string; stage: SceneStage | undefined } | null>(null)
  const sceneStage = draftStage?.chatId === chat.id ? draftStage.stage : chat.stage ?? undefined
  const savedStageKey = JSON.stringify(chat.stage ?? null)
  useEffect(() => { setDraftStage(null) }, [chat.id, savedStageKey])
  const editStage = (stage: SceneStage | undefined) => setDraftStage({ chatId: chat.id, stage })
  const saveStage = (stage: SceneStage | undefined = sceneStage) => {
    editStage(stage)
    onStageChange?.(stage ?? null)
  }
  const [layoutName, setLayoutName] = useState<string | null>(null)

  useEffect(() => { setArrangingStage(false); setSideExpanded(false); setLayoutName(null) }, [chat.id])

  // A scene arranged before direction was saved with it: move that arrangement onto the scene.
  useEffect(() => {
    if (!onStageChange) return
    const legacy = takeLegacyStageArea(chat.id)
    const stage = legacy && !chat.stage ? sceneStageFromLegacy(legacy) : undefined
    if (stage) onStageChange(stage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id])

  useEffect(() => {
    if (!sideExpanded && !arrangingStage) return
    const onPointerDown = (event: PointerEvent) => {
      if (sideExpanded && !sideRailRef.current?.contains(event.target as Node)) setSideExpanded(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setSideExpanded(false)
      setArrangingStage(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [sideExpanded, arrangingStage])

  useEffect(() => {
    if (showLog) logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [showLog])

  // Opening the drawer and scrolling to the target are separate effects since the drawer must
  // mount before its content can be queried.
  useEffect(() => {
    if (highlightedMessageId) setShowLog(true)
  }, [highlightedMessageId])

  useEffect(() => {
    if (showLog && highlightedMessageId) {
      requestAnimationFrame(() => scrollToMessage(logRef.current, highlightedMessageId))
    }
  }, [showLog, highlightedMessageId])

  const newestCharMsg = [...messages].reverse().find((m) => m.role === 'char')
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
  const lastUserIndex = lastUserMsg ? messages.findIndex((m) => m.id === lastUserMsg.id) : -1
  const beatMessages = messages.slice(lastUserIndex + 1).filter((m) => m.role === 'char')
  const [viewedMessageId, setViewedMessageId] = useState<string | null>(newestCharMsg?.id ?? null)
  const viewedBeatRef = useRef({ chatId: chat.id, userId: lastUserMsg?.id ?? null })
  useEffect(() => {
    if (viewedBeatRef.current.chatId !== chat.id) {
      viewedBeatRef.current = { chatId: chat.id, userId: lastUserMsg?.id ?? null }
      setViewedMessageId(newestCharMsg?.id ?? null)
    } else if (viewedBeatRef.current.userId !== (lastUserMsg?.id ?? null) && beatMessages.length) {
      // A GM beat can deliver several speakers before the UI paints. Show its first line and
      // leave every later one queued until the reader advances.
      viewedBeatRef.current.userId = lastUserMsg?.id ?? null
      setViewedMessageId(beatMessages[0].id)
    }
  }, [chat.id, lastUserMsg?.id, beatMessages[0]?.id, newestCharMsg?.id])
  const lastCharMsg = messages.find((m) => m.id === viewedMessageId && m.role === 'char') ?? newestCharMsg
  const beatIndex = beatMessages.findIndex((m) => m.id === lastCharMsg?.id)
  const previousBeatMsg = beatMessages[beatIndex - 1]
  const nextBeatMsg = beatMessages[beatIndex + 1]
  const isStreamingThis = !!lastCharMsg && generatingMessageId === lastCharMsg.id
  // A failed generation leaves no real character line to show — fall back to the player's own last
  // line as "current" instead of putting an error banner in Sumire's mouth. Same textbox, same
  // nameplate slot, just attributed to whoever actually has something to say right now.
  const showUserAsCurrent = !!lastCharMsg?.failed && !isStreamingThis && !!lastUserMsg
  // A failed generation keeps empty text (see useChatSession.ts); show a message instead of going blank.
  const displayText = isStreamingThis
    ? streamingText
    : showUserAsCurrent
      ? lastUserMsg!.text
      : lastCharMsg?.failed
        ? '⚠ Generation failed. Try regenerating (⟲) from the log.'
        : lastCharMsg?.text || (messages.length === 0 ? 'Say hello to begin the scene…' : '')
  const silentGmNote = !!lastCharMsg && (lastCharMsg.speakerId === GM_SPEAKER_ID || !!lastCharMsg.gm)
    && splitVoiceSegments(displayText, true).length === 0

  const activeSwipe = lastCharMsg?.activeSwipe ?? 0
  const scene = lastCharMsg?.swipeScenes?.[activeSwipe] ?? lastCharMsg?.scene
  const loadedCast = character ? [character, ...(participantCharacters ?? [])] : (participantCharacters ?? [])
  const cast = chat.scene?.presentCharacterIds
    ? loadedCast.filter((member) => chat.scene!.presentCharacterIds!.includes(member.id))
    : loadedCast
  // The Bond HUD follows whoever's actually speaking in a group scene, not always the primary.
  // Falls back to the primary if the stored speaker id isn't in the current cast (roster can
  // shrink after they last spoke).
  const rawActiveSpeakerId = lastCharMsg ? (lastCharMsg.speakerId ?? character?.id) : character?.id
  const activeSpeakerId = cast.some((m) => m.id === rawActiveSpeakerId) ? rawActiveSpeakerId : character?.id
  const castSpeakerId = (message: StoredMessage | undefined) => {
    if (!message || message.role !== 'char' || message.speakerId === GM_SPEAKER_ID || message.gm || message.name === 'Game Master') return undefined
    return cast.find((member) => member.id === message.speakerId || (!message.speakerId && member.card.name === message.name))?.id
      ?? (!message.speakerId ? cast.find((member) => member.id === character?.id)?.id : undefined)
  }
  const stageSpeakerId = showUserAsCurrent ? undefined : castSpeakerId(lastCharMsg)
  // Narration and the player's own lines keep the last speaker in focus.
  const lastSpeakerId = [...messages].reverse().map(castSpeakerId).find(Boolean)
  const visualFocusId = stageSpeakerId ?? lastSpeakerId ?? cast[0]?.id
  const activeTrack = activeSpeakerId ? getRelationshipTrack(chat, activeSpeakerId) : {}
  const affection = Math.max(0, Math.min(100, activeTrack.affection ?? 0))
  const warmth = computeWarmth(affection, getRelationshipStats(activeTrack))
  const relationshipStage = relationshipStageForWarmth(warmth, relationshipMilestonesFor(world?.relationshipThresholds))
  // Item 10: a gallery CG whose author-set trigger condition is met right now, surfaced full-bleed
  // in place of the ordinary background+sprite composition below.
  const activeCgSource = cast.find((m) => m.id === activeSpeakerId)
  // Chat-wide, not off the active speaker's own track: a shared scene lives on its owner's
  // (`sceneParticipants.ts`), so reading `activeTrack` here would show nothing for anyone who joined
  // one. The speaker still has to actually be *in* it, since standing in the room is not being in it.
  const charRepliesNow = countCharReplies(messages)
  const liveScene = findActiveIntimacyScene(chat, (sc: IntimacyScene) => isIntimacySceneActive(sc, charRepliesNow))
  const activeIntimacyScene =
    liveScene && activeSpeakerId && isSceneParticipant(liveScene.scene, activeSpeakerId, liveScene.ownerId)
      ? liveScene.scene
      : undefined
  const triggeredCgEntry = triggeredCg(activeCgSource?.gallery, {
    affection,
    sceneFlags: chat.sceneFlags ?? [],
    intimacyPhase: activeIntimacyScene?.phase,
    lastCatalogActionId: lastUserMsg?.intimacyAction?.optionId,
    relationshipStage,
  })
  // Item 11: a stable pick across this CG's own variants, reseeded only when the message that surfaced it changes.
  const triggeredCgImageUrl = triggeredCgEntry
    ? pickVariant([triggeredCgEntry.imageUrl, ...(triggeredCgEntry.variants ?? [])].filter(Boolean), lastCharMsg?.id ?? triggeredCgEntry.id)
    : undefined
  // CG reveal ceremony: a brief full-screen beat (see `.vn-cg-reveal` — the `key` below already
  // remounts the <img> per distinct CG, which is what makes the enter animation replay each time)
  // plus a one-time "new in Gallery" toast, fired the first time this component instance sees a
  // given CG id trigger — never again for the same id, even as it keeps showing across re-renders.
  const cgToastedIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!triggeredCgEntry || cgToastedIdsRef.current.has(triggeredCgEntry.id)) return
    cgToastedIdsRef.current.add(triggeredCgEntry.id)
    toastSuccess(`New in Gallery: "${triggeredCgEntry.title}"`, { chime: true })
  }, [triggeredCgEntry])
  const liveDateActive = isLiveScene(chat.activeEvent)
  const isHangoutEvent = chat.activeEvent?.kind === 'hangout'
  const expression = scene?.expression || 'neutral'
  // Sprite resolution degrades unlocked tag -> same-family expression -> avatar (see resolveExpressionSprite).
  // Appearance is sticky per character; narration may describe another cast member's form.
  const appearanceFlags = new Set(chat.sceneFlags ?? [])
  // Same stable-per-message seed as the CG pick above, so a sprite variant doesn't flicker mid-turn.
  const spriteVariantSeed = lastCharMsg?.id ?? 'no-message'
  // The line being read determines the expression. Narration holds the last cast shot.
  const canPickSpeaker = !!onSelectSpeaker && cast.length > 1
  const isGroupScene = cast.length > 1
  const castMembers = cast.map((member) => {
    const isActive = member.id === visualFocusId
    // Each member's sprite unlocks follow their own relationship track, regardless of framing.
    const memberAffection = Math.max(0, Math.min(100, getRelationshipTrack(chat, member.id).affection ?? 0))
    const variantOptions = { variants: member.spriteVariants, seed: spriteVariantSeed }
    const memberExpression = member.id === stageSpeakerId ? expression : 'neutral'
    const appearanceId = appearanceForCharacter(messages, {
      id: member.id, name: member.card.name, outfits: member.outfits, sprites: member.sprites,
    }, character?.id ?? member.id, memberAffection, appearanceFlags, chat.scene?.appearanceOverrides?.[member.id])
    const spriteUrl = isActive
      ? resolveExpressionSprite(member.sprites, member.spriteUnlocks, member.avatarDataUrl, memberExpression, memberAffection, appearanceId, variantOptions)
      : resolveExpressionSprite(member.sprites, member.spriteUnlocks, member.avatarDataUrl, 'neutral', memberAffection, appearanceId, variantOptions)
    return {
      id: member.id,
      name: member.card.name,
      avatarUrl: member.avatarDataUrl,
      hue: nameplateHue(member.id || member.card.name),
      spriteUrl,
      vrmUrl: member.vrm?.enabled && appearanceId === BASE_OUTFIT_ID ? member.vrm.url : undefined,
      vrmMotions: member.vrm?.motions,
      expression: memberExpression,
      speaking: member.id === stageSpeakerId && isStreamingThis,
      isActive,
      onClick: canPickSpeaker ? () => onSelectSpeaker!(member.id === character?.id ? null : member.id) : undefined,
    }
  })

  // Sprite staging: slide+fade a cast member in the first time they appear (including a chat's very
  // first render — opening a chat is itself a "first appearance"), and keep someone who just left
  // the roster around briefly for a matching exit, instead of a hard cut either way.
  const ENTER_EXIT_MS = 450
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set())
  const [departedMembers, setDepartedMembers] = useState<typeof castMembers>([])
  const prevCastRef = useRef<typeof castMembers>([])
  useEffect(() => {
    const prevIds = new Set(prevCastRef.current.map((m) => m.id))
    const currentIds = new Set(castMembers.map((m) => m.id))
    const entered = castMembers.filter((m) => !prevIds.has(m.id))
    const left = prevCastRef.current.filter((m) => !currentIds.has(m.id))
    if (entered.length) {
      const ids = entered.map((m) => m.id)
      setEnteringIds((prev) => new Set([...prev, ...ids]))
      setTimeout(() => setEnteringIds((prev) => {
        const next = new Set(prev)
        ids.forEach((id) => next.delete(id))
        return next
      }), ENTER_EXIT_MS)
    }
    if (left.length) {
      setDepartedMembers((prev) => [...prev, ...left])
      const ids = left.map((m) => m.id)
      setTimeout(() => setDepartedMembers((prev) => prev.filter((m) => !ids.includes(m.id))), ENTER_EXIT_MS)
    }
    prevCastRef.current = castMembers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castMembers.map((m) => m.id).join(',')])

  const castIds = castMembers.map((member) => member.id)
  // Arranging shows everyone where they stand on their own, without the speaker's step forward.
  const stage = resolveStage(castIds, arrangingStage ? undefined : visualFocusId, sceneStage, world?.stageLayouts)
  // A phone frames one character, always: the speaker, else whoever spoke last.
  const phoneId = phoneFocusId(castIds, stageSpeakerId, lastSpeakerId)
  // Where each character last stood, so someone leaving exits from their own spot.
  const lastFiguresRef = useRef(new Map<string, ResolvedFigure>())
  for (const figure of stage.figures) lastFiguresRef.current.set(figure.id, figure)
  const stagedFigures = [
    ...departedMembers.map((member) => ({
      member,
      figure: lastFiguresRef.current.get(member.id) ?? resolveStage([member.id], undefined, undefined, undefined).figures[0],
      phase: 'exiting' as const,
    })),
    ...castMembers.map((member, index) => ({ member, figure: stage.figures[index], phase: enteringIds.has(member.id) ? 'entering' as const : undefined })),
  ]
  const widthCaps = figureWidthCaps(stage.figures)
  const layouts = world?.stageLayouts ?? []
  const [selectedFigureId, setSelectedFigureId] = useState<string | null>(null)
  const selectedFigure = stage.figures.find((figure) => figure.id === selectedFigureId) ?? stage.figures[0]
  const cueOf = (figure: ResolvedFigure): StageCue => ({ ...figure.home, scale: figure.scale, enter: figure.enter, exit: figure.exit })
  const pinned = (figure: ResolvedFigure, change: Partial<StageCue>) => pinCue(sceneStage, figure.id, { ...cueOf(figure), ...change })
  const beginArrangeStage = () => {
    setSelectedFigureId(castIds[0] ?? null)
    setShowLog(false)
    setHideUI(false)
    setSideExpanded(false)
    setArrangingStage(true)
  }
  const automaticStage = () => {
    saveStage(undefined)
    setArrangingStage(false)
    setSideExpanded(false)
  }
  const saveLayoutAs = (name: string) => {
    const layout = captureLayout(stage, name, crypto.randomUUID(), Date.now())
    // A failed save is reported where it's made; the scene stays as it is.
    onStageLayoutsChange?.((list) => [...list, layout]).then(() => saveStage(applyLayout(sceneStage, layout.id)), () => {})
  }
  const updateLayout = (current: StageLayout) => {
    const layout = captureLayout(stage, current.name, current.id, Date.now())
    onStageLayoutsChange?.((list) => list.map((l) => (l.id === layout.id ? layout : l))).then(() => saveStage(applyLayout(sceneStage, layout.id)), () => {})
  }
  const deleteLayout = async (layout: StageLayout) => {
    const ok = await confirmDialog({
      title: `Delete "${layout.name}"?`,
      body: 'Scenes using it go back to automatic direction. Characters placed by hand in them stay put.',
      confirmLabel: 'Delete layout',
      tone: 'danger',
    })
    if (!ok || !onStageLayoutsChange) return
    try { await onStageLayoutsChange((list) => list.filter((l) => l.id !== layout.id)) } catch { return }
    const { layoutId: _l, ...rest } = sceneStage ?? {}
    saveStage(Object.keys(rest).length ? rest : undefined)
  }
  const activeMember = castMembers.find((m) => m.isActive) ?? castMembers[0]
  // Nameplate follows whoever's line is actually showing — the player's own persona while
  // `showUserAsCurrent`, the speaking cast member otherwise. Same slot, same styling either way.
  const speakerName = showUserAsCurrent ? persona?.name || 'You' : (lastCharMsg?.name ?? activeMember?.name ?? character?.card.name ?? '')
  const speakerAvatarUrl = showUserAsCurrent ? persona?.avatarDataUrl : activeMember?.avatarUrl
  // Group scenes get a per-speaker identity hue; solo chats keep the usual relationship-pink.
  const plateHue = activeMember?.hue ?? 320
  // The name is set *on* the box's dark glass now, not on a filled romance-coloured tab, so it
  // takes the accent colour itself — `--c-romance-text` is the colour authored to contrast against
  // that fill, which in the dark theme is near-black and disappeared here.
  const worldModules = modulesForWorld(world ?? { template: chat.mode })
  const datingChrome = worldModules.dating && (chat.assistOverrides?.showDateEventButton ?? worldModules.romanceEmphasis === 'focus')
  const plate = isGroupScene
    ? { name: `hsl(${plateHue} 82% 82%)`, chip: `hsl(${plateHue} 44% 44%)` }
    : { name: `rgb(var(${datingChrome ? '--c-romance' : '--c-accent'}))`, chip: `rgb(var(${datingChrome ? '--c-romance' : '--c-accent'}))` }
  // Every fallback for "where is this scene" lives in `resolveSceneBackground` — including reading
  // the narration itself, which is what stops a chat's opening messages (a static greeting carries
  // no `<<scene:>>` tag at all) from landing on an unplaced void.
  const night = sceneryIsNight(scenery, isNightPhase(world?.currentPhaseIndex))
  // The day-planner's action budget, surfaced here too — it used to live only inside the "Plan your
  // day" modal, so knowing whether there was still room for another activity today meant actually
  // opening it. Same visibility gate `ChatWindow`'s own day-planner toolbar button uses, so the
  // readout never claims a budget exists for a mode/character that has opted the whole mechanic out.
  const showEnergy = !!world && datingChrome && !character?.dateModeOptOut
  const energyRemaining = showEnergy ? getEnergyRemaining(world!.currentDay ?? 0, world!.currentPhaseIndex ?? 0) : 0
  const energyMax = showEnergy ? getMaxEnergyForDay(world!.currentDay ?? 0) : 0
  const narration = [lastCharMsg?.text, lastUserMsg?.text].filter(Boolean).join(' ')
  const resolvedBackground = resolveSceneBackground({
    taggedBackground: scene?.background,
    chat,
    world,
    affection,
    narration,
    night,
    scenery,
    location: sceneSettingFrom(messages, chat.scene, (id) => backgroundLabel(id, world)).location,
  })
  const sceneBackground = resolvedBackground.id
  const backgroundUrl = resolvedBackground.url
  const bgStyle = backgroundUrl
    ? { backgroundImage: `url(${backgroundUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: sceneGradient(sceneBackground, { night }) }
  // Keyed on what's actually painted, so the cross-dissolve replays when the scene moves somewhere
  // else and stays put through an ordinary re-render.
  const bgKey = backgroundUrl || sceneBackground || 'nowhere'
  const prevBgRef = useRef<{ key: string; style: typeof bgStyle }>({ key: bgKey, style: bgStyle })
  const outgoingBgStyle = prevBgRef.current.key === bgKey ? undefined : prevBgRef.current.style
  useEffect(() => {
    prevBgRef.current = { key: bgKey, style: bgStyle }
  })

  // Only worth naming when there's no photo to say it for you — on authored art the location is
  // self-evident, and a caption over it is just chrome.
  const locationCaption = !backgroundUrl && sceneBackground ? backgroundLabel(sceneBackground, world) : undefined

  const swipes = lastCharMsg?.swipes ?? []
  const canSwipe = !!lastCharMsg && swipes.length > 0 && !isStreamingThis

  // See vnArtHint; dismissal is per-character.
  const vnArtHintDismissed = useSettingsStore((s) => s.vnArtHintDismissed)
  const dismissVnArtHint = useSettingsStore((s) => s.dismissVnArtHint)
  const artHint = vnArtHint(character, world, vnArtHintDismissed)
  const personaName = persona?.name
  const reducedMotion = useSettingsStore((s) => s.reducedMotion)
  const vnTextSpeedMs = useSettingsStore((s) => s.vnTextSpeedMs)
  const vnChoiceStyle = useSettingsStore((s) => s.vnChoiceStyle)
  const vnInputMode = useSettingsStore((s) => s.vnInputMode)

  // Inline input: the dialogue box is handed over to the player rather than a composer bar living
  // permanently under it. `composerHasDraft` forces it open for text that arrived some other way,
  // so a suggestion or a prefilled action is never composed off-screen.
  const inlineInput = vnInputMode === 'inline'
  const [writing, setWriting] = useState(false)
  const isWriting = inlineInput && (writing || composerHasDraft)
  // A landed reply is the scene's turn again — hand the box back, unless there's still a draft in it.
  useEffect(() => {
    setWriting(false)
  }, [lastCharMsg?.id])
  // Per-line voice: "read this line aloud" via the shared TTS stack (`lib/voice`). Manual and
  // one line at a time only — no auto-voice-on-every-reply, unlike Auto above; that's a
  // recurring-cost surface this pass intentionally doesn't take on.
  const koboldBaseUrl = useSettingsStore((s) => s.baseUrl)
  const ttsProvider = useSettingsStore((s) => s.ttsProvider)
  const { saved: secrets } = useSecretStatus()
  // The chosen voice service's key (Settings → Models and services), else the long-standing one.
  const ttsSecret = useSettingsStore((s) => s.ttsSecret) ?? 'ttsApiKey'
  const ttsKeySaved = !!secrets[ttsSecret]
  const ttsBaseUrl = useSettingsStore((s) => s.ttsBaseUrl)
  const ttsRegion = useSettingsStore((s) => s.ttsRegion)
  const ttsModel = useSettingsStore((s) => s.ttsModel)
  const openMayhemKeySaved = secrets.openMayhemApiKey
  const ttsVoice = useSettingsStore((s) => s.ttsVoice)
  const voiceModelServiceId = useSettingsStore((s) => s.voiceModel?.serviceId)
  const [speakState, setSpeakState] = useState<'idle' | 'loading' | 'playing'>('idle')
  const speakAudioRef = useRef<HTMLAudioElement | null>(null)
  const speakControllerRef = useRef<AbortController | null>(null)
  const speakUrlRef = useRef<string | null>(null)
  const stopSpeaking = () => {
    speakControllerRef.current?.abort()
    speakControllerRef.current = null
    if (speakAudioRef.current) {
      speakAudioRef.current.onended = null
      speakAudioRef.current.onerror = null
      speakAudioRef.current.pause()
      speakAudioRef.current.remove()
    }
    speakAudioRef.current = null
    if (speakUrlRef.current) { URL.revokeObjectURL(speakUrlRef.current); speakUrlRef.current = null }
    setSpeakState('idle')
  }
  // Always starts fresh (cancelling anything already playing) — shared by the manual button's
  // "start" half and by auto-voice, which must never be subject to the button's own toggle-to-stop
  // semantics (a second reply arriving mid-playback should cut in, not silently no-op as a "stop").
  const startSpeaking = async (rawText: string) => {
    stopSpeaking()
    const gmNarration = !showUserAsCurrent && (lastCharMsg?.speakerId === GM_SPEAKER_ID || !!lastCharMsg?.gm)
    const segments = splitVoiceSegments(rawText, showUserAsCurrent || gmNarration)
    if (!segments.length) return
    setSpeakState('loading')
    const controller = new AbortController()
    speakControllerRef.current = controller
    try {
      // Whoever is actually speaking this line; GM narration and the player's own line use the narrator/default voice.
      const voiceOwner = showUserAsCurrent || gmNarration ? undefined : activeCgSource
      const override = voiceOwner?.voice
      // Their own voice service, if they have one (throws if it was removed, rather than using someone else's voice).
      const own = resolveCharacterVoice(override, useSettingsStore.getState())
      const provider = own ? voiceTarget(own.service).provider : override?.provider ?? ttsProvider
      if (!own && override?.provider && override.provider !== ttsProvider && !SERVER_SIDE_TTS.includes(override.provider)) {
        throw new Error('This character speaks with a voice service you haven\'t added. Add it in Settings → Models and services, then pick it on their Voice tab.')
      }
      const narratorConfig = {
        provider: ttsProvider,
        keySaved: ttsProvider === 'openmayhem' ? openMayhemKeySaved : ttsKeySaved,
        secret: ttsSecret,
        model: ttsModel,
        baseUrl: ttsBaseUrl,
        region: ttsRegion,
        voice: ttsVoice,
      }
      const ownTarget = own && voiceTarget(own.service)
      const characterConfig = ownTarget
        ? {
          ...ownTarget,
          keySaved: !!ownTarget.secret && !!secrets[ownTarget.secret],
          model: own.model,
          // Blank: the service's own default voice, never the narrator's on a different service.
          voice: override?.voiceId || (own.service.id === voiceModelServiceId ? ttsVoice : ''),
          speed: override?.speed,
        }
        : {
          ...narratorConfig,
          provider,
          // A character's own voice id only means something on the provider it was chosen for.
          voice: (override?.voiceId && (override.provider ?? ttsProvider) === provider ? override.voiceId : '') || (provider === ttsProvider ? ttsVoice : ''),
          speed: override?.speed,
        }
      const clips = segments.flatMap((segment) => {
        const config = segment.role === 'narrator' ? narratorConfig : characterConfig
        // LuxTTS speaks best in short clips; NovelAI takes at most 1000 characters a request.
        const parts = config.provider === 'luxtts' ? splitSpeechText(segment.text) : config.provider === 'novelai' ? splitSpeechText(segment.text, 600) : [segment.text]
        return parts.map((text) => ({ text, config }))
      })
      // Prepare one clip ahead while the current one plays, so sentence boundaries do not
      // acquire an extra synthesis-length pause. Capture errors immediately while prefetching.
      const prepare = (clip: (typeof clips)[number]) => synthesizeSpeech(clip.config, clip.text, koboldBaseUrl, controller.signal)
        .then((blob) => ({ blob, error: null }), (error: unknown) => ({ blob: null, error }))
      let next = prepare(clips[0])
      for (let index = 0; index < clips.length; index++) {
        setSpeakState('loading')
        const result = await next
        if (result.blob === null) throw result.error
        const blob = result.blob
        controller.signal.throwIfAborted()
        if (index + 1 < clips.length) next = prepare(clips[index + 1])
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        audio.hidden = true
        document.body.append(audio)
        speakUrlRef.current = url
        speakAudioRef.current = audio
        setSpeakState('playing')
        await new Promise<void>((resolve, reject) => {
          let settled = false
          const finish = (error?: Error) => {
            if (settled) return
            settled = true
            controller.signal.removeEventListener('abort', cancel)
            audio.onended = null
            audio.onerror = null
            audio.remove()
            if (speakAudioRef.current === audio) {
              URL.revokeObjectURL(url)
              speakUrlRef.current = null
              speakAudioRef.current = null
            }
            if (error) reject(error)
            else resolve()
          }
          const cancel = () => { audio.pause(); finish(new DOMException('Playback stopped', 'AbortError')) }
          controller.signal.addEventListener('abort', cancel, { once: true })
          audio.onended = () => finish()
          audio.onerror = () => finish(new Error('The browser could not play the generated audio.'))
          audio.play().catch((error: Error) => finish(error))
        })
      }
      if (speakControllerRef.current === controller) {
        speakControllerRef.current = null
        setSpeakState('idle')
      }
    } catch (e) {
      if (controller.signal.aborted) return
      speakControllerRef.current = null
      setSpeakState('idle')
      toastError(errorMessage(e))
    }
  }
  // The manual button: toggles, since a deliberate click while already speaking means "stop."
  const speakLine = () => {
    if (speakState !== 'idle') {
      stopSpeaking()
      return
    }
    startSpeaking(displayText)
  }
  // Swiping to a different line, or leaving the message entirely, cuts off whatever was playing —
  // it no longer matches what's on screen.
  useEffect(() => stopSpeaking, [lastCharMsg?.id, activeSwipe, ttsProvider, ttsModel, ttsVoice, openMayhemKeySaved, ttsKeySaved, ttsBaseUrl, ttsRegion, activeCgSource?.voice?.provider, activeCgSource?.voice?.serviceId, activeCgSource?.voice?.voiceId])
  const [autoVoice, setAutoVoice] = useState(false)

  // Every message id this component instance has watched stream in live — its text already
  // appeared token-by-token, so re-running the typewriter over it (e.g. once `isStreamingThis`
  // flips false, or on a later swipe back to it) would just replay content the player already
  // watched arrive. Only a line that shows up already-complete (a static greeting, an
  // alternate-greeting swipe, or reopening a chat) gets the reveal treatment.
  const streamedIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (isStreamingThis && lastCharMsg) streamedIdsRef.current.add(lastCharMsg.id)
  }, [isStreamingThis, lastCharMsg?.id])
  const typewriterActive = !isStreamingThis && !!lastCharMsg?.text && !lastCharMsg?.failed && !streamedIdsRef.current.has(lastCharMsg?.id ?? '')
  const {
    revealed: revealedDialogueText,
    done: dialogueRevealDone,
    skip: skipTypewriter,
  } = useTypewriterReveal(displayText, reducedMotion ? 0 : vnTextSpeedMs, typewriterActive)
  const shownDialogueText = typewriterActive ? revealedDialogueText : displayText
  // Enter/Space reveal the current line, then advance to the next speaker. In inline input mode,
  // Enter opens the composer once the beat is caught up.
  useEffect(() => {
    if (isWriting || showLog || hideUI) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.key !== 'Enter' && e.key !== ' ') || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.closest('button, a, input, textarea, select, [role="button"]') || t.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      if (typewriterActive && !dialogueRevealDone) { e.preventDefault(); skipTypewriter() }
      else if (nextBeatMsg) { e.preventDefault(); setViewedMessageId(nextBeatMsg.id) }
      else if (e.key === 'Enter' && inlineInput) { e.preventDefault(); setWriting(true) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inlineInput, isWriting, showLog, hideUI, typewriterActive, dialogueRevealDone, nextBeatMsg?.id])
  // The ADV "done typing" glyph — only for an actual, complete character line, never the empty-chat
  // placeholder or a still-in-flight stream.
  const dialogueComplete = !isStreamingThis && !!lastCharMsg?.text && !lastCharMsg?.failed && dialogueRevealDone
  // Auto-voice: speaks each new reply once it finishes typing, unprompted — opt-in, off by
  // default, never persisted (resets with everything else on a chat switch, same as Auto-advance).
  // Unlike Auto-advance this can't chain into extra generations on its own: it only ever narrates a
  // reply that already happened, so it carries none of Auto-advance's runaway-cost risk and needs
  // none of its safety caps.
  const autoVoiceSpokenIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!autoVoice || !dialogueComplete || !lastCharMsg) return
    if (autoVoiceSpokenIdRef.current === lastCharMsg.id) return
    autoVoiceSpokenIdRef.current = lastCharMsg.id
    startSpeaking(lastCharMsg.text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoVoice, dialogueComplete, lastCharMsg?.id])
  // Start each speaker at the beginning. The reader controls scrolling through a long line;
  // following every typed character used to push the first sentences out of view too quickly.
  const dialogueBoxRef = useRef<HTMLDivElement>(null)
  // What stands in front of the stage, measured, so the cast is framed clear of it rather than
  // behind it: the HUD card (and on a phone the rail button) above, and below the dialogue box with
  // everything stacked on it, or the arranging bar.
  const stageFrameRef = useRef<HTMLDivElement>(null)
  const hudCardRef = useRef<HTMLDivElement>(null)
  const dialogueStackRef = useRef<HTMLDivElement>(null)
  const dialogueWrapRef = useRef<HTMLDivElement>(null)
  const arrangeBarRef = useRef<HTMLDivElement>(null)
  const [stageClear, setStageClear] = useState<{ top: number; bottom: number } | null>(null)
  useEffect(() => {
    const frame = stageFrameRef.current
    if (!frame || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const area = frame.getBoundingClientRect()
      const phone = !window.matchMedia('(min-width: 768px)').matches
      const above = [hudCardRef.current, phone && !sideExpanded ? sideRailRef.current : null].flatMap((el) => (el ? [el.getBoundingClientRect().bottom] : []))
      const below = [dialogueStackRef.current, dialogueWrapRef.current, arrangeBarRef.current].flatMap((el) => (el ? [el.getBoundingClientRect().top] : []))
      setStageClear({
        top: above.length ? Math.max(0, Math.round(Math.max(...above) - area.top + 8)) : 0,
        bottom: below.length ? Math.max(0, Math.round(area.bottom - Math.min(...below))) : 0,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    for (const el of [frame, hudCardRef.current, dialogueStackRef.current, dialogueWrapRef.current, arrangeBarRef.current, sideRailRef.current]) if (el) observer.observe(el)
    return () => observer.disconnect()
  }, [showLog, hideUI, arrangingStage, sideExpanded, chat.id])
  useEffect(() => {
    dialogueBoxRef.current?.scrollTo({ top: 0 })
  }, [lastCharMsg?.id, activeSwipe])

  // Auto mode: once a reply's typewriter (and optional voice) finishes, wait for reading time, then hand off
  // to `onAutoAdvanceFire` — real VN autoplay. Keyed on the message id + completion flag so this
  // schedules exactly once per newly-completed reply, not on every unrelated re-render while it
  // stays complete. A "latest callback" ref means the fire, whenever it lands, always sees
  // `ChatWindow`'s current guards (isGenerating/activeChoices/live-date/etc.), not a stale closure
  // from the moment the timer was scheduled.
  const onAutoAdvanceFireRef = useRef(onAutoAdvanceFire)
  useEffect(() => {
    onAutoAdvanceFireRef.current = onAutoAdvanceFire
  })
  useEffect(() => {
    if (arrangingStage || !autoAdvance || !dialogueComplete || nextBeatMsg || speakState !== 'idle') return
    const delayMs = Math.min(30000, Math.max(4000, 1500 + shownDialogueText.length * 55))
    const t = setTimeout(() => onAutoAdvanceFireRef.current?.(), delayMs)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangingStage, autoAdvance, dialogueComplete, lastCharMsg?.id, nextBeatMsg?.id, speakState])

  const regexScripts = useSettingsStore((s) => s.regexScripts)
  const sfxEnabled = useSettingsStore((s) => s.sfxBursts)
  const sfxWordsSetting = useSettingsStore((s) => s.sfxWords)
  const dialogueSfx = lastCharMsg
    ? sfxConfigFor(lastCharMsg, {
        enabled: sfxEnabled,
        globalWords: parseSfxWordList(sfxWordsSetting),
        primary: character,
        participants: participantCharacters,
      })
    : undefined
  const showPetals = !reducedMotion && !!sceneBackground && OUTDOOR_BACKGROUNDS.has(sceneBackground)

  const lineNavigation = beatIndex >= 0 && beatMessages.length > 1 ? (
    <nav aria-label="Scene lines" className="flex shrink-0 items-center gap-1 text-xs text-white/75">
      <button
        type="button"
        onClick={() => previousBeatMsg && setViewedMessageId(previousBeatMsg.id)}
        disabled={!previousBeatMsg}
        aria-label="Previous line"
        className="rounded-lg p-1.5 hover:bg-white/10 disabled:opacity-30"
      ><ChevronLeft size={16} /></button>
      <span className="min-w-10 text-center tabular-nums">{beatIndex + 1} / {beatMessages.length}</span>
      <button
        type="button"
        onClick={() => nextBeatMsg && setViewedMessageId(nextBeatMsg.id)}
        disabled={!nextBeatMsg}
        aria-label="Next line"
        className="flex items-center gap-0.5 rounded-lg px-1.5 py-1 font-medium text-white hover:bg-white/10 disabled:opacity-30"
      >Next <ChevronRight size={15} /></button>
    </nav>
  ) : undefined

  // Navigation and per-line controls share one popup so the popup cannot cover the line buttons.
  const utilities =
    !isWriting && (lineNavigation || canSwipe || (lastCharMsg && !isStreamingThis && !showUserAsCurrent)) ? (
      <>
        {lineNavigation}
        {lineNavigation && (canSwipe || (lastCharMsg && !isStreamingThis && !showUserAsCurrent)) && (
          <span className="mx-1 h-4 w-px bg-white/15" />
        )}
        {canSwipe && (
          <>
            <span className="flex items-center gap-0.5 text-xs text-white/70">
              <button
                onClick={() => onSwipe(lastCharMsg!.id, 'left')}
                disabled={(lastCharMsg!.activeSwipe ?? 0) === 0}
                aria-label="Previous swipe"
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-30"
              >
                <ChevronLeft size={15} strokeWidth={2} />
              </button>
              <span className="px-0.5 tabular-nums">
                {(lastCharMsg!.activeSwipe ?? 0) + 1}/{swipes.length}
              </span>
              <button
                onClick={() => onSwipe(lastCharMsg!.id, 'right')}
                aria-label="Next swipe"
                className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10"
              >
                <ChevronRight size={15} strokeWidth={2} />
              </button>
            </span>
            <span className="mx-1 h-4 w-px bg-white/15" />
            <button
              onClick={() => onRegenerate(lastCharMsg!.id)}
              title="Regenerate"
              aria-label="Regenerate"
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10"
            >
              <RotateCcw size={14} strokeWidth={2} />
            </button>
            <button
              onClick={() => onFork(lastCharMsg!.id)}
              title="Fork chat from here"
              aria-label="Fork chat from here"
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10"
            >
              <GitFork size={14} strokeWidth={2} />
            </button>
          </>
        )}
        {lastCharMsg && !isStreamingThis && !showUserAsCurrent && (
          <>
            {canSwipe && <span className="mx-1 h-4 w-px bg-white/15" />}
            <button
              onClick={speakLine}
              disabled={silentGmNote}
              title={silentGmNote ? 'This GM note has no narration to read' : speakState === 'idle' ? 'Read this line aloud' : speakState === 'loading' ? 'Loading…' : 'Stop'}
              aria-label={silentGmNote ? 'No narration in this GM note' : speakState === 'idle' ? 'Read this line aloud' : 'Stop reading aloud'}
              className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-white/10 disabled:opacity-30 ${speakState !== 'idle' ? 'text-accent' : 'text-white/70'}`}
            >
              {speakState === 'loading' ? (
                <Loader2 size={14} strokeWidth={2} className="animate-spin" />
              ) : speakState === 'playing' ? (
                <Volume2 size={14} strokeWidth={2} />
              ) : (
                <Volume1 size={14} strokeWidth={2} />
              )}
            </button>
            <button
              onClick={() => setAutoVoice((v) => !v)}
              title={autoVoice ? 'Auto-voice: on. Reads each new reply aloud' : 'Auto-voice: read each new reply aloud automatically'}
              aria-label={autoVoice ? 'Auto-voice: on' : 'Auto-voice: off'}
              aria-pressed={autoVoice}
              className={`relative flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold transition-colors hover:bg-white/10 ${
                autoVoice ? 'text-accent' : 'text-white/70'
              }`}
            >
              A
              {autoVoice && <span className="vn-auto-pulse absolute right-0.5 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
            </button>
            <button
              onClick={() => onTogglePin(lastCharMsg!.id)}
              title={lastCharMsg.pinned ? 'Unpin' : 'Pin this moment'}
              aria-label={lastCharMsg.pinned ? 'Unpin message' : 'Pin message'}
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors hover:bg-white/10 ${lastCharMsg.pinned ? 'text-accent' : 'text-white/70'}`}
            >
              <Star size={14} strokeWidth={2} fill={lastCharMsg.pinned ? 'currentColor' : 'none'} />
            </button>
          </>
        )}
      </>
    ) : undefined

  // Both captions only ever apply to a failed generation being shown as the player's own last line.
  const dialogueCaption = showUserAsCurrent ? (
    <>
      {lastUserMsg!.intimacyAction && (
        <span
          className="mt-2.5 flex w-fit items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/70"
          title={`Sent from the Relationship panel's Unlocks tab (${lastUserMsg!.intimacyAction.category.replace('_', ' ')}): "${lastUserMsg!.intimacyAction.label}"`}
        >
          <Heart size={9} strokeWidth={2.25} className="shrink-0" />
          {lastUserMsg!.intimacyAction.label}
        </span>
      )}
      {/* The failure as a small caption rather than the main line — the player's actual words stay
          the primary content; this just explains the silence. */}
      <p className="mt-2 text-[12px] text-danger/90">
        ⚠ {activeMember?.name ?? character?.card.name ?? 'Their'}'s reply failed. Try regenerating (⟲) from the log.
      </p>
    </>
  ) : undefined

  const navigationActions: ChatToolbarAction[] = [
    ...(onOpenMenu ? [{ key: 'main-menu', icon: Menu, label: 'Main menu', onClick: onOpenMenu }] : []),
    ...(onBack ? [{ key: 'back', icon: ArrowLeft, label: 'Back to Stories', onClick: onBack }] : []),
    ...sideActions.filter((action) => ['studio', 'goals', 'story', 'transcript', 'search'].includes(action.key) && !action.hidden),
  ]
  const sceneActions: ChatToolbarAction[] = onOpenScenery ? [{
    key: 'scenery', icon: MapPin,
    label: `Scenery: ${sceneBackground ? backgroundLabel(sceneBackground, world) : 'unplaced'} · ${night ? 'night' : 'day'}`,
    onClick: onOpenScenery,
    active: !!scenery?.backgroundId,
  }] : []
  const playbackActions: ChatToolbarAction[] = [
    ...(castMembers.some((member) => member.id === visualFocusId && member.vrmUrl) ? [
      { key: 'vrm-wave', icon: Hand, label: 'Wave', disabled: reducedMotion, onClick: () => setVrmGesture((prev) => ({ kind: 'wave', nonce: prev.nonce + 1 })) },
      { key: 'vrm-smile', icon: Smile, label: 'Smile', onClick: () => setVrmGesture((prev) => ({ kind: 'smile', nonce: prev.nonce + 1 })) },
    ] : []),
    ...(onToggleAutoAdvance ? [{ key: 'auto', icon: Play, label: 'Auto-advance', onClick: onToggleAutoAdvance, active: autoAdvance }] : []),
    { key: 'skip', icon: ChevronsRight, label: 'Skip typewriter reveal', disabled: !typewriterActive || dialogueRevealDone,
      onClick: () => { if (typewriterActive && !dialogueRevealDone) skipTypewriter() } },
    { key: 'hide', icon: EyeOff, label: 'Hide UI', disabled: arrangingStage, onClick: () => setHideUI(true) },
    { key: 'history', icon: History, label: showLog ? 'Close history' : 'Open history', active: showLog,
      onClick: () => { setArrangingStage(false); setShowLog((value) => !value) } },
  ]
  const toolActions = sideActions.filter((action) => !['studio', 'goals', 'story', 'transcript', 'search'].includes(action.key) && !action.hidden)
  const railButton = (action: ChatToolbarAction) => (
    <button key={action.key} type="button" onClick={() => { action.onClick(); if (action.key !== 'auto') setSideExpanded(false) }}
      disabled={action.disabled} title={sideExpanded ? undefined : action.label} aria-label={action.label}
      aria-pressed={action.key === 'auto' ? !!action.active : undefined}
      data-tour={action.key === 'story' ? 'story-panel' : action.key === 'transcript' ? 'vn-toggle' : undefined}
      className={`items-center rounded-xl text-left text-sm transition-colors hover:bg-white/15 disabled:opacity-35 ${sideExpanded
        ? 'flex min-h-10 w-full gap-3 px-3 py-2'
        : 'hidden h-10 w-10 justify-center md:flex'} ${action.active ? 'bg-white/10 text-accent' : 'text-white/85'}`}>
      <action.icon size={18} strokeWidth={1.75} className="shrink-0" />
      {sideExpanded && <span className="min-w-0 flex-1 break-words leading-snug">{action.label}</span>}
    </button>
  )
  const railSection = (label: string, actions: ChatToolbarAction[]) => actions.length > 0 && (
    <div className="w-full">
      {sideExpanded && <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-widest text-white/50">{label}</p>}
      {actions.map(railButton)}
    </div>
  )

  return (
    <div
      className={`relative flex flex-1 flex-col overflow-hidden ${datingChrome ? '' : 'vn-neutral'}`}
      // A scene click reveals the current line, then advances one queued speaker at a time.
      onClick={(e) => {
        if (arrangingStage) return
        if (hideUI) {
          setHideUI(false)
          return
        }
        if ((e.target as HTMLElement).closest('button, input, textarea, select, [role="button"]')) return
        if (showLog) return
        if (typewriterActive && !dialogueRevealDone) skipTypewriter()
        else if (dialogueComplete && nextBeatMsg) setViewedMessageId(nextBeatMsg.id)
      }}
    >
      {/* The outgoing scene stays painted underneath while the incoming one fades in over it — a
          `background` property can't be transitioned, so a change used to be a hard cut. */}
      {outgoingBgStyle && <div className="absolute inset-0" style={outgoingBgStyle} />}
      <div key={bgKey} className="vn-backdrop-in absolute inset-0" style={bgStyle} />
      {triggeredCgEntry && triggeredCgImageUrl && (
        // Full-bleed CG in place of the ordinary background — sprites are skipped below while one's
        // showing. `key` remounts per distinct CG, which is what replays `.vn-cg-reveal` each time.
        <img
          key={triggeredCgEntry.id}
          src={triggeredCgImageUrl}
          alt={triggeredCgEntry.title}
          className="vn-cg-reveal absolute inset-0 h-full w-full object-cover"
        />
      )}
      {stageMoment && (
        // A story moment, over everything until dismissed: the picture is the scene for now.
        <button type="button" onClick={(event) => { event.stopPropagation(); onShowMoment?.(null) }} aria-label="Close the picture"
          className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black">
          <img key={stageMoment.id} src={stageMoment.imageUrl} alt={stageMoment.caption || 'Story moment'} className="vn-cg-reveal max-h-full w-full flex-1 object-contain" />
          {stageMoment.caption && <span className="absolute inset-x-0 bottom-6 mx-auto w-fit max-w-[90%] rounded-full bg-black/60 px-4 py-1.5 text-sm text-white">{stageMoment.caption}</span>}
        </button>
      )}
      {/* Lighter than it used to be: the dialogue box now carries its own glass backdrop, so the
          page-wide scrim only has to keep the top HUD legible and give the box's blur something to
          sit on. Any more and the art stops being the subject. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-black/[0.04] to-black/25" />
      {/* Cinematic vignette rather than a flat scrim. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 82% 68% at 50% 40%, transparent 58%, rgb(0 0 0 / 0.30) 100%)' }}
      />
      {showPetals && <SakuraPetals />}

      {/* Hidden along with the rest of the chrome under Hide-UI — click the scene to bring it back. */}
      {!hideUI && (
      <>
      <div className="absolute inset-x-3 top-3 z-20 sm:inset-x-4 sm:top-4">
        <div ref={hudCardRef} className="vn-glass min-w-0 max-w-[calc(100%-4rem)] overflow-hidden rounded-2xl text-white sm:max-w-[58%]">
          {(personaName || chat.mode || parentChatLink) && (
            <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-2 text-[11px] text-white/70">
              {personaName && <span className="truncate">as {personaName}</span>}
              {chat.mode && (
                <>
                  {personaName && <span className="text-white/30">·</span>}
                  <span className="truncate">{getWorldTemplate(chat.mode).label}</span>
                </>
              )}
              {parentChatLink && (
                <>
                  {(personaName || chat.mode) && <span className="text-white/30">·</span>}
                  {parentChatLink}
                </>
              )}
            </div>
          )}
          {datingChrome && cast.length > 0 && <StageRow variant="vn" first={!(personaName || chat.mode || parentChatLink)} className="!py-2">
            <div className="mb-1 flex min-w-0 items-center gap-1.5">
              <Heart size={11} strokeWidth={2.25} className="shrink-0 text-romance" fill="currentColor" fillOpacity={0.4} />
              <StageLabel variant="vn">
                {/* Named only when there's more than one cast member to disambiguate. */}
                Bond{isGroupScene ? ` · ${activeMember?.name ?? ''}` : ''}
              </StageLabel>
              <span className="truncate font-semibold capitalize text-romance">{formatRelationshipStage(relationshipStage)}</span>
              <span className="shrink-0 text-white/90">{warmth}</span>
            </div>
            <StageMeter value={warmth} variant="vn" className="w-28 max-w-full" />
          </StageRow>}
          {showEnergy && (
            // Same "N/M actions" budget the Day Planner modal shows, surfaced here too — knowing
            // whether there's still room for another activity today used to mean actually opening
            // that modal to find out.
            <div
              className="flex items-center gap-1.5 truncate border-t border-white/10 px-3 py-1.5 text-xs"
              title="Today's day-planner action budget. Opens in Plan your day."
            >
              <Sunrise size={11} strokeWidth={2.25} className="shrink-0 text-white/60" />
              <span className="shrink-0 uppercase tracking-wide text-white/60">Today</span>
              <span className="flex shrink-0 items-center gap-0.5">
                {Array.from({ length: energyMax }).map((_, i) => (
                  <span key={i} className={`h-1.5 w-1.5 rounded-full ${i < energyRemaining ? 'bg-white/90' : 'bg-white/20'}`} />
                ))}
              </span>
              <span className="truncate text-white/70">
                {energyRemaining === 0 ? 'Out of actions — rest to reset' : `${energyRemaining} action${energyRemaining === 1 ? '' : 's'} left`}
              </span>
            </div>
          )}
          {datingChrome && chat.activeEvent?.title && (
            <div className="flex items-center gap-1.5 truncate border-t border-white/10 px-3 py-1.5 text-xs">
              <span className="shrink-0 uppercase tracking-wide text-white/60">
                {liveDateActive ? (isHangoutEvent ? 'Hangout' : 'Date') : 'Event'}
              </span>
              <span className="truncate text-white/90">{chat.activeEvent.title}</span>
            </div>
          )}
          {datingChrome && liveDateActive && chat.rapport && (
            <div className="border-t border-white/10 px-3 py-1.5 text-xs">
              <LiveRapport read={chat.rapport} variant="vn" label={isHangoutEvent ? 'Live hangout' : 'Live date'} />
            </div>
          )}
          {datingChrome && activeIntimacyScene && activeSpeakerId && (
            // Compact on purpose: the stage HUD says what's happening and roughly how far along,
            // and the Relationship panel carries the full readout (meters, clothing, contact).
            <div className="border-t border-white/10">
              <SceneStateCard
                scene={activeIntimacyScene}
                viewingId={activeSpeakerId}
                nameOf={(id) => cast.find((c) => c.id === id)?.card.name ?? 'Someone else'}
                userName={persona?.name || 'You'}
                charReplyCount={charRepliesNow}
                graph={scenarioById(getScenarioCatalog(world), activeIntimacyScene.scenarioId)}
                variant="vn"
                compact
                className="!rounded-none !bg-transparent !backdrop-blur-none"
              />
            </div>
          )}
        </div>

      </div>
      {sideExpanded && <button type="button" aria-label="Close Visual Novel controls"
        onClick={() => setSideExpanded(false)} className="fixed inset-0 z-20 bg-black/40 md:hidden" />}
      <aside ref={sideRailRef} aria-label="Visual Novel controls" data-tour="tools-menu"
        className={`absolute bottom-3 right-3 top-3 z-30 flex flex-col overflow-hidden rounded-2xl border border-white/10 text-white shadow-xl backdrop-blur-xl transition-[width] duration-200 ${sideExpanded
          ? 'w-[min(18rem,calc(100%-1.5rem))] bg-black/90'
          : 'h-fit max-h-[calc(100%-1.5rem)] w-11 bg-black/70'}`}>
        <button type="button" onClick={() => setSideExpanded((value) => !value)}
          data-tour="play-menu"
          aria-label={sideExpanded ? 'Collapse Visual Novel controls' : 'Expand Visual Novel controls'}
          aria-expanded={sideExpanded}
          className="flex h-11 w-full shrink-0 items-center gap-3 border-b border-white/10 px-3 text-white/90 hover:bg-white/15">
          {sideExpanded ? <PanelRightClose size={18} strokeWidth={1.75} className="shrink-0" /> : <PanelRightOpen size={18} strokeWidth={1.75} className="shrink-0" />}
          {sideExpanded && <span className="text-sm font-semibold">Scene controls</span>}
        </button>
        <div className={`vn-toolbar-scroll min-h-0 w-full flex-col overflow-y-auto ${sideExpanded ? 'flex px-2 pb-3' : 'hidden px-0.5 pb-1 md:flex'}`}>
          {railSection('Navigate', navigationActions)}
          {railSection('Scene', sceneActions)}
          <div className="hidden w-full md:block">
            {sideExpanded ? (
              <div className="space-y-3 px-3 pb-2">
                <p className="pt-3 text-[10px] font-semibold uppercase tracking-widest text-white/50">Stage layout</p>
                <label className="block text-xs text-white/80">
                  <span className="mb-1 block">Direction</span>
                  <select value={stage.layout?.id ?? ''} aria-label="Stage direction"
                    onChange={(event) => (event.target.value ? saveStage(applyLayout(sceneStage, event.target.value)) : automaticStage())}
                    className="w-full rounded-lg border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-white">
                    <option value="">Automatic</option>
                    {layouts.map((layout) => <option key={layout.id} value={layout.id}>{layout.name}</option>)}
                  </select>
                </label>
                {stage.direction === 'pinned' && <p className="text-[11px] leading-snug text-white/60">Some characters are placed by hand in this scene.</p>}
                <button type="button" onClick={arrangingStage ? () => { setArrangingStage(false); setSideExpanded(false) } : beginArrangeStage}
                  disabled={!!triggeredCgEntry || castMembers.length === 0}
                  className="flex w-full items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-left text-sm hover:bg-white/20 disabled:opacity-40">
                  <Move size={15} />{arrangingStage ? 'Finish arranging' : 'Arrange cast'}
                </button>
                <label className="block text-xs text-white/80">
                  <span className="mb-1 block">Speaker</span>
                  <select value={stage.focus} aria-label="Speaker focus"
                    onChange={(event) => saveStage({ ...sceneStage, focus: event.target.value === 'light' ? 'light' : 'step' })}
                    className="w-full rounded-lg border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-white">
                    <option value="step">Steps forward</option>
                    <option value="light">Lit only</option>
                  </select>
                </label>
                <label className="block text-xs text-white/80">
                  <span className="mb-1 flex justify-between"><span>Stage width</span><span>{stage.width}%</span></span>
                  <input type="range" min="60" max="100" step="5" value={stage.width}
                    onChange={(event) => editStage({ ...sceneStage, width: Number(event.target.value) })}
                    onPointerUp={() => saveStage()} onKeyUp={() => saveStage()}
                    className="w-full accent-[rgb(var(--c-accent))]" />
                </label>
                <label className="block text-xs text-white/80">
                  <span className="mb-1 flex justify-between"><span>Stage depth</span><span>{stage.depth}%</span></span>
                  <input type="range" min="30" max="60" step="5" value={stage.depth}
                    onChange={(event) => editStage({ ...sceneStage, depth: Number(event.target.value) })}
                    onPointerUp={() => saveStage()} onKeyUp={() => saveStage()}
                    className="w-full accent-[rgb(var(--c-accent))]" />
                </label>
                {onStageLayoutsChange && (layoutName === null ? (
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-xs text-white/70">
                    <button type="button" onClick={() => setLayoutName('')} className="flex items-center gap-1.5 hover:text-white">
                      <Save size={13} />Save as layout
                    </button>
                    {stage.layout && stage.direction === 'pinned' && (
                      <button type="button" onClick={() => updateLayout(stage.layout!)} className="hover:text-white">Update layout</button>
                    )}
                    {stage.layout && (
                      <button type="button" onClick={() => void deleteLayout(stage.layout!)} className="flex items-center gap-1.5 hover:text-white">
                        <Trash2 size={13} />Delete layout
                      </button>
                    )}
                  </div>
                ) : (
                  <form className="flex gap-2" onSubmit={(event) => {
                    event.preventDefault()
                    if (!layoutName.trim()) return
                    saveLayoutAs(layoutName)
                    setLayoutName(null)
                  }}>
                    <input autoFocus value={layoutName} maxLength={60} placeholder="Layout name" aria-label="Layout name"
                      onChange={(event) => setLayoutName(event.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-white" />
                    <button type="submit" disabled={!layoutName.trim()} className="rounded-lg bg-white/15 px-2 text-xs hover:bg-white/25 disabled:opacity-40">Save</button>
                    <button type="button" onClick={() => setLayoutName(null)} className="px-1 text-xs text-white/70 hover:text-white">Cancel</button>
                  </form>
                ))}
                {stage.layout && stage.direction === 'pinned' && (
                  <button type="button" onClick={() => saveStage(applyLayout(sceneStage, stage.layout!.id))} className="flex items-center gap-2 text-xs text-white/70 hover:text-white">
                    <RotateCcw size={13} />Back to "{stage.layout.name}"
                  </button>
                )}
                {stage.direction !== 'automatic' && (
                  <button type="button" onClick={automaticStage} className="flex items-center gap-2 text-xs text-white/70 hover:text-white">
                    <RotateCcw size={13} />Back to automatic
                  </button>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => setSideExpanded(true)} title="Stage layout" aria-label="Stage layout"
                className={`flex h-10 w-10 items-center justify-center rounded-xl hover:bg-white/15 ${arrangingStage ? 'text-accent' : 'text-white/85'}`}>
                <SlidersHorizontal size={18} strokeWidth={1.75} />
              </button>
            )}
          </div>
          {sideExpanded && onAppearanceChange && cast.some((member) => (member.outfits ?? []).length > 0) && (
            <div className="space-y-2 border-t border-white/10 px-3 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Character appearance</p>
              {cast.map((member) => {
                const memberAffection = getRelationshipTrack(chat, member.id).affection ?? 0
                const options = availableAppearances(member.outfits, member.sprites, memberAffection, appearanceFlags)
                if (options.length < 2) return null
                const automatic = appearanceForCharacter(messages, {
                  id: member.id, name: member.card.name, outfits: member.outfits, sprites: member.sprites,
                }, character?.id ?? member.id, memberAffection, appearanceFlags)
                return <label key={member.id} className="block text-xs text-white/80">
                  <span className="mb-1 block truncate">{member.card.name}</span>
                  <select value={chat.scene?.appearanceOverrides?.[member.id] ?? ''}
                    onChange={(event) => onAppearanceChange(member.id, event.target.value || null)}
                    aria-label={`${member.card.name} appearance`}
                    className="w-full rounded-lg border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-white">
                    <option value="">Follow scene ({options.find((option) => option.id === automatic)?.label ?? 'Default'})</option>
                    {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
              })}
            </div>
          )}
          {railSection('Playback', playbackActions)}
          {railSection('Tools', toolActions)}
          {sideExpanded && contextMeter && <div className="mt-3 border-t border-white/10 px-3 pt-3">{contextMeter}</div>}
        </div>
      </aside>
      </>
      )}

      {showLog ? (
        // Top padding clears the floating HUD card, which stays up over the backlog; the width cap
        // keeps a long transcript readable on a wide monitor instead of running the full stage.
        <div ref={logRef} className="relative z-10 flex-1 overflow-y-auto bg-bg/95 px-6 pb-6 pt-24 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl">
          <MessageLog
            messages={messages}
            character={character}
            persona={persona}
            participantCharacters={participantCharacters}
            generatingMessageId={generatingMessageId}
            streamingText={streamingText}
            highlightedMessageId={highlightedMessageId}
            onEdit={onEdit}
            onDelete={onDelete}
            onRewind={onRewind}
            onRegenerate={onRegenerate}
            onSteer={onSteer}
            onSwipe={onSwipe}
            onFork={onFork}
            onTogglePin={onTogglePin}
            onPicture={onPicture}
            momentsByMessage={momentsByMessage}
            onShowMoment={onShowMoment ? (moment) => { setShowLog(false); onShowMoment(moment) } : undefined}
          />
          </div>
        </div>
      ) : (
        <>
          {/* The background stays visible behind a staggered cast: speaker in front, companions
              farther into the scene. Phones frame only the person whose line is being read. */}
          <div
            // The cast is framed below the HUD card and, from `md` up, clear of the rail. On a phone
            // the one figure stands on top of the dialogue box and whatever is stacked on it (the
            // sprite is width-bound long before it is height-bound, so on the floor it would sit
            // almost entirely behind the box). From `md` up the floor runs to the bottom edge (and a
            // little below it), behind the box, except while arranging, when the bar sits there.
            ref={stageFrameRef}
            style={{ '--vn-clear-top': `${stageClear?.top ?? 40}px`, '--vn-clear-bottom': stageClear ? `${stageClear.bottom}px` : '24vh' } as CSSProperties}
            className={`absolute inset-x-0 bottom-0 top-0 z-0 flex items-end justify-center px-4 pb-[var(--vn-clear-bottom)] pt-[var(--vn-clear-top)] sm:px-6 md:px-16 ${
              arrangingStage ? '' : 'md:-bottom-[4%] md:pb-0'}`}
          >
            {/* Skipped while a CG is showing full-bleed; sprites over unrelated CG art look wrong. */}
            {!triggeredCgEntry && (
            <div ref={stageRootRef} className="relative mx-auto h-full w-full md:w-[var(--stage-area-width)] md:max-w-[1400px]"
              style={{ '--stage-area-width': `${stage.width}%` } as CSSProperties}>
              {arrangingStage && (
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-20 h-full w-full">
                  <polygon points={`22,${100 - stage.depth} 78,${100 - stage.depth} 100,100 0,100`}
                    fill="rgb(58 205 183 / 0.08)" stroke="rgb(94 234 212 / 0.9)" strokeWidth="2" strokeDasharray="8 5" vectorEffect="non-scaling-stroke" />
                </svg>
              )}
              {stagedFigures.filter(({ phase }) => !arrangingStage || phase !== 'exiting').map(({ member, figure, phase }) => {
                const box = stagePointStyle(figure.point, stage.depth)
                // A larger size cue never lifts a head past the top of the stage (under the HUD).
                const size = Math.min(figure.scale, (100 - box.bottom) / box.height)
                // Never wider than the gap to the nearest neighbour, so side by side nobody covers anybody.
                const width = Math.min(box.width * size, widthCaps[member.id] ?? 100)
                const figureDepth: StageDepth = member.isActive ? 'foreground' : figure.point.depth >= 0.5 ? 'midground' : 'background'
                const draggable = arrangingStage && phase !== 'exiting'
                const endDrag = () => {
                  if (dragRef.current?.moved) saveStage()
                  dragRef.current = null
                }
                return (
                <div
                  key={member.id}
                  role={draggable ? 'button' : undefined}
                  tabIndex={draggable ? 0 : undefined}
                  aria-label={draggable ? `Move ${member.name} on stage. Use arrow keys or drag.` : undefined}
                  onPointerDown={draggable ? (event) => {
                    if (event.button !== 0 || !stageRootRef.current) return
                    event.preventDefault()
                    event.stopPropagation()
                    setSelectedFigureId(member.id)
                    const rect = stageRootRef.current.getBoundingClientRect()
                    dragRef.current = { id: member.id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, point: figure.home, width: rect.width, height: rect.height, moved: false }
                    event.currentTarget.setPointerCapture(event.pointerId)
                  } : undefined}
                  onPointerMove={draggable ? (event) => {
                    const drag = dragRef.current
                    if (!drag || drag.id !== member.id || drag.pointerId !== event.pointerId) return
                    drag.moved = true
                    editStage(pinned(figure, moveStagePoint(drag.point, (event.clientX - drag.clientX) / drag.width, (event.clientY - drag.clientY) / drag.height, stage.depth)))
                  } : undefined}
                  onPointerUp={draggable ? endDrag : undefined}
                  onPointerCancel={draggable ? endDrag : undefined}
                  onFocus={draggable ? () => setSelectedFigureId(member.id) : undefined}
                  onKeyDown={draggable ? (event) => {
                    const delta = event.key === 'ArrowLeft' ? [-0.02, 0] : event.key === 'ArrowRight' ? [0.02, 0]
                      : event.key === 'ArrowUp' ? [0, -0.02] : event.key === 'ArrowDown' ? [0, 0.02] : null
                    if (!delta) return
                    event.preventDefault()
                    editStage(pinned(figure, moveStagePoint(figure.home, delta[0], delta[1], stage.depth)))
                  } : undefined}
                  onKeyUp={draggable ? (event) => { if (event.key.startsWith('Arrow')) saveStage() } : undefined}
                  className={`absolute left-1/2 bottom-0 h-[98%] -translate-x-1/2 outline-none md:left-[var(--stage-x)] md:bottom-[var(--stage-bottom)] md:h-[var(--stage-height)] md:w-[var(--stage-width)] ${draggable
                    ? `cursor-grab touch-none rounded-xl ring-2 hover:ring-teal-300/70 focus-visible:ring-teal-300 active:cursor-grabbing ${member.id === selectedFigure?.id ? 'ring-teal-300/50' : 'ring-transparent'}`
                    : 'transition-[left,width,height,bottom] duration-500 ease-out motion-reduce:transition-none'} ${phase !== 'exiting' && member.id === phoneId
                    ? 'w-[88%]'
                    : 'hidden md:block'}`}
                  style={{
                    '--stage-x': `${box.x}%`,
                    '--stage-width': `${width}%`,
                    '--stage-height': `${box.height * size}%`,
                    '--stage-bottom': `${box.bottom}%`,
                    maxWidth: Math.round((figureDepth === 'foreground' ? 620 : figureDepth === 'midground' ? 420 : 360) * size),
                    zIndex: figureLayer(figure),
                  } as CSSProperties}
                >
                  <VNCharacterSprite
                    spriteUrl={member.spriteUrl}
                    name={member.name}
                    hue={member.hue}
                    isActive={member.isActive}
                    depth={figureDepth}
                    onClick={draggable || phase === 'exiting' ? undefined : member.onClick}
                    phase={phase}
                    vrmUrl={phase === 'exiting' ? undefined : member.vrmUrl}
                    vrmMotions={member.vrmMotions}
                    expression={member.expression}
                    speaking={member.speaking}
                    gesture={member.id === visualFocusId ? vrmGesture.kind : undefined}
                    gestureNonce={member.id === visualFocusId ? vrmGesture.nonce : 0}
                    reducedMotion={reducedMotion}
                    transition={phase === 'exiting' ? figure.exit : figure.enter}
                  />
                </div>
                )
              })}
            </div>
            )}
          </div>

          {arrangingStage && (
            <div ref={arrangeBarRef} className="relative z-30 mx-4 mb-4 mt-auto flex flex-wrap items-center gap-3 rounded-2xl border border-teal-300/40 bg-black/80 px-4 py-3 text-xs text-white shadow-xl backdrop-blur-md md:mx-auto md:max-w-2xl">
              <Move size={17} className="shrink-0 text-teal-200" />
              <span className="min-w-0 flex-1">Drag a character within the outlined floor. Arrow keys move a focused character.</span>
              <button type="button" onClick={automaticStage} className="rounded-lg px-2 py-1.5 text-white/75 hover:bg-white/10 hover:text-white">Automatic</button>
              <button type="button" onClick={() => setArrangingStage(false)} className="rounded-lg bg-teal-300 px-3 py-1.5 font-semibold text-black hover:bg-teal-200">Done</button>
              {selectedFigure && (
                <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 border-t border-white/10 pt-2">
                  <span className="font-semibold">{castMembers.find((member) => member.id === selectedFigure.id)?.name}</span>
                  <label className="flex items-center gap-2">Size
                    <input type="range" min="60" max="140" step="5" value={Math.round(selectedFigure.scale * 100)}
                      onChange={(event) => editStage(pinned(selectedFigure, { scale: Number(event.target.value) / 100 }))}
                      onPointerUp={() => saveStage()} onKeyUp={() => saveStage()}
                      className="w-24 accent-teal-300" />
                  </label>
                  <label className="flex items-center gap-2">Enters
                    <select value={selectedFigure.enter} onChange={(event) => saveStage(pinned(selectedFigure, { enter: event.target.value as StageTransition }))}
                      className="rounded-lg border border-white/15 bg-neutral-900 px-2 py-1 text-xs text-white">
                      {STAGE_TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </label>
                  <label className="flex items-center gap-2">Leaves
                    <select value={selectedFigure.exit} onChange={(event) => saveStage(pinned(selectedFigure, { exit: event.target.value as StageTransition }))}
                      className="rounded-lg border border-white/15 bg-neutral-900 px-2 py-1 text-xs text-white">
                      {STAGE_TRANSITIONS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Hidden under Hide-UI too — only the background/sprites/CG stay up, full-scene. */}
          {!hideUI && !arrangingStage && (
          <>
          {/* Everything that isn't dialogue floats above the box instead of stacking inside it.
              That separation is what lets the box hold one fixed height while choices, quick
              replies and the assist strip come and go underneath the scene's own composition. */}
          <div ref={dialogueStackRef} className="vn-stack relative z-10 mt-auto pb-2">
            <div className="flex flex-col gap-2">
              {!triggeredCgEntry && artHint && character && (
                <div className="relative w-fit max-w-full rounded-2xl border border-dashed border-white/25 bg-black/45 py-2 pl-3.5 pr-8 text-[12px] leading-relaxed text-white/80 backdrop-blur-sm">
                  <p>{artHint}</p>
                  <button
                    type="button"
                    onClick={() => dismissVnArtHint(character.id)}
                    aria-label="Dismiss VN setup hint"
                    className="absolute right-2 top-2 text-white/45 transition-colors hover:text-white/90"
                  >
                    <X size={13} strokeWidth={2} />
                  </button>
                </div>
              )}
              {locationCaption && (
                // Only ever shown over a placeholder gradient — real art says where it is by itself.
                <span className="px-1 text-[10px] uppercase tracking-[0.18em] text-white/35">{locationCaption}</span>
              )}
              {assistSlot}
              {activeChoiceData && !nextBeatMsg && vnChoiceStyle === 'docked' && (
                <div className="max-h-[16vh] overflow-y-auto">
                  <ChoiceList
                    variant="vn"
                    choices={activeChoiceData.choices}
                    onPick={activeChoiceData.onPick}
                    onRefresh={activeChoiceData.onRefresh}
                    refreshing={activeChoiceData.refreshing}
                  />
                </div>
              )}
              {!nextBeatMsg && choiceListSlot}
            </div>
          </div>

          <div ref={dialogueWrapRef} className="relative z-10">
            <VNDialogueBox
              ref={dialogueBoxRef}
              narration={!showUserAsCurrent && (lastCharMsg?.speakerId === GM_SPEAKER_ID || !!lastCharMsg?.gm)}
              speakerName={speakerName}
              speakerAvatarUrl={speakerAvatarUrl}
              initials={initialsOf(speakerName)}
              plate={plate}
              personaLabel={persona?.name || 'You'}
              writing={isWriting}
              onStartWriting={inlineInput && !nextBeatMsg ? () => setWriting(true) : undefined}
              onNextLine={inlineInput && nextBeatMsg ? () => setViewedMessageId(nextBeatMsg.id) : undefined}
              onStopWriting={() => setWriting(false)}
              composer={composerSlot}
              streaming={isStreamingThis}
              complete={dialogueComplete}
              utilities={utilities}
              caption={dialogueCaption}
            >
              {renderMessageText(shownDialogueText, regexScripts, dialogueSfx)}
            </VNDialogueBox>
          </div>

          {/* 'docked' input mode keeps the composer as its own bar under the box — for anyone who'd
              rather always see it than have the box change hands. */}
          {!inlineInput && (!nextBeatMsg || composerHasDraft) && (
            <div className="vn-stack relative z-10 pb-3 sm:pb-5">
              <div className="vn-glass rounded-2xl px-3 py-1.5">{composerSlot}</div>
            </div>
          )}
          </>
          )}

          {/* The 'centered' choice style: a full-stage, scene-dimmed decision moment instead of the
              docked pills above — a real VN choice screen. Sits outside the Hide-UI gate above on
              purpose in the sense that it's its own conditional, but still never shows while
              Hide-UI is on (a pending choice just waits; clicking the scene restores the UI first). */}
          {activeChoiceData && !nextBeatMsg && vnChoiceStyle === 'centered' && !hideUI && !arrangingStage && (
            <VNCenteredChoices
              choices={activeChoiceData.choices}
              onPick={activeChoiceData.onPick}
              onRefresh={activeChoiceData.onRefresh}
              refreshing={activeChoiceData.refreshing}
            />
          )}
        </>
      )}
    </div>
  )
}
