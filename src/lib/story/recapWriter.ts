/**
 * Writes the recap a scene leaves behind when it ends: a short past-tense account for later scenes,
 * the threads still open, and any durable facts worth offering to the player as world canon.
 */

import { parseLenientJson } from '@/lib/jsonRepair'

export interface RecapDraft {
  text: string
  openThreads: string[]
  lastingChanges: string[]
}

export interface RecapInput {
  /** The world's own guidance for how a recap reads; unset: `SCENE_RECAP_GUIDANCE`. */
  guidance?: string
  messages: { role: 'user' | 'char'; name: string; text: string }[]
  playerName: string
  castNames: string[]
  location?: string
  /** Recaps of earlier scenes. Context only: the model is told never to retell it. */
  storySoFar?: string
  /** Server-recorded checks take precedence over character or GM prose when they disagree. */
  recordedChecks?: string[]
  /** Transcript budget in characters; older messages are dropped past it. */
  maxChars?: number
}

export const DEFAULT_RECAP_MAX_CHARS = 24000
export const MAX_OPEN_THREADS = 6
export const MAX_LASTING_CHANGES = 6

/** Newest messages that fit in `maxChars`, oldest first. Always keeps at least the latest one. */
function fitTranscript(messages: RecapInput['messages'], maxChars: number): { lines: string[]; cut: boolean } {
  const lines: string[] = []
  let used = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    const text = m.text.trim()
    if (!text) continue
    const line = `${m.name}: ${text}`
    if (lines.length && used + line.length + 1 > maxChars) {
      return { lines, cut: true }
    }
    lines.unshift(line)
    used += line.length + 1
  }
  return { lines, cut: false }
}

/** How a scene recap reads: the part of its prompt a world can tune (`prompt/tunable.ts`). */
export const SCENE_RECAP_GUIDANCE = 'About 80 to 160 words, third person, plain prose, no headers, no em dashes. Name who was there. Cover what happened and what changed between people. End with where things were left.'

export function buildRecapPrompt(input: RecapInput): string {
  const maxChars = input.maxChars ?? DEFAULT_RECAP_MAX_CHARS
  const { lines, cut } = fitTranscript(input.messages, maxChars)
  const present = [input.playerName, ...input.castNames].map((n) => n.trim()).filter(Boolean)
  const who = [...new Set(present)].join(', ')

  const sections = [
    'Task: a roleplay scene has just ended. Write the recap that later scenes will rely on, since they will not see this transcript.',
    `Present in this scene: ${who || 'unknown'}.${input.location?.trim() ? ` Where it took place: ${input.location.trim()}.` : ''}`,
    input.storySoFar?.trim()
      ? `The story so far (context only, for names and continuity. Do not retell or summarize any of it; recap only the scene below):\n${input.storySoFar.trim()}`
      : '',
    cut
      ? '(The start of this scene was cut to fit. Only its later part is shown below; do not guess at what was cut.)'
      : '',
    input.recordedChecks?.length
      ? `Binding check results from this scene (use these if any prose disagrees):\n${input.recordedChecks.map((check) => `- ${check}`).join('\n')}`
      : '',
    `Scene transcript:\n${lines.join('\n')}`,
    [
      'Write:',
      `- "recap": a compact past-tense recap of this scene. ${input.guidance?.trim() || SCENE_RECAP_GUIDANCE}`,
      '- "openThreads": unresolved questions or promises made in this scene, one short line each. Empty if there are none.',
      '- "lastingChanges": concrete, durable facts that should stay true in this world from now on (for example a death, a destroyed place, a title granted, a secret now public), one short line each. Only lasting facts, not moods or plans. It is fine to have none.',
      'Never invent events that are not in the transcript.',
      'Reply with only a JSON object: {"recap": "...", "openThreads": ["..."], "lastingChanges": ["..."]}',
    ].join('\n'),
  ]
  return sections.filter(Boolean).join('\n\n')
}

function cleanList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (typeof item !== 'string') continue
    const line = item.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()
    if (!line || seen.has(line.toLowerCase())) continue
    seen.add(line.toLowerCase())
    out.push(line)
    if (out.length >= cap) break
  }
  return out
}

function stripFence(raw: string): string {
  return raw.replace(/^\s*```[a-z]*\s*\n?/i, '').replace(/\n?\s*```\s*$/, '').trim()
}

/** Lenient: JSON (fenced or slightly broken) first, else the whole reply is the recap. */
export function parseRecapResponse(raw: string): RecapDraft {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return { text: '', openThreads: [], lastingChanges: [] }

  if (trimmed.includes('{')) {
    try {
      const parsed = parseLenientJson(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>
        const textValue = [obj.recap, obj.text, obj.summary].find((v) => typeof v === 'string') as string | undefined
        const text = textValue?.trim() ?? ''
        const recognised = ['recap', 'text', 'summary', 'openThreads', 'open_threads', 'lastingChanges', 'lasting_changes'].some((k) => k in obj)
        // A recognised object is the answer even with an empty recap (the dialog then asks for a rewrite);
        // echoing raw JSON back as the recap text would be worse.
        if (text || recognised) {
          return {
            text,
            openThreads: cleanList(obj.openThreads ?? obj.open_threads, MAX_OPEN_THREADS),
            lastingChanges: cleanList(obj.lastingChanges ?? obj.lasting_changes, MAX_LASTING_CHANGES),
          }
        }
      }
    } catch {
      // Not JSON after all: fall through to plain text.
    }
  }

  return { text: stripFence(trimmed), openThreads: [], lastingChanges: [] }
}

export async function writeSceneRecap(
  input: RecapInput & { generate: (prompt: string) => Promise<string> },
): Promise<RecapDraft> {
  const { generate, ...rest } = input
  const raw = await generate(buildRecapPrompt(rest))
  return parseRecapResponse(raw)
}
