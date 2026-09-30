/**
 * The engine prompts a world can tune (`WorldCard.promptOverrides`): only each prompt's guidance
 * section, never the data it's given, the reply format the engine parses, or the guardrails
 * (`prompt/tunable.ts` lists those). An unset or blank override uses the engine default.
 *
 * Only relative `.ts` imports here: the server loads this file with plain Node.
 */

export const TUNABLE_PROMPT_IDS = ['gm-style', 'scribe', 'scene-recap', 'chapter-recap', 'journal'] as const
export type TunablePromptId = (typeof TUNABLE_PROMPT_IDS)[number]

export const MAX_PROMPT_OVERRIDE = 6000

/** A world's override for one prompt, or undefined for the engine default. */
export function promptOverride(overrides: Partial<Record<string, string>> | undefined, id: TunablePromptId): string | undefined {
  const text = overrides?.[id]?.trim()
  return text ? text : undefined
}

/** A world's overrides from a request: known prompts only, non-blank, capped in length. */
export function normalizePromptOverrides(raw: unknown): Partial<Record<TunablePromptId, string>> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const v = raw as Record<string, unknown>
  const out: Partial<Record<TunablePromptId, string>> = {}
  for (const id of TUNABLE_PROMPT_IDS) {
    const text = typeof v[id] === 'string' ? (v[id] as string).trim().slice(0, MAX_PROMPT_OVERRIDE) : ''
    if (text) out[id] = text
  }
  return out
}
