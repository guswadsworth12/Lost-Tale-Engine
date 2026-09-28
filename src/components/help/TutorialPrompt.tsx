import { useId } from 'react'
import { Route, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useTutorialState } from '@/lib/help/tutorialState'

export interface TutorialPromptProps {
  /** Starts the guided tour. */
  onStart: () => void
  /** Hide without recording anything, e.g. while a story is being played or Help is open. */
  hidden?: boolean
}

/**
 * The first-run offer: a small, dismissible card, never a forced tour. It shows until the intro is
 * finished or skipped (or "Not now" is pressed) and stays gone after that; Help & tutorial can
 * always replay the tour. Deliberately doesn't take focus — it's an offer, not a dialog.
 */
export function TutorialPrompt({ onStart, hidden }: TutorialPromptProps) {
  const { shouldOfferIntro, markIntroSkipped } = useTutorialState()
  const titleId = useId()
  if (hidden || !shouldOfferIntro) return null

  return (
    <section
      aria-labelledby={titleId}
      // Above the phone's bottom nav bar (≈56px), bottom-right on wider screens.
      className="animate-toast-in fixed inset-x-3 bottom-[4.5rem] z-40 rounded-2xl border border-border bg-bg-elevated p-4 themed-shadow sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-80"
    >
      <button
        type="button"
        onClick={markIntroSkipped}
        aria-label="Dismiss tour offer"
        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
      >
        <X size={14} strokeWidth={2} />
      </button>
      <div className="flex items-start gap-3 pr-6">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Route size={16} strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="text-sm font-semibold text-text">
            New here?
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-text-muted">
            Take a one-minute tour of the app. You can replay it any time from Help &amp; tutorial.
          </p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={markIntroSkipped}>
          Not now
        </Button>
        <Button variant="primary" onClick={onStart}>
          Take the tour
        </Button>
      </div>
    </section>
  )
}
