import { create } from 'zustand'
import type { HelpTopicId } from './helpContent'

/**
 * Which help surface is open. A store rather than App state so any button (the sidebar's Help,
 * a Settings "Replay tutorial", a command-palette action) can open Help or start the tour with one
 * import and no prop threading. `<TutorialLauncher />` renders whatever this says.
 *
 * Help and the tour never show at once: starting one closes the other.
 */
interface HelpUiState {
  helpOpen: boolean
  helpTopic: HelpTopicId | null
  tourOpen: boolean
  openHelp: (topic?: HelpTopicId) => void
  closeHelp: () => void
  startTour: () => void
  closeTour: () => void
}

export const useHelpStore = create<HelpUiState>((set) => ({
  helpOpen: false,
  helpTopic: null,
  tourOpen: false,
  openHelp: (topic) => set({ helpOpen: true, helpTopic: topic ?? null, tourOpen: false }),
  closeHelp: () => set({ helpOpen: false }),
  startTour: () => set({ tourOpen: true, helpOpen: false }),
  closeTour: () => set({ tourOpen: false }),
}))

/** Opens Help & tutorial, optionally on one topic. Safe to call from anywhere, including outside React. */
export function openHelp(topic?: HelpTopicId) {
  useHelpStore.getState().openHelp(topic)
}

/** Starts (or restarts) the guided tour. */
export function startTour() {
  useHelpStore.getState().startTour()
}
