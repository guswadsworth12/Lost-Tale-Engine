/**
 * Folds aging messages into a running summary via the connected model itself — the actual
 * long-term memory mechanism: once messages age out of the context window, their substance
 * survives here instead of being silently dropped.
 */

import type { ChatMessage } from './builder'
import type { VoiceFingerprint } from '@/lib/characters/cardSpec'

export type SummaryDetail = 'concise' | 'detailed'

export interface SummarizeInput {
  existingSummary: string
  messages: ChatMessage[]
  charName: string
  userName: string
  detail?: SummaryDetail
  /** Optional current voice metadata; summaries stay factual rather than carrying repeated phrases. */
  voiceFingerprint?: VoiceFingerprint
  generate: (prompt: string) => Promise<string>
}

function voiceRetentionInstruction(charName: string, fingerprint: VoiceFingerprint | undefined): string {
  if (!fingerprint) return ''
  if (!fingerprint.dialectNotes?.trim() && !fingerprint.sentenceRhythm?.trim()) return ''
  return `Record durable events about ${charName}, not quotations or repeated speech habits. Their current card provides voice guidance.`
}

/** Rough max_length to hand the API for each detail level. */
export const SUMMARY_MAX_LENGTH: Record<SummaryDetail, number> = {
  concise: 320,
  detailed: 700,
}

export async function summarizeMessages({
  existingSummary,
  messages,
  charName,
  userName,
  detail = 'concise',
  voiceFingerprint,
  generate,
}: SummarizeInput): Promise<string> {
  const transcript = messages.map((m) => `${m.name}: ${m.text}`).join('\n')
  const lengthInstruction =
    detail === 'detailed'
      ? 'Cover key facts established, relationship or emotional developments, important events, and notable details of setting worth remembering. Third person, plain prose, no headers or bullet points, no em dashes, under 300 words.'
      : 'Cover key facts established, relationship or emotional developments, and important events either character would remember. Third person, plain prose, no headers or bullet points, no em dashes, under 140 words.'
  const voiceInstruction = voiceRetentionInstruction(charName, voiceFingerprint)
  const prompt = [
    `Task: maintain a running memory log for a roleplay chat between ${userName} and ${charName}.`,
    existingSummary.trim() ? `Memory so far:\n${existingSummary.trim()}` : '',
    `New events to fold in:\n${transcript}`,
    `Write the updated memory log: merge new events into the existing memory. Mark changed states as former states, and remove completed goals from open threads while preserving historical events. Name who requested, permitted, intended, or actually promised an action; do not turn a request into a commitment. Do not infer routines or elapsed absences without explicit history. Reassurance alone does not resolve an open matter. ${lengthInstruction} Finish with a complete sentence. Do not invent anything that didn't happen above.${voiceInstruction ? ` ${voiceInstruction}` : ''}\n\nUpdated memory log:`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const result = await generate(prompt)
  const summary = result.trim()
  if (!summary || !/[.!?]["'”’]?\s*$/.test(summary)) throw new Error('Memory summary ended mid-sentence or empty; keeping the previous summary and unsummarized messages.')
  return summary
}
