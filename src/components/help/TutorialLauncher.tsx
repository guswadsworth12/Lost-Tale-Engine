import { useHelpStore } from '@/lib/help/helpStore'
import { GuidedTour } from './GuidedTour'
import { HelpCenter } from './HelpCenter'
import { TutorialPrompt } from './TutorialPrompt'

export interface TutorialLauncherProps {
  /** Keep the first-run offer out of the way (e.g. while a story is being played). Help and the tour still open. */
  suppressPrompt?: boolean
}

/**
 * Mount once, near the root. Renders Help & tutorial, the guided tour and the first-run offer,
 * driven by `useHelpStore`; open them from anywhere with `openHelp(topic?)` / `startTour()` from
 * `@/lib/help/helpStore`.
 */
export function TutorialLauncher({ suppressPrompt }: TutorialLauncherProps) {
  const helpOpen = useHelpStore((s) => s.helpOpen)
  const helpTopic = useHelpStore((s) => s.helpTopic)
  const tourOpen = useHelpStore((s) => s.tourOpen)
  const openHelp = useHelpStore((s) => s.openHelp)
  const closeHelp = useHelpStore((s) => s.closeHelp)
  const startTour = useHelpStore((s) => s.startTour)
  const closeTour = useHelpStore((s) => s.closeTour)

  return (
    <>
      <HelpCenter open={helpOpen} onClose={closeHelp} initialTopic={helpTopic ?? undefined} onStartTour={startTour} />
      <GuidedTour open={tourOpen} onClose={closeTour} onOpenHelp={(topic) => openHelp(topic)} />
      <TutorialPrompt hidden={suppressPrompt || helpOpen || tourOpen} onStart={startTour} />
    </>
  )
}
