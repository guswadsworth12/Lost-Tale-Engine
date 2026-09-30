import { clampStagePoint, DEFAULT_STAGE_AREA, type StageAreaSettings, type StagePoint } from './stageArea.ts'

/**
 * Visual Novel scene direction: where each character stands, how big, how they enter and leave,
 * and how the speaker is brought into focus.
 *
 * Three sources, strongest first:
 * - the scene's own pinned cues (`Chat.stage.cues`), set by arranging the cast in that scene,
 * - a saved layout the scene uses (`WorldCard.stageLayouts`, picked by `Chat.stage.layoutId`),
 *   reusable by any scene in the world,
 * - automatic direction: a fixed home spot per cast member, by roster order.
 * A character without a cue in the first two falls back to the next. "Automatic" clears both.
 *
 * Automatic direction never reshuffles the cast when the speaker changes: every home spot depends
 * only on the roster. The speaker is lit, and with the `step` focus style an automatically placed
 * speaker steps forward in place. Pinned and layout positions are never moved by focus.
 *
 * Only relative `.ts` imports here: the server loads this file with plain Node.
 */

export type StageTransition = 'rise' | 'fade' | 'slide-left' | 'slide-right' | 'none'
export const STAGE_TRANSITIONS: { id: StageTransition; label: string }[] = [
  { id: 'rise', label: 'Rise' },
  { id: 'fade', label: 'Fade' },
  { id: 'slide-left', label: 'Left side' },
  { id: 'slide-right', label: 'Right side' },
  { id: 'none', label: 'Cut' },
]

/** `step`: an automatically placed speaker steps forward. `light`: the speaker is only lit. */
export type StageFocusStyle = 'step' | 'light'

export interface StageCue extends StagePoint {
  /** Size relative to where the depth alone would put them, 0.6 to 1.4. Unset: 1. */
  scale?: number
  enter?: StageTransition
  exit?: StageTransition
}

/** A named arrangement of a world's characters, reusable by any scene there. */
export interface StageLayout {
  id: string
  name: string
  /** The stage floor's width and depth, in percent (as `StageAreaSettings`). */
  width: number
  depth: number
  focus: StageFocusStyle
  /** By character id. */
  cues: Record<string, StageCue>
  updatedAt: number
}

/** One scene's direction (`Chat.stage`): the saved layout it uses, and its own pinned overrides. */
export interface SceneStage {
  layoutId?: string
  width?: number
  depth?: number
  focus?: StageFocusStyle
  /** Pinned by arranging the cast in this scene; they outrank the layout's. */
  cues?: Record<string, StageCue>
}

export interface ResolvedFigure {
  id: string
  /** Where they stand on their own; a focused automatic figure may step forward from here. */
  home: StagePoint
  /** Where they stand now. */
  point: StagePoint
  scale: number
  enter: StageTransition
  exit: StageTransition
  source: 'pinned' | 'layout' | 'auto'
  focused: boolean
}

