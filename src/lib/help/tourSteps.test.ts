import { describe, expect, it } from 'vitest'
import {
  TOUR_STEPS,
  clampStepIndex,
  computeCardPlacement,
  intersectsViewport,
  isFirstStep,
  isLastStep,
  nextStepIndex,
  pickAnchor,
  previousStepIndex,
  spotlightRect,
  stepCounterLabel,
  tourAnchorSelector,
  tourTransition,
  unionRects,
  type Rect,
} from './tourSteps'

const viewport = { width: 1280, height: 800 }
const phone = { width: 375, height: 812 }

describe('tour steps', () => {
  it('is a short introduction with unique ids', () => {
    expect(TOUR_STEPS.length).toBeGreaterThanOrEqual(6)
    expect(TOUR_STEPS.length).toBeLessThanOrEqual(10)
    const ids = TOUR_STEPS.map((step) => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const step of TOUR_STEPS) {
      expect(step.title.trim()).not.toBe('')
      expect(step.body.length).toBeGreaterThan(0)
      for (const anchor of step.anchors ?? []) expect(tourAnchorSelector(anchor)).not.toBeNull()
      // A step that can lose its anchor has to say where the control lives.
      if (step.anchors?.length) expect(step.whereToFind).toBeTruthy()
    }
  })

  it('ends by pointing at Help & tutorial', () => {
    const last = TOUR_STEPS[TOUR_STEPS.length - 1]
    expect(last.anchors).toContain('nav-help')
    expect(last.body.join(' ')).toContain('Help & tutorial')
  })

  it('uses the anchors the app provides', () => {
    const known = new Set(['nav', 'nav-stories', 'nav-cast', 'nav-worlds', 'nav-lore', 'nav-media', 'nav-writer', 'nav-settings', 'nav-help', 'play-menu', 'story-panel', 'tools-menu', 'vn-toggle', 'composer', 'context-meter'])
    for (const step of TOUR_STEPS) for (const anchor of step.anchors ?? []) expect(known.has(anchor), anchor).toBe(true)
  })
})

describe('step bounds', () => {
  it('clamps next and back to the ends', () => {
    expect(nextStepIndex(0, 3)).toBe(1)
    expect(nextStepIndex(2, 3)).toBe(2)
    expect(previousStepIndex(0, 3)).toBe(0)
    expect(previousStepIndex(2, 3)).toBe(1)
    expect(clampStepIndex(99, 3)).toBe(2)
    expect(clampStepIndex(-4, 3)).toBe(0)
    expect(clampStepIndex(Number.NaN, 3)).toBe(0)
    expect(clampStepIndex(1, 0)).toBe(0)
  })

  it('knows the first and last steps', () => {
    expect(isFirstStep(0)).toBe(true)
    expect(isFirstStep(1)).toBe(false)
    expect(isLastStep(2, 3)).toBe(true)
    expect(isLastStep(1, 3)).toBe(false)
    expect(isLastStep(0, 0)).toBe(true)
  })

  it('labels the counter from 1', () => {
    expect(stepCounterLabel(0, 8)).toBe('Step 1 of 8')
    expect(stepCounterLabel(7, 8)).toBe('Step 8 of 8')
  })

  it('maps actions to transitions', () => {
    expect(tourTransition(0, 3, 'next')).toEqual({ kind: 'step', index: 1 })
    expect(tourTransition(2, 3, 'next')).toEqual({ kind: 'close', outcome: 'completed' })
    expect(tourTransition(0, 3, 'back')).toEqual({ kind: 'step', index: 0 })
    expect(tourTransition(1, 3, 'skip')).toEqual({ kind: 'close', outcome: 'skipped' })
    expect(tourTransition(1, 3, 'finish')).toEqual({ kind: 'close', outcome: 'completed' })
  })
})

