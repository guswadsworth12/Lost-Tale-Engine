/**
 * Writes the recap a chapter leaves behind when it ends, from the recaps of its scenes (never their
 * transcripts, which are long gone from context): a short account of the arc for the chapters after
 * it, and the threads it leaves open. Reviewed and edited by the player before it's kept.
 */

import { MAX_OPEN_THREADS, parseRecapResponse } from './recapWriter'

export interface ChapterRecapInput {
  /** e.g. "Chapter 2 · Low Tide". */
  chapterLabel: string
  goal?: string
  playerName: string
  /** The chapter's scenes in this line of play, oldest first, the ending one included. */
  scenes: { label: string; recap: string; openThreads?: string[] }[]
}

export interface ChapterRecapDraft {
  text: string
  openThreads: string[]
  /** Set when the model couldn't write it and the scene recaps were joined instead. */
  fallback?: string
}

export function buildChapterRecapPrompt(input: ChapterRecapInput): string {
  return [
    `Task: a chapter of a roleplay story has just ended: ${input.chapterLabel}. Write the recap later chapters will rely on. They will see this instead of the scene recaps below.`,
    input.goal?.trim() ? `What the chapter was working toward: ${input.goal.trim()}` : '',
    `The player's character: ${input.playerName}.`,
    `The chapter's scenes, in order:\n${input.scenes.map((s) => `${s.label}: ${s.recap.trim()}${s.openThreads?.length ? ` (Left open: ${s.openThreads.join('; ')})` : ''}`).join('\n')}`,
    [
      'Write:',
      '- "recap": a compact past-tense account of the whole chapter, about 100 to 200 words, third person, plain prose, no headers, no em dashes. Cover the arc: what was at stake, what happened, what changed between people, and whether the goal was reached. End with where things stand.',
      '- "openThreads": what is still unresolved at the end of the chapter, one short line each. Drop threads a later scene resolved. Empty if there are none.',
      'Never invent events that are not in the scene recaps.',
      'Reply with only a JSON object: {"recap": "...", "openThreads": ["..."]}',
    ].join('\n'),
  ].filter(Boolean).join('\n\n')
}

/** The scene recaps joined, and the last scene's open threads: what the chapter recap is without a model. */
export function fallbackChapterRecap(input: ChapterRecapInput, reason: string): ChapterRecapDraft {
  return {
    text: input.scenes.map((s) => s.recap.trim()).filter(Boolean).join('\n\n'),
    openThreads: (input.scenes[input.scenes.length - 1]?.openThreads ?? []).slice(0, MAX_OPEN_THREADS),
    fallback: reason,
  }
}

export async function writeChapterRecap(input: ChapterRecapInput & { generate: (prompt: string) => Promise<string> }): Promise<ChapterRecapDraft> {
  const { generate, ...rest } = input
  try {
    const parsed = parseRecapResponse(await generate(buildChapterRecapPrompt(rest)))
    if (parsed.text.trim()) return { text: parsed.text.trim(), openThreads: parsed.openThreads }
    return fallbackChapterRecap(rest, 'The model wrote an empty recap.')
  } catch (error) {
    return fallbackChapterRecap(rest, error instanceof Error ? error.message : String(error))
  }
}