export interface ResolvedStage {
  width: number
  depth: number
  focus: StageFocusStyle
  /** The saved layout in use, when it still exists. */
  layout?: StageLayout
  /** What's directing the scene, for the controls to say. */
  direction: 'automatic' | 'layout' | 'pinned'
  figures: ResolvedFigure[]
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * A cast member's home spot under automatic direction, from their place in the roster alone. One
 * character stands center; a few spread across the floor; a larger cast alternates front and back
 * rows so nobody hides behind anybody.
 */
export function autoHome(index: number, count: number): StagePoint {
  if (count <= 1) return { x: 0.5, depth: 0.7 }
  const spacing = Math.min(0.24, 0.62 / (count - 1))
  const x = 0.5 + (index - (count - 1) / 2) * spacing
  const depth = count <= 3 ? 0.55 : index % 2 === 0 ? 0.6 : 0.3
  return clampStagePoint({ x, depth })
}

/** How far a focused, automatically placed speaker steps toward the viewer. */
export const FOCUS_STEP = 0.3

export function resolveStage(
  castIds: readonly string[],
  focusId: string | undefined,
  scene: SceneStage | undefined,
  layouts: readonly StageLayout[] | undefined,
): ResolvedStage {
  const layout = scene?.layoutId ? layouts?.find((l) => l.id === scene.layoutId) : undefined
  const width = clamp(scene?.width ?? layout?.width ?? DEFAULT_STAGE_AREA.width, 60, 100)
  const depth = clamp(scene?.depth ?? layout?.depth ?? DEFAULT_STAGE_AREA.depth, 30, 60)
  const focus = scene?.focus ?? layout?.focus ?? 'step'
  const figures = castIds.map((id, index): ResolvedFigure => {
    const pinned = scene?.cues?.[id]
    const authored = layout?.cues[id]
    const cue = pinned ?? authored
    const source = pinned ? 'pinned' : authored ? 'layout' : 'auto'
    const home = cue ? clampStagePoint(cue) : autoHome(index, castIds.length)
    const focused = id === focusId
    const point = focused && source === 'auto' && focus === 'step' ? clampStagePoint({ x: home.x, depth: home.depth + FOCUS_STEP }) : home
    return { id, home, point, scale: clamp(cue?.scale ?? 1, 0.6, 1.4), enter: cue?.enter ?? 'rise', exit: cue?.exit ?? 'rise', source, focused }
  })
  const direction = scene?.cues && Object.keys(scene.cues).length ? 'pinned' : layout ? 'layout' : 'automatic'
  return { width, depth, focus, layout, direction, figures }
}

/**
 * Who a phone frames: the one speaking; during narration or the player's own line, whoever spoke
 * last; before anyone has, the lead. Always exactly one when anyone is on stage.
 */
export function phoneFocusId(castIds: readonly string[], speakerId: string | undefined, lastSpeakerId: string | undefined): string | undefined {
  if (speakerId && castIds.includes(speakerId)) return speakerId
  if (lastSpeakerId && castIds.includes(lastSpeakerId)) return lastSpeakerId
  return castIds[0]
}

/** Draw order: nearer figures in front, and the focused one in front of its row. */
export function figureLayer(figure: Pick<ResolvedFigure, 'point' | 'focused'>): number {
  return 1 + Math.round(figure.point.depth * 10) + (figure.focused ? 20 : 0)
}

// ---- Editing a scene's direction ---------------------------------------------------------------

/** Pins one character in this scene, keeping everything else as it is. */
export function pinCue(scene: SceneStage | undefined, id: string, cue: StageCue): SceneStage {
  return { ...scene, cues: { ...scene?.cues, [id]: normalizeCue(cue) ?? { x: 0.5, depth: 0.5 } } }
}

/**
 * Starts arranging: every figure pinned where it stands now (its home, not a focus step), so
 * nothing jumps when the drag begins.
 */
export function pinAll(scene: SceneStage | undefined, stage: ResolvedStage): SceneStage {
  const cues = Object.fromEntries(stage.figures.map((f) => [f.id, { ...f.home, ...(f.scale !== 1 ? { scale: f.scale } : {}), ...(f.enter !== 'rise' ? { enter: f.enter } : {}), ...(f.exit !== 'rise' ? { exit: f.exit } : {}) }]))
  return { ...scene, cues: { ...cues, ...scene?.cues } }
}

/** Uses a saved layout: the scene's own pins give way to it. */
export function applyLayout(scene: SceneStage | undefined, layoutId: string): SceneStage {
  const { cues: _cues, width: _w, depth: _d, focus: _f, ...rest } = scene ?? {}
  return { ...rest, layoutId }
}

/** The stage as it stands, saved as a layout any scene in the world can use. */
export function captureLayout(stage: ResolvedStage, name: string, id: string, now: number): StageLayout {
  const cues: Record<string, StageCue> = {}
  for (const f of stage.figures) {
    cues[f.id] = { x: f.home.x, depth: f.home.depth, ...(f.scale !== 1 ? { scale: f.scale } : {}), ...(f.enter !== 'rise' ? { enter: f.enter } : {}), ...(f.exit !== 'rise' ? { exit: f.exit } : {}) }
  }
  return { id, name: name.trim().slice(0, 60) || 'Stage layout', width: stage.width, depth: stage.depth, focus: stage.focus, cues, updatedAt: now }
}

/** A scene arranged before direction was saved with it (browser storage), as its pinned direction. */
export function sceneStageFromLegacy(area: Partial<StageAreaSettings> | undefined): SceneStage | undefined {
  if (!area || typeof area !== 'object') return undefined
  const cues = Object.fromEntries(Object.entries(area.positions ?? {}).flatMap(([id, p]) => {
    const cue = normalizeCue(p)
    return cue ? [[id, cue]] : []
  }))
  const stage: SceneStage = {
    ...(Number.isFinite(area.width) ? { width: clamp(area.width!, 60, 100) } : {}),
    ...(Number.isFinite(area.depth) ? { depth: clamp(area.depth!, 30, 60) } : {}),
    ...(Object.keys(cues).length ? { cues } : {}),
  }
  return Object.keys(stage).length ? stage : undefined
}

// ---- Normalizing saved direction ---------------------------------------------------------------

const TRANSITION_IDS = new Set(STAGE_TRANSITIONS.map((t) => t.id))
const MAX_CUES = 30
export const MAX_STAGE_LAYOUTS = 30

export function normalizeCue(raw: unknown): StageCue | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const v = raw as Record<string, unknown>
  if (typeof v.x !== 'number' || typeof v.depth !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.depth)) return undefined
  const clamped = clampStagePoint({ x: v.x, depth: v.depth })
  const point = { x: Math.round(clamped.x * 1000) / 1000, depth: Math.round(clamped.depth * 1000) / 1000 }
  const scale = typeof v.scale === 'number' && Number.isFinite(v.scale) ? Math.round(clamp(v.scale, 0.6, 1.4) * 100) / 100 : undefined
  return {
    ...point,
    ...(scale !== undefined && scale !== 1 ? { scale } : {}),
    ...(TRANSITION_IDS.has(v.enter as StageTransition) && v.enter !== 'rise' ? { enter: v.enter as StageTransition } : {}),
    ...(TRANSITION_IDS.has(v.exit as StageTransition) && v.exit !== 'rise' ? { exit: v.exit as StageTransition } : {}),
  }
}

