import type { HelpTopicId } from './helpContent'

/**
 * The guided introduction: a short coach-mark tour over the real UI, plus the pure logic behind it
 * (step bounds, anchor choice, card placement) so it can be tested without a DOM.
 *
 * A step points at an element through `data-tour="<anchor>"`. Anchors are tried in order and the
 * first one that is actually on screen wins; if none is (a play-only control seen from the library,
 * a hidden rail on a phone), the step falls back to a centered card and shows `whereToFind` so the
 * text still makes sense.
 */

export interface TourStep {
  id: string
  title: string
  /** Paragraphs. `**bold**` marks a control label. */
  body: string[]
  /** `data-tour` ids to highlight, in order of preference. */
  anchors?: string[]
  /** Shown only when no anchor could be found: where this control lives. */
  whereToFind?: string
  /** The reference topic that goes deeper, offered from the card. */
  helpTopic?: HelpTopicId
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Lost Tales Engine',
    body: [
      'Play stories with AI characters, in worlds you shape, using the model you bring.',
      'This tour takes about a minute. Press **Esc** or **Skip tour** at any time; you can replay it from **Help & tutorial**.',
    ],
    helpTopic: 'getting-started',
  },
  {
    id: 'menu',
    title: 'The menu',
    body: [
      "Everything is one click away: **Stories** to play; **Cast**, **Worlds**, **Lore** and **Media** in the Studio; **Writer's Room** and **Settings** under Tools.",
      'On a computer, **Expand menu** at the bottom of the rail shows the labels. On a phone, the menu is the bar along the bottom.',
    ],
    anchors: ['nav'],
    whereToFind: 'The menu is on the left on a computer, or along the bottom on a phone. In Visual Novel, expand the right-side scene controls and choose Main menu.',
    helpTopic: 'navigation',
  },
  {
    id: 'stories',
    title: 'Your stories',
    body: [
      '**Stories** is your library. Click a card to continue a story, or use **Start a story** to pick a world, the cast, who you play, and the opening scene.',
      'The ••• button on a card pins, renames, duplicates or deletes it.',
    ],
    anchors: ['nav-stories'],
    whereToFind: 'Stories is the first item in the menu.',
    helpTopic: 'stories',
  },
  {
    id: 'studio',
    title: 'Cast and worlds',
    body: [
      '**Cast** holds your characters, with their sprites, outfits and voices. Any of them can be played by you; the **Player** filter shows the ones you play.',
      '**Worlds** are settings. Each one chooses its modules: story rules, relationships, dating tools, visual novel presentation and world simulation.',
    ],
    anchors: ['nav-cast', 'nav-worlds'],
    whereToFind: 'Cast and Worlds are in the Studio section of the menu.',
    helpTopic: 'cast',
  },
  {
    id: 'composer',
    title: 'Playing a scene',
    body: [
      'Write your turn in the composer and press Enter. With the box empty, Enter asks the character to continue.',
      'Every reply can be swiped, regenerated, steered, pinned, forked or rewound.',
    ],
    anchors: ['composer'],
    whereToFind: 'The composer sits at the bottom of any open story.',
    helpTopic: 'playing',
  },
  {
    id: 'views',
    title: 'Classic or Visual Novel',
    body: [
      'The masks button switches a story between the Classic transcript and the Visual Novel stage, with scene art, sprites and a dialogue box.',
      'In Visual Novel, expand the right-side scene controls for **Auto-advance**, **Skip ahead**, **Hide UI** and **History**.',
    ],
    anchors: ['vn-toggle'],
    whereToFind: 'The masks button is in the Classic header or the Visual Novel side rail.',
    helpTopic: 'visual-novel',
  },
  {
    id: 'story-panel',
    title: 'Story panel and Tools',
    body: [
      '**Story** opens the Story panel: Scene, Scenes, Goals, People, Canon, Notes and Scene Rules.',
      'Expand the Visual Novel side rail for quick tuning, the prompt inspector, the Director and HTML export. Classic keeps these under **Tools**.',
    ],
    anchors: ['story-panel', 'tools-menu'],
    whereToFind: 'Story is in the Classic header or the Visual Novel side rail.',
    helpTopic: 'story-panel',
  },
  {
    id: 'scenes',
    title: 'Scenes and the context meter',
    body: [
      "A story is a chain of short scenes, so it never outgrows the model's context. The meter in the Classic header or expanded Visual Novel side rail shows how full the current scene is, and suggests a break when it gets full or the story moves on.",
      '**End scene…** drafts a recap for you to edit, then sets up the next scene. Every scene is kept in the Story panel\'s **Scenes** tab.',
    ],
    anchors: ['context-meter'],
    whereToFind: 'The context meter is in the header of any open story.',
    helpTopic: 'scenes',
  },
  {
    id: 'play-menu',
    title: 'Getting around while you play',
    body: [
      'In Visual Novel, expand the right-side scene controls and choose **Main menu**. In Classic, **Menu** is in the play header.',
      '**Back to Stories** returns to your library; **Stories** in the menu brings you back to the open story.',
    ],
    anchors: ['play-menu'],
    whereToFind: 'Expand Visual Novel scene controls at the top right, or use the Classic header.',
    helpTopic: 'navigation',
  },
  {
    id: 'help',
    title: 'Help is always here',
    body: [
      '**Help & tutorial** in the menu has a searchable guide to every part of the app, including optional systems like campaign rolls, world simulation and dating. You can replay this tour from there.',
      'Press **Ctrl/Cmd K** to jump anywhere, and **?** for keyboard shortcuts.',
    ],
    anchors: ['nav-help'],
    whereToFind: 'Help & tutorial is in the menu.',
    helpTopic: 'getting-started',
  },
]

