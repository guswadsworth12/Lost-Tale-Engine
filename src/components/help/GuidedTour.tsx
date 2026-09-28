import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import { useVnChromeClass } from '@/lib/store/useVnChromeStore'
import type { HelpTopicId } from '@/lib/help/helpContent'
import { tutorialStore } from '@/lib/help/tutorialState'
import { usePrefersReducedMotion, useMediaQuery } from '@/lib/help/useMediaQuery'
import {
  TOUR_STEPS,
  clampStepIndex,
  computeCardPlacement,
  hasArea,
  intersectsViewport,
  isFirstStep,
  isLastStep,
  pickAnchor,
  spotlightRect,
  stepCounterLabel,
  tourAnchorSelector,
  tourTransition,
  unionRects,
  type CardPlacement,
  type Rect,
  type Size,
  type TourAction,
  type TourStep,
} from '@/lib/help/tourSteps'
import { HelpText } from './HelpText'

export type TourOutcome = 'completed' | 'skipped'

export interface GuidedTourProps {
  open: boolean
  /** Called once when the tour ends: finished (last step's Finish) or skipped (Skip tour / Esc). */
  onClose: (outcome: TourOutcome) => void
  /** Enables the last step's "Open Help & tutorial" button. Called right after `onClose('completed')`. */
  onOpenHelp?: (topic?: HelpTopicId) => void
  /** Defaults to the built-in introduction. */
  steps?: readonly TourStep[]
  /** Save the outcome to tutorial state so the first-run offer stops showing. Default true. */
  recordOutcome?: boolean
}

/**
 * The guided introduction: a coach-mark card over the real UI, highlighting each step's
 * `data-tour` anchor when it's on screen and falling back to a centered card (a bottom or top sheet
 * on phones) when it isn't. Modal while open: focus is trapped in the card and restored on close.
 */
export function GuidedTour(props: GuidedTourProps) {
  if (!props.open || typeof document === 'undefined') return null
  // Mounted fresh on every open, so each run starts at step 1.
  return createPortal(<TourOverlay {...props} />, document.body)
}

const MOBILE_QUERY = '(max-width: 639px)'

function readViewport(): Size {
  if (typeof window === 'undefined') return { width: 1024, height: 768 }
  return { width: window.innerWidth, height: window.innerHeight }
}

