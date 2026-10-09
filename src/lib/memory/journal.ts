/**
 * A character's journal: when a scene ends, their older, lesser memories are folded into one short
 * prose account so a long campaign stays small. Pure selection, prompt building and parsing.
 */

import { recallStrength } from './rank'
import { parseLenientJson } from '@/lib/jsonRepair'
import type { CharacterMemory, MemoryRecall } from '@/lib/types'

export const JOURNAL_WEIGHTS = { importance: 0.6, recency: 0.4, feeling: 1, recall: 1 } as const

export const DEFAULT_JOURNAL_KEEP_RECENT = 12
export const MAX_JOURNAL_CHARS = 1500

/**
 * Memories `characterId` knows that should be folded into their journal, oldest first. Candidates
 * are active, non-journal, not pinned, not already in this character's journal
 * (`consolidatedFor`) and not open threads. The
 * `keepRecent` best by 0.6 * importance + 0.4 * recency stay as their own lines; the rest fold.
 */
export function pickForJournal(
  memories: (CharacterMemory & { recall?: MemoryRecall })[],
  characterId: string,
  opts?: { keepRecent?: number; deep?: { now: number } },
): CharacterMemory[] {
  const keepRecent = Math.max(0, Math.floor(opts?.keepRecent ?? DEFAULT_JOURNAL_KEEP_RECENT))
  const candidates = memories
    .filter(
      (m) =>
        m.active &&
        m.knownBy.includes(characterId) &&
        m.kind !== 'journal' &&
        !m.pinned &&
        !m.consolidatedFor?.includes(characterId) &&
        !m.unresolved,
    )
    .sort((a, b) => b.createdAt - a.createdAt)
  if (candidates.length <= keepRecent) return []

  // Recency by rank: newest 1, oldest 0.
  const last = candidates.length - 1
  const scored = candidates.map((m, i) => ({
    m,
    i,
    score: JOURNAL_WEIGHTS.importance * clampUnit(m.importance) + JOURNAL_WEIGHTS.recency * (last ? 1 - i / last : 1)
      + (opts?.deep ? JOURNAL_WEIGHTS.feeling * clampUnit(Math.abs(m.feelings?.[characterId] ?? 0)) + JOURNAL_WEIGHTS.recall * recallStrength(m.recall, opts.deep.now) : 0),
  }))
  const keep = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, keepRecent)
      .map((s) => s.m.id),
  )
  return candidates.filter((m) => !keep.has(m.id)).sort((a, b) => a.createdAt - b.createdAt)
}

function clampUnit(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

export interface JournalInput {
  /** The world's own guidance for how a journal reads; unset: `JOURNAL_GUIDANCE`. `{name}` is the character. */
  guidance?: string
  name: string
  previousJournal?: string
  toFold: { text: string; feeling?: number }[]
  worldName?: string
}

function feelingNote(name: string, feeling: number | undefined): string {
  if (feeling === undefined || !Number.isFinite(feeling)) return ''
  if (feeling >= 0.3) return ` (sat well with ${name})`
  if (feeling <= -0.3) return ` (sat badly with ${name})`
  return ''
}

/** How a journal reads: the part of its prompt a world can tune (`prompt/tunable.ts`). `{name}` is the character. */
export const JOURNAL_GUIDANCE = [
  'Third person, plain prose, under 180 words. No headers, no bullet points, no em dashes.',
  'Keep names, promises and secrets exact. Keep how things left {name} feeling where it matters. Drop trivia.',
].join('\n')

export function buildJournalPrompt(input: JournalInput): string {
  const name = input.name.trim() || 'the character'
  const lines = input.toFold
    .map((m) => ({ text: m.text.replace(/\s+/g, ' ').trim(), feeling: m.feeling }))
    .filter((m) => m.text)
    .map((m) => `- ${m.text}${feelingNote(name, m.feeling)}`)

  const sections = [
    `Task: write ${name}'s private journal${input.worldName?.trim() ? ` for a roleplay set in ${input.worldName.trim()}` : ''}: a compact account of what ${name} carries from earlier in the story.`,
    input.previousJournal?.trim() ? `${name}'s journal so far:\n${input.previousJournal.trim()}` : '',
    `Older memories to fold in:\n${lines.join('\n')}`,
    [
      `Write the updated journal. Integrate the journal so far and the memories above into one account; do not just append.`,
      (input.guidance?.trim() || JOURNAL_GUIDANCE).replace(/\{name\}/g, name),
      'Never invent anything that is not above.',
      'Reply with only the journal text.',
    ].join('\n'),
  ]
  return sections.filter(Boolean).join('\n\n')
}

const LABEL = /^\s*(?:\*\*|__)?\s*(?:(?:updated|new|revised)\s+)?(?:journal|journal entry|entry)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?/i

/** Strips fences, wrapping quotes and a leading "Journal:" label; collapses whitespace; caps length. */
export function parseJournalResponse(raw: string): string {
  let text = (raw ?? '').trim()
  if (!text) return ''

  text = text.replace(/^```[a-z]*\s*\n?/i, '').replace(/\n?\s*```\s*$/, '').trim()

  // A model that answers with {"journal": "..."} anyway.
  if (text.startsWith('{')) {
    try {
      const parsed = parseLenientJson(text)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const obj = parsed as Record<string, unknown>
        const value = [obj.journal, obj.text, obj.entry].find((v) => typeof v === 'string')
        if (typeof value === 'string') text = value.trim()
      }
    } catch {
      // Plain text after all.
    }
  }

  text = text.replace(LABEL, '').trim()
  const quotes: [string, string][] = [['"', '"'], ['“', '”'], ["'", "'"]]
  for (const [open, close] of quotes) {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
      text = text.slice(open.length, text.length - close.length).trim()
      break
    }
  }

  text = text.replace(/\s+/g, ' ').trim()
  if (text.length > MAX_JOURNAL_CHARS) {
    const cut = text.slice(0, MAX_JOURNAL_CHARS)
    const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
    const space = cut.lastIndexOf(' ')
    text = sentence > MAX_JOURNAL_CHARS * 0.6 ? cut.slice(0, sentence + 1) : space > 0 ? cut.slice(0, space) : cut
  }
  return text
}