// ---------------------------------------------------------------------------------------------
// Step bounds
// ---------------------------------------------------------------------------------------------

export function clampStepIndex(index: number, total: number): number {
  if (total <= 0 || !Number.isFinite(index)) return 0
  return Math.min(Math.max(Math.trunc(index), 0), total - 1)
}

export function nextStepIndex(index: number, total: number): number {
  return clampStepIndex(index + 1, total)
}

export function previousStepIndex(index: number, total: number): number {
  return clampStepIndex(index - 1, total)
}

export function isFirstStep(index: number): boolean {
  return index <= 0
}

export function isLastStep(index: number, total: number): boolean {
  return total <= 0 || index >= total - 1
}

export function stepCounterLabel(index: number, total: number): string {
  return `Step ${clampStepIndex(index, total) + 1} of ${Math.max(total, 1)}`
}

export type TourAction = 'next' | 'back' | 'skip' | 'finish'

export type TourTransition = { kind: 'step'; index: number } | { kind: 'close'; outcome: 'completed' | 'skipped' }

/** What a button or key press does. "Next" on the last step finishes; "Back" on the first stays put. */
export function tourTransition(index: number, total: number, action: TourAction): TourTransition {
  switch (action) {
    case 'skip':
      return { kind: 'close', outcome: 'skipped' }
    case 'finish':
      return { kind: 'close', outcome: 'completed' }
    case 'next':
      return isLastStep(index, total) ? { kind: 'close', outcome: 'completed' } : { kind: 'step', index: nextStepIndex(index, total) }
    case 'back':
      return { kind: 'step', index: previousStepIndex(index, total) }
  }
}

// ---------------------------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------------------------

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

const ANCHOR_ID = /^[a-z0-9][a-z0-9-]*$/

/** The attribute selector for an anchor id, or null for an id that isn't a plain slug. */
export function tourAnchorSelector(id: string): string | null {
  return ANCHOR_ID.test(id) ? `[data-tour="${id}"]` : null
}

export function hasArea(rect: Rect | null | undefined): rect is Rect {
  return !!rect && rect.width > 0 && rect.height > 0
}

export function intersectsViewport(rect: Rect, viewport: Size): boolean {
  return rect.left < viewport.width && rect.top < viewport.height && rect.left + rect.width > 0 && rect.top + rect.height > 0
}

/**
 * The first anchor that is present, has a size, and is at least partly on screen — or null, which
 * means "use the centered card". `measure` returns null when an anchor isn't in the page.
 */
export function pickAnchor(
  anchors: readonly string[] | undefined,
  measure: (id: string) => Rect | null,
  viewport: Size,
): { id: string; rect: Rect } | null {
  for (const id of anchors ?? []) {
    const rect = measure(id)
    if (hasArea(rect) && intersectsViewport(rect, viewport)) return { id, rect }
  }
  return null
}

