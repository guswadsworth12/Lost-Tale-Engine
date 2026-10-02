/**
 * The setup wizard's steps (#40): what each one sets up, whether it's needed, and whether it's done.
 * Pure, so the wizard, the Get set up checklist and the first-run decision all read the same rules.
 *
 * A step is done when what it sets up already exists (a Text model that works, a Voice model), not
 * when it was clicked through, so the checklist stays true however a thing got set up. Progress
 * (`SetupProgress`) only records what the wizard itself can't see: whether it was finished or put
 * off, which optional steps were skipped, and which models have answered a test. It lives in the
 * account's synced settings.
 */

/** Bump when the steps change enough that someone who finished should see what's new. */
export const SETUP_VERSION = 1

export type SetupStepId = 'welcome' | 'text' | 'voice' | 'images' | 'story'

export interface SetupProgress {
  version: number
  /** `new`: never opened. `active`: under way. `done`: finished. `dismissed`: put off, checklist only. */
  status: 'new' | 'active' | 'done' | 'dismissed'
  /** Optional steps passed over on purpose: no longer "to do", still reachable. */
  skipped: SetupStepId[]
  /** When it was finished or put off. */
  at?: number
  /** The Text and Voice models that answered a test (`verifiedKey`): a model only counts as set up once it has. */
  verified?: Partial<Record<'text' | 'voice', string>>
}

/** What a passed test is recorded against: the exact service and model, so changing either asks for a new test. */
export function verifiedKey(choice: { serviceId: string; model: string }): string {
  return `${choice.serviceId}:${choice.model}`
}

export const NEW_SETUP: SetupProgress = { version: SETUP_VERSION, status: 'new', skipped: [] }

/** What the steps are checked against. */
export interface SetupFacts {
  /** A Text model is chosen, its service has what it needs (an address, a key), and it has answered a test (or a story has been played). */
  textReady: boolean
  voiceReady: boolean
  imagesReady: boolean
  /** Any story exists. */
  hasStory: boolean
}

export interface SetupStep {
  id: SetupStepId
  title: string
  /** One line for the checklist. */
  summary: string
  /** Optional steps can be skipped; required ones can only be put off. */
  optional: boolean
  /** Shown in the checklist (the welcome isn't something to do). */
  listed: boolean
  done: (facts: SetupFacts) => boolean
}

export const SETUP_STEPS: SetupStep[] = [
  { id: 'welcome', title: 'Welcome', summary: 'What this sets up.', optional: false, listed: false, done: () => false },
  { id: 'text', title: 'Text model', summary: 'The model that writes every reply.', optional: false, listed: true, done: (f) => f.textReady },
  { id: 'voice', title: 'Voice', summary: 'Read lines aloud. Free voices work with no account.', optional: true, listed: true, done: (f) => f.voiceReady },
  { id: 'images', title: 'Images', summary: 'Picture this, and character art.', optional: true, listed: true, done: (f) => f.imagesReady },
  { id: 'story', title: 'First story', summary: 'Start playing.', optional: false, listed: true, done: (f) => f.hasStory },
]

export type StepState = 'done' | 'skipped' | 'todo'

export function stepState(step: SetupStep, facts: SetupFacts, progress: SetupProgress): StepState {
  if (step.done(facts)) return 'done'
  return step.optional && progress.skipped.includes(step.id) ? 'skipped' : 'todo'
}

/** The checklist: every listed step and its state. */
export function checklist(facts: SetupFacts, progress: SetupProgress): { step: SetupStep; state: StepState }[] {
  return SETUP_STEPS.filter((step) => step.listed).map((step) => ({ step, state: stepState(step, facts, progress) }))
}

/** How many listed steps are still to do. */
export function remaining(facts: SetupFacts, progress: SetupProgress): number {
  return checklist(facts, progress).filter((item) => item.state === 'todo').length
}

/**
 * Whether the full-screen wizard opens by itself: only for an account that has never finished or
 * put it off, and has no stories yet. Anyone already playing gets the checklist instead.
 */
export function shouldShowWizard(progress: SetupProgress | undefined, storyCount: number): boolean {
  const status = (progress ?? NEW_SETUP).status
  return storyCount === 0 && (status === 'new' || status === 'active')
}

/** The step after `id`, or undefined at the end. */
export function nextStep(id: SetupStepId): SetupStepId | undefined {
  const index = SETUP_STEPS.findIndex((step) => step.id === id)
  return SETUP_STEPS[index + 1]?.id
}

export function previousStep(id: SetupStepId): SetupStepId | undefined {
  const index = SETUP_STEPS.findIndex((step) => step.id === id)
  return index > 0 ? SETUP_STEPS[index - 1].id : undefined
}

/** Where to pick up: the first listed step still to do, else the last. */
export function resumeStep(facts: SetupFacts, progress: SetupProgress): SetupStepId {
  if (progress.status === 'new') return 'welcome'
  return checklist(facts, progress).find((item) => item.state === 'todo')?.step.id ?? 'story'
}

/** Progress with one optional step skipped (or un-skipped once it's done another way). */
export function withSkipped(progress: SetupProgress, id: SetupStepId, skipped: boolean): SetupProgress {
  const rest = progress.skipped.filter((s) => s !== id)
  return { ...progress, skipped: skipped ? [...rest, id] : rest }
}