function toRect(r: DOMRect): Rect {
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

/** An element's box; a `display: contents` wrapper has none of its own, so measure its children. */
function elementRect(element: Element): Rect | null {
  const own = toRect(element.getBoundingClientRect())
  if (hasArea(own)) {
    return window.getComputedStyle(element).visibility === 'hidden' ? null : own
  }
  if (window.getComputedStyle(element).display !== 'contents') return null
  return unionRects(Array.from(element.children).map((child) => toRect(child.getBoundingClientRect())))
}

/** The best element for an anchor id: the first one on screen, else the first one with any size. */
function findAnchor(id: string, viewport: Size): { element: Element; rect: Rect } | null {
  const selector = tourAnchorSelector(id)
  if (!selector) return null
  let fallback: { element: Element; rect: Rect } | null = null
  for (const element of Array.from(document.querySelectorAll(selector))) {
    const rect = elementRect(element)
    if (!rect) continue
    if (intersectsViewport(rect, viewport)) return { element, rect }
    fallback ??= { element, rect }
  }
  return fallback
}

const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b ||
  (!!a && !!b && Math.abs(a.top - b.top) < 0.5 && Math.abs(a.left - b.left) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5)

const WRAPPER_CLASS: Record<CardPlacement['mode'] | 'sheet-top', string> = {
  centered: 'pointer-events-none fixed inset-0 flex items-center justify-center p-4',
  anchored: 'pointer-events-none fixed inset-0',
  sheet: 'pointer-events-none fixed inset-0 flex flex-col justify-end',
  'sheet-top': 'pointer-events-none fixed inset-0 flex flex-col justify-start',
}

function TourOverlay({ onClose, onOpenHelp, steps = TOUR_STEPS, recordOutcome = true }: GuidedTourProps) {
  const total = steps.length
  const [index, setIndex] = useState(0)
  const current = clampStepIndex(index, total)
  const step = steps[current]
  const first = isFirstStep(current)
  const last = isLastStep(current, total)

  const mobile = useMediaQuery(MOBILE_QUERY)
  const reducedMotion = usePrefersReducedMotion()
  const vnChrome = useVnChromeClass()
  const titleId = useId()
  const bodyId = useId()

  const cardRef = useRef<HTMLDivElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const [viewport, setViewport] = useState<Size>(readViewport)
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null)
  const [cardSize, setCardSize] = useState<Size>({ width: 352, height: 240 })

  // Trap + restore focus (shared with Modal), then land on the primary action rather than "Skip".
  useFocusTrap(cardRef, true)
  useEffect(() => {
    primaryRef.current?.focus({ preventScroll: true })
  }, [])
  // Back on step 1 becomes disabled and drops focus; keep it in the card.
  useEffect(() => {
    const card = cardRef.current
    if (card && !card.contains(document.activeElement)) primaryRef.current?.focus({ preventScroll: true })
  }, [current])

  const closedRef = useRef(false)
  const close = useCallback(
    (outcome: TourOutcome) => {
      if (closedRef.current) return
      closedRef.current = true
      if (recordOutcome) {
        if (outcome === 'completed') tutorialStore.markIntroDone()
        else tutorialStore.markIntroSkipped()
      }
      onClose(outcome)
    },
    [onClose, recordOutcome],
  )

  const act = useCallback(
    (action: TourAction) => {
      const transition = tourTransition(current, total, action)
      if (transition.kind === 'close') close(transition.outcome)
      else setIndex(transition.index)
    },
    [close, current, total],
  )

  const finishAndOpenHelp = () => {
    close('completed')
    onOpenHelp?.(step.helpTopic)
  }

  // Keyboard, at the window's capture phase so it works wherever focus is, and so the app's own
  // shortcuts (? sheet, Ctrl/Cmd-K, arrow-key swipes in a story) don't fire underneath the tour.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const block = () => {
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
      }
      if (event.key === 'Escape') {
        block()
        act('skip')
      } else if (event.key === 'ArrowRight' && !event.altKey && !event.metaKey && !event.ctrlKey) {
        block()
        if (!last) act('next')
      } else if (event.key === 'ArrowLeft' && !event.altKey && !event.metaKey && !event.ctrlKey) {
        block()
        act('back')
      } else if (event.key === '?' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
        block()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [act, last])

  const measure = useCallback(() => {
    const vp = readViewport()
    setViewport((prev) => (prev.width === vp.width && prev.height === vp.height ? prev : vp))
    const picked = pickAnchor(step.anchors, (id) => findAnchor(id, vp)?.rect ?? null, vp)
    const next = picked?.rect ?? null
    setAnchorRect((prev) => (sameRect(prev, next) ? prev : next))
  }, [step])

  // On each step: bring the anchor into view if it's off screen, then measure.
  useLayoutEffect(() => {
    const vp = readViewport()
    for (const id of step.anchors ?? []) {
      const found = findAnchor(id, vp)
      if (!found) continue
      const { rect, element } = found
      const fullyVisible = rect.top >= 0 && rect.left >= 0 && rect.top + rect.height <= vp.height && rect.left + rect.width <= vp.width
      if (!fullyVisible) element.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' })
      break
    }
    measure()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  // Follow the anchor through resizes, scrolling, and layout changes nothing announces (a rail
  // collapsing, a panel opening). The interval is one querySelector and one rect per tick.
  useEffect(() => {
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    const interval = window.setInterval(schedule, 400)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, { capture: true })
      window.clearInterval(interval)
    }
  }, [measure])

  // The card's own size feeds its placement; only store it when it actually changed.
  useLayoutEffect(() => {
    const card = cardRef.current
    if (!card) return
    const next = { width: card.offsetWidth, height: card.offsetHeight }
    setCardSize((prev) => (Math.abs(prev.width - next.width) < 1 && Math.abs(prev.height - next.height) < 1 ? prev : next))
  })

  const placement = computeCardPlacement({ anchor: anchorRect, viewport, card: cardSize, mobile })
  const spot = anchorRect ? spotlightRect(anchorRect, viewport) : null
  const wrapperKey = placement.mode === 'sheet' && placement.edge === 'top' ? 'sheet-top' : placement.mode

  const cardShape =
    placement.mode === 'sheet'
      ? `w-full max-h-[60vh] overflow-y-auto border-x-0 px-4 pt-4 ${
          placement.edge === 'bottom'
            ? 'rounded-t-2xl border-b-0 pb-[max(1rem,env(safe-area-inset-bottom))]'
            : 'rounded-b-2xl border-t-0 pb-4 pt-[max(1rem,env(safe-area-inset-top))]'
        }`
      : placement.mode === 'anchored'
        ? 'absolute w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-5'
        : 'w-[min(26rem,calc(100vw-2rem))] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl p-5 sm:p-6'
  const cardStyle =
    placement.mode === 'anchored'
      ? {
          top: placement.top,
          left: placement.left,
          transition: reducedMotion ? undefined : 'top 180ms ease, left 180ms ease',
        }
      : undefined

  const blockBackdrop = (event: MouseEvent<HTMLDivElement>) => {
    // A click outside the card does nothing, and mustn't pull focus out of it either.
    if (!cardRef.current?.contains(event.target as Node)) event.preventDefault()
  }

  const counter = stepCounterLabel(current, total)

  return (
    <div className="fixed inset-0 z-[70]" onMouseDown={blockBackdrop}>
      {spot ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-xl ring-2 ring-accent"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)',
            transition: reducedMotion ? undefined : 'top 180ms ease, left 180ms ease, width 180ms ease, height 180ms ease',
          }}
        />
      ) : (
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-black/55" />
      )}

      <div className={WRAPPER_CLASS[wrapperKey]}>
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          tabIndex={-1}
          style={cardStyle}
          className={`pointer-events-auto border border-border bg-bg-elevated text-text themed-shadow outline-none ${
            reducedMotion ? '' : 'animate-panel-in'
          } ${vnChrome} ${cardShape}`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-accent">{counter}</span>
            <button
              type="button"
              onClick={() => act('skip')}
              className="rounded-lg px-2 py-1 text-xs text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
            >
              Skip tour
            </button>
          </div>

          <h2 id={titleId} className="mt-2 font-display text-lg text-text">
            {step.title}
          </h2>
          <div id={bodyId} className="mt-2 space-y-2 text-sm leading-relaxed text-text-muted">
            {step.body.map((paragraph, i) => (
              <p key={i}>
                <HelpText text={paragraph} />
              </p>
            ))}
            {!anchorRect && !!step.anchors?.length && step.whereToFind && (
              <p className="rounded-lg bg-bg-sunken px-3 py-2 text-xs">{step.whereToFind}</p>
            )}
          </div>

          <div className="mt-4 flex items-center gap-1" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full ${i === current ? 'w-4 bg-accent' : i < current ? 'w-1.5 bg-accent/50' : 'w-1.5 bg-border'}`}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => act('back')}
              disabled={first}
              className="mr-auto inline-flex items-center gap-1"
            >
              <ArrowLeft size={14} strokeWidth={2} />
              Back
            </Button>
            {last && onOpenHelp && (
              <Button variant="secondary" onClick={finishAndOpenHelp} className="inline-flex items-center gap-1.5">
                <BookOpen size={14} strokeWidth={2} />
                Open Help &amp; tutorial
              </Button>
            )}
            <Button ref={primaryRef} variant="primary" onClick={() => act(last ? 'finish' : 'next')} className="inline-flex items-center gap-1">
              {last ? (
                'Finish'
              ) : (
                <>
                  Next
                  <ArrowRight size={14} strokeWidth={2} />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {`${counter}: ${step.title}`}
      </p>
    </div>
  )
}