/** The smallest rect covering all of these (for a `display: contents` wrapper, measured by its children). */
export function unionRects(rects: readonly Rect[]): Rect | null {
  const real = rects.filter(hasArea)
  if (real.length === 0) return null
  const top = Math.min(...real.map((r) => r.top))
  const left = Math.min(...real.map((r) => r.left))
  const bottom = Math.max(...real.map((r) => r.top + r.height))
  const right = Math.max(...real.map((r) => r.left + r.width))
  return { top, left, width: right - left, height: bottom - top }
}

/** The highlight ring: the anchor plus padding, kept inside the viewport so it never causes scroll. */
export function spotlightRect(rect: Rect, viewport: Size, padding = 6): Rect {
  const left = Math.max(2, rect.left - padding)
  const top = Math.max(2, rect.top - padding)
  const right = Math.min(viewport.width - 2, rect.left + rect.width + padding)
  const bottom = Math.min(viewport.height - 2, rect.top + rect.height + padding)
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

// ---------------------------------------------------------------------------------------------
// Card placement
// ---------------------------------------------------------------------------------------------

export type CardSide = 'right' | 'left' | 'bottom' | 'top'

export type CardPlacement =
  | { mode: 'centered' }
  /** Phones: a full-width sheet on whichever edge is away from the highlighted control. */
  | { mode: 'sheet'; edge: 'top' | 'bottom' }
  | { mode: 'anchored'; side: CardSide; top: number; left: number }

export interface PlacementInput {
  anchor: Rect | null
  viewport: Size
  card: Size
  /** Narrow screens get a sheet instead of a floating card. */
  mobile: boolean
  gap?: number
  margin?: number
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

export function computeCardPlacement({ anchor, viewport, card, mobile, gap = 14, margin = 16 }: PlacementInput): CardPlacement {
  if (mobile) {
    if (!anchor) return { mode: 'sheet', edge: 'bottom' }
    const anchorCenter = anchor.top + anchor.height / 2
    return { mode: 'sheet', edge: anchorCenter > viewport.height / 2 ? 'top' : 'bottom' }
  }
  if (!anchor) return { mode: 'centered' }

  const space: Record<CardSide, number> = {
    right: viewport.width - (anchor.left + anchor.width) - gap - margin,
    left: anchor.left - gap - margin,
    bottom: viewport.height - (anchor.top + anchor.height) - gap - margin,
    top: anchor.top - gap - margin,
  }
  const fits: Record<CardSide, boolean> = {
    right: space.right >= card.width,
    left: space.left >= card.width,
    bottom: space.bottom >= card.height,
    top: space.top >= card.height,
  }
  // Beside a tall thing (the rail), below/above a wide thing (a header control).
  const order: CardSide[] = anchor.height > anchor.width ? ['right', 'left', 'bottom', 'top'] : ['bottom', 'top', 'right', 'left']
  const side =
    order.find((candidate) => fits[candidate]) ??
    order.reduce((best, candidate) => {
      const ratio = (s: CardSide) => space[s] / (s === 'left' || s === 'right' ? card.width : card.height)
      return ratio(candidate) > ratio(best) ? candidate : best
    }, order[0])

  const maxLeft = viewport.width - card.width - margin
  const maxTop = viewport.height - card.height - margin
  const centeredLeft = anchor.left + anchor.width / 2 - card.width / 2
  const centeredTop = anchor.top + anchor.height / 2 - card.height / 2
  switch (side) {
    case 'right':
      return { mode: 'anchored', side, left: clamp(anchor.left + anchor.width + gap, margin, maxLeft), top: clamp(centeredTop, margin, maxTop) }
    case 'left':
      return { mode: 'anchored', side, left: clamp(anchor.left - gap - card.width, margin, maxLeft), top: clamp(centeredTop, margin, maxTop) }
    case 'bottom':
      return { mode: 'anchored', side, left: clamp(centeredLeft, margin, maxLeft), top: clamp(anchor.top + anchor.height + gap, margin, maxTop) }
    case 'top':
      return { mode: 'anchored', side, left: clamp(centeredLeft, margin, maxLeft), top: clamp(anchor.top - gap - card.height, margin, maxTop) }
  }
}
