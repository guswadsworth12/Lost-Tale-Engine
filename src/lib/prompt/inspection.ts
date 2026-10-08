import type { MemoryKind } from '@/lib/types'
import type { MemoryReasons } from '@/lib/memory/rank'
import type { PromptBuildResult } from './builder'

/** One memory that reached the inspected speaker's prompt, and why. */
export interface InspectedMemoryPick {
  id: string
  text: string
  kind: MemoryKind
  reasons: MemoryReasons
  /** `reasons.aboutPresent` resolved to names (ids nobody in the scene answers to are left out). */
  aboutNames: string[]
}

/**
 * What the Prompt Inspector gets back: the built prompt plus, only when the section breakdown was
 * asked for, how character memory shaped it. The real generation path never fills these.
 */
export interface PromptInspection extends PromptBuildResult {
  /** Turn bookkeeping only, filled for Deep Memory without changing the prompt. */
  memoryRecallIds?: string[]
  /** Present whenever character memory ran for this speaker (may be empty). */
  memoryPicks?: InspectedMemoryPick[]
  /** The speaker's journal text, when one was folded in. */
  memoryJournal?: string
  /** Memories this speaker knows that did not fit the memory budget. */
  memorySkipped?: number
  /** Transcript messages left out because this speaker was not there for them. */
  memoryWitnessFilter?: { hiddenMessages: number }
}
