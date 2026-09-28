import { BookOpen, Route } from 'lucide-react'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { openHelp, startTour } from '@/lib/help/helpStore'
import { useTutorialState } from '@/lib/help/tutorialState'

/**
 * A drop-in Settings block: replay the tour, open the reference, or bring back the first-run offer.
 * Works with `<TutorialLauncher />` mounted anywhere in the app.
 */
export function TutorialSettingsSection() {
  const { state, shouldOfferIntro, reset } = useTutorialState()
  const status = shouldOfferIntro
    ? 'The tour will be offered next time the app opens.'
    : state?.intro === 'completed'
      ? 'You finished the tour.'
      : 'You skipped the tour.'

  return (
    <Section title="Help & tutorial" description="The guided tour and the full reference to every part of the app.">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={startTour} className="inline-flex items-center gap-1.5">
          <Route size={14} strokeWidth={2} />
          Replay tutorial
        </Button>
        <Button onClick={() => openHelp()} className="inline-flex items-center gap-1.5">
          <BookOpen size={14} strokeWidth={2} />
          Open Help &amp; tutorial
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted">
        <span>{status}</span>
        {!shouldOfferIntro && (
          <button type="button" onClick={reset} className="text-accent hover:underline">
            Offer it again on startup
          </button>
        )}
      </div>
    </Section>
  )
}