function normalizeCues(raw: unknown): Record<string, StageCue> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const entries = Object.entries(raw as Record<string, unknown>).slice(0, MAX_CUES).flatMap(([id, value]) => {
    const cue = id && id.length <= 100 ? normalizeCue(value) : undefined
    return cue ? [[id, cue] as const] : []
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

const focusOf = (v: unknown): StageFocusStyle | undefined => (v === 'step' || v === 'light' ? v : undefined)
const sized = (v: unknown, min: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(clamp(v, min, max)) : undefined)

/** A scene's direction from a request: known shapes only. Nothing left: undefined, which is automatic. */
export function normalizeSceneStage(raw: unknown): SceneStage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const v = raw as Record<string, unknown>
  const cues = normalizeCues(v.cues)
  const stage: SceneStage = {
    ...(typeof v.layoutId === 'string' && v.layoutId && v.layoutId.length <= 100 ? { layoutId: v.layoutId } : {}),
    ...(sized(v.width, 60, 100) !== undefined ? { width: sized(v.width, 60, 100) } : {}),
    ...(sized(v.depth, 30, 60) !== undefined ? { depth: sized(v.depth, 30, 60) } : {}),
    ...(focusOf(v.focus) ? { focus: focusOf(v.focus) } : {}),
    ...(cues ? { cues } : {}),
  }
  return Object.keys(stage).length ? stage : undefined
}

/** A world's saved layouts: named, unique by id, at most `MAX_STAGE_LAYOUTS`. */
export function normalizeStageLayouts(raw: unknown): StageLayout[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const ids = new Set<string>()
  return raw.slice(0, MAX_STAGE_LAYOUTS).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const v = entry as Record<string, unknown>
    const id = typeof v.id === 'string' ? v.id.trim().slice(0, 100) : ''
    const name = typeof v.name === 'string' ? v.name.trim().slice(0, 60) : ''
    if (!id || !name || ids.has(id)) return []
    ids.add(id)
    return [{
      id,
      name,
      width: sized(v.width, 60, 100) ?? DEFAULT_STAGE_AREA.width,
      depth: sized(v.depth, 30, 60) ?? DEFAULT_STAGE_AREA.depth,
      focus: focusOf(v.focus) ?? 'light',
      cues: normalizeCues(v.cues) ?? {},
      updatedAt: typeof v.updatedAt === 'number' && Number.isFinite(v.updatedAt) ? v.updatedAt : 0,
    }]
  })
}