describe('anchors', () => {
  const rect = (top: number, left: number, width: number, height: number): Rect => ({ top, left, width, height })

  it('builds selectors only for plain ids', () => {
    expect(tourAnchorSelector('nav-help')).toBe('[data-tour="nav-help"]')
    expect(tourAnchorSelector('a"] , body [x="')).toBeNull()
    expect(tourAnchorSelector('')).toBeNull()
  })

  it('falls back to null (centered card) when no anchor is usable', () => {
    expect(pickAnchor(undefined, () => rect(0, 0, 10, 10), viewport)).toBeNull()
    expect(pickAnchor(['missing'], () => null, viewport)).toBeNull()
    // Present but hidden (zero size), or entirely off screen.
    expect(pickAnchor(['hidden'], () => rect(10, 10, 0, 0), viewport)).toBeNull()
    expect(pickAnchor(['offscreen'], () => rect(900, 10, 40, 40), viewport)).toBeNull()
  })

  it('takes the first usable anchor in order', () => {
    const rects: Record<string, Rect | null> = { 'story-panel': null, 'tools-menu': rect(10, 900, 60, 30), composer: rect(700, 300, 500, 60) }
    expect(pickAnchor(['story-panel', 'tools-menu', 'composer'], (id) => rects[id] ?? null, viewport)).toEqual({
      id: 'tools-menu',
      rect: rects['tools-menu'],
    })
  })

  it('checks the viewport edges', () => {
    expect(intersectsViewport(rect(-20, 0, 40, 30), viewport)).toBe(true)
    expect(intersectsViewport(rect(-40, 0, 40, 30), viewport)).toBe(false)
    expect(intersectsViewport(rect(0, 1280, 40, 30), viewport)).toBe(false)
  })

  it('unions child rects for a display: contents wrapper', () => {
    expect(unionRects([rect(10, 10, 20, 20), rect(0, 40, 10, 10), rect(0, 0, 0, 0)])).toEqual(rect(0, 10, 40, 30))
    expect(unionRects([])).toBeNull()
  })

  it('keeps the spotlight inside the viewport', () => {
    const spot = spotlightRect(rect(0, 0, 56, 800), viewport)
    expect(spot.left).toBeGreaterThanOrEqual(0)
    expect(spot.top).toBeGreaterThanOrEqual(0)
    expect(spot.top + spot.height).toBeLessThanOrEqual(viewport.height)
    const wide = spotlightRect(rect(700, 0, 375, 60), phone)
    expect(wide.left + wide.width).toBeLessThanOrEqual(phone.width)
  })
})

describe('computeCardPlacement', () => {
  const card = { width: 352, height: 240 }

  it('centers the card when there is no anchor', () => {
    expect(computeCardPlacement({ anchor: null, viewport, card, mobile: false })).toEqual({ mode: 'centered' })
  })

  it('uses a bottom sheet on phones, flipping to the top when the anchor is low', () => {
    expect(computeCardPlacement({ anchor: null, viewport: phone, card, mobile: true })).toEqual({ mode: 'sheet', edge: 'bottom' })
    expect(computeCardPlacement({ anchor: { top: 20, left: 10, width: 40, height: 30 }, viewport: phone, card, mobile: true })).toEqual({
      mode: 'sheet',
      edge: 'bottom',
    })
    // The bottom nav bar: the sheet must not cover it.
    expect(computeCardPlacement({ anchor: { top: 756, left: 0, width: 375, height: 56 }, viewport: phone, card, mobile: true })).toEqual({
      mode: 'sheet',
      edge: 'top',
    })
  })

  it('sits beside a tall anchor such as the rail', () => {
    const placement = computeCardPlacement({ anchor: { top: 0, left: 0, width: 56, height: 800 }, viewport, card, mobile: false })
    expect(placement).toMatchObject({ mode: 'anchored', side: 'right' })
    if (placement.mode === 'anchored') expect(placement.left).toBeGreaterThanOrEqual(56)
  })

  it('sits below a header control and stays on screen', () => {
    const placement = computeCardPlacement({ anchor: { top: 12, left: 1200, width: 34, height: 34 }, viewport, card, mobile: false })
    expect(placement).toMatchObject({ mode: 'anchored', side: 'bottom' })
    if (placement.mode === 'anchored') {
      expect(placement.left + card.width).toBeLessThanOrEqual(viewport.width - 16)
      expect(placement.top).toBeGreaterThan(12 + 34)
    }
  })

  it('goes above an anchor at the bottom of the screen', () => {
    const placement = computeCardPlacement({ anchor: { top: 720, left: 300, width: 600, height: 60 }, viewport, card, mobile: false })
    expect(placement).toMatchObject({ mode: 'anchored', side: 'top' })
    if (placement.mode === 'anchored') expect(placement.top + card.height).toBeLessThanOrEqual(720)
  })

  it('still clamps into the viewport when nothing fits', () => {
    const tiny = { width: 400, height: 300 }
    const placement = computeCardPlacement({ anchor: { top: 100, left: 100, width: 200, height: 100 }, viewport: tiny, card, mobile: false })
    expect(placement.mode).toBe('anchored')
    if (placement.mode === 'anchored') {
      expect(placement.left).toBeGreaterThanOrEqual(16)
      expect(placement.top).toBeGreaterThanOrEqual(16)
    }
  })
})
