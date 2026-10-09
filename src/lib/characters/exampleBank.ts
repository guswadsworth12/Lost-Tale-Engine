import { estimateTokens } from '../tokenEstimate.ts'
import { extractExampleCharTurns, splitExampleBlocks } from './voice.ts'

export const SITUATIONS = ['everyday', 'banter', 'teasing', 'flirting', 'comfort', 'grief', 'anger', 'scolding', 'embarrassed', 'danger', 'planning', 'celebrating'] as const
export type Situation = typeof SITUATIONS[number]
export interface ExampleBankEntry { id: string; situations: Situation[]; text: string; enabled: boolean }
export const EXAMPLE_TOKEN_BUDGET = 450
export const EXAMPLE_BANK_MAX = 40
export const EXAMPLE_TEXT_MAX = 3000

// Small literal vocabulary: authors can override the suggested tags in the editor.
export const SITUATION_WORDS: Record<Situation, readonly string[]> = {
  everyday: ['hello', 'morning', 'coffee', 'lunch', 'weather'],
  banter: ['joke', 'joking', 'funny', 'laugh', 'laughing'],
  teasing: ['tease', 'teasing', 'smirk', 'playful'],
  flirting: ['flirt', 'flirting', 'kiss', 'romantic', 'darling'],
  comfort: ['comfort', 'reassure', 'afraid', 'worried', 'hug'],
  grief: ['grief', 'grieving', 'mourn', 'mourning', 'funeral', 'loss'],
  anger: ['angry', 'anger', 'furious', 'rage'],
  scolding: ['scold', 'scolding', 'irresponsible', 'reckless'],
  embarrassed: ['embarrassed', 'embarrassing', 'blush', 'blushing', 'awkward'],
  danger: ['danger', 'attack', 'combat', 'fight', 'weapon', 'enemy'],
  planning: ['plan', 'planning', 'strategy', 'prepare', 'route'],
  celebrating: ['celebrate', 'celebrating', 'congratulations', 'victory', 'cheers'],
}
export interface ExampleContext {
  recentText: string
  activeDate?: boolean
  activeHangout?: boolean
  pendingAdjudication?: boolean
  danger?: boolean
  planning?: boolean
  similarities?: ReadonlyMap<string, number>
  previousIds?: readonly string[]
}
export function guessSituations(text: string, state: Omit<ExampleContext, 'recentText'> = {}): Situation[] {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) ?? [])
  const matched = new Set(SITUATIONS.filter((s) => SITUATION_WORDS[s].some((word) => words.has(word))))
  if (state.activeDate) { matched.add('flirting'); matched.add('everyday') }
  if (state.activeHangout) matched.add('everyday')
  if (state.pendingAdjudication || state.danger) matched.add('danger')
  if (state.planning) matched.add('planning')
  return SITUATIONS.filter((s) => matched.has(s))
}
export function validateExampleBank(raw: unknown): ExampleBankEntry[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.length > EXAMPLE_BANK_MAX) throw new Error('Example bank allows at most 40 entries.')
  const ids = new Set<string>()
  return raw.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 80 || ids.has(entry.id)) throw new Error('Each example needs a unique id.')
    if (typeof entry.enabled !== 'boolean' || !Array.isArray(entry.situations) || entry.situations.length > SITUATIONS.length || entry.situations.some((s: unknown) => !(SITUATIONS as readonly unknown[]).includes(s))) throw new Error('Example situations must use the listed choices, with enabled on or off.')
    if (typeof entry.text !== 'string' || entry.text.length > EXAMPLE_TEXT_MAX || splitExampleBlocks(entry.text).length !== 1 || (entry.text.match(/^\s*<START>\s*$/gim) ?? []).length !== 1 || !extractExampleCharTurns(entry.text).length) throw new Error('Each example needs one <START> block with a {{char}}: turn, at most 3,000 characters.')
    ids.add(entry.id)
    return { id: entry.id, situations: [...new Set(entry.situations)] as Situation[], text: entry.text, enabled: entry.enabled }
  })
}
export function splitExamples(text: string, id: () => string): ExampleBankEntry[] {
  return splitExampleBlocks(text).map((block) => ({ id: id(), text: block, enabled: true, situations: guessSituations(block).length ? guessSituations(block) : ['everyday'] }))
}
export interface ExamplePick { entry: ExampleBankEntry; situations: Situation[]; similarMeaning: boolean; fallback: boolean; tokens: number; score: number }
export function pickExamples(bank: readonly ExampleBankEntry[], context: ExampleContext): ExamplePick[] {
  const situations = guessSituations(context.recentText, context)
  const candidates = bank.filter((entry) => entry.enabled && entry.text.trim()).map((entry) => {
    const matched = entry.situations.filter((s) => situations.includes(s))
    const similarity = context.similarities?.get(entry.id) ?? 0
    return { entry, situations: matched, similarMeaning: Number.isFinite(similarity) && similarity > 0, fallback: false,
      tokens: estimateTokens(entry.text), score: matched.length + (Number.isFinite(similarity) ? Math.max(0, similarity) : 0) }
  }).filter((pick) => pick.tokens <= EXAMPLE_TOKEN_BUDGET)
  let fits = candidates.filter((p) => p.score > 0)
  if (!fits.length) fits = candidates.filter((p) => p.entry.situations.includes('everyday')).map((p) => ({ ...p, fallback: true }))
  const fresh = fits.filter((p) => !context.previousIds?.includes(p.entry.id))
  if (fresh.length) fits = fresh
  fits.sort((a, b) => b.score - a.score || Number(b.entry.situations.includes('everyday')) - Number(a.entry.situations.includes('everyday')) || bank.indexOf(a.entry) - bank.indexOf(b.entry))
  const picked: ExamplePick[] = []
  let used = 0
  for (const pick of fits) if (picked.length < (pick.fallback ? 1 : 2) && used + pick.tokens <= EXAMPLE_TOKEN_BUDGET) { picked.push(pick); used += pick.tokens }
  return picked
}
/** Off and empty-bank paths return the original base bytes. */
export function exampleText(base: string, picks: readonly ExamplePick[], enabled: boolean): string {
  return enabled && picks.length ? [base, ...picks.map((p) => p.entry.text)].filter((text) => text.trim()).join('\n\n') : base
}
