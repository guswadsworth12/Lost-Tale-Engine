import type { CharacterMemory } from '../../src/lib/types'
import { memoryAsSeenFrom, sceneChainIds, type ChatLike, type StoryLike } from '../memoryPlan'
import { estimateTokens } from '../../src/lib/tokenEstimate'
import { formatMemoryLine, MEMORY_TOKEN_BUDGET, selectMemoriesExplained } from '../../src/lib/memory/rank'

export interface RecallCase {
  id: string
  category: string
  cast: { id: string; name: string }[]
  memories: (CharacterMemory & { location?: string; links?: unknown[] })[]
  chats: (ChatLike & { id: string })[]
  stories: (StoryLike & { id: string })[]
  scene: {
    chatId: string
    speakerId: string
    presentIds: string[]
    location?: string | null
    atmosphere?: string | null
    recentMessages: string[]
  }
  question: string
  expectedIds: string[]
  forbiddenIds: string[]
  mustNeverRegress: boolean
}

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text)
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Fail loudly on broken labels or scope; never turn an invalid fixture into a good score. */
export function parseCase(raw: unknown): RecallCase {
  const require = (ok: unknown, message: string) => { if (!ok) throw new Error(`Invalid recall case: ${message}`) }
  require(object(raw), 'expected an object')
  const c = raw as Record<string, any>
  require(text(c.id) && text(c.category) && text(c.question), 'id, category and question are required')
  for (const key of ['cast', 'memories', 'chats', 'stories']) {
    require(Array.isArray(c[key]) && c[key].every((v: unknown) => object(v) && text(v.id)), `${key} needs objects with ids`)
    require(new Set(c[key].map((v: { id: string }) => v.id)).size === c[key].length, `${key} has duplicate ids`)
  }
  require(c.cast.every((v: any) => text(v.name)), 'cast names are required')
  require(object(c.scene), 'scene is required')
  require(text(c.scene.chatId) && text(c.scene.speakerId) && strings(c.scene.presentIds)
    && strings(c.scene.recentMessages), 'scene needs a chat, speaker, presentIds and recentMessages')
  const cast = new Set(c.cast.map((v: any) => v.id))
  const chats = new Set(c.chats.map((v: any) => v.id))
  require(cast.has(c.scene.speakerId) && c.scene.presentIds.every((id: string) => cast.has(id)), 'scene refers to missing cast')
  require(chats.has(c.scene.chatId), 'scene chat is missing')
  for (const m of c.memories) {
    require(text(m.text) && chats.has(m.chatId), 'memory text and chat are required')
    require(['event', 'learned', 'promise', 'secret', 'impression', 'journal'].includes(m.kind), 'unknown memory kind')
    require(strings(m.witnesses) && strings(m.knownBy) && [...m.witnesses, ...m.knownBy].every((id) => cast.has(id)), 'invalid memory knowers')
    require(finite(m.createdAt) && finite(m.importance) && m.importance >= 0 && m.importance <= 1, 'invalid memory time or importance')
    require(typeof m.active === 'boolean' && ['scribe', 'manual', 'journal'].includes(m.origin), 'invalid memory state or origin')
    for (const key of ['about', 'consolidatedFor']) {
      require(m[key] === undefined || (strings(m[key]) && m[key].every((id: string) => cast.has(id))), `invalid ${key}`)
    }
    require(m.feelings === undefined || (object(m.feelings) && Object.entries(m.feelings).every(([id, v]) => cast.has(id) && finite(v) && Math.abs(v) <= 1)), 'invalid feelings')
    require(m.toldVia === undefined || (Array.isArray(m.toldVia) && m.toldVia.every((t: any) => object(t) && strings(t.to)
      && t.to.every((id: string) => cast.has(id)) && finite(t.at) && (t.chatId === undefined || chats.has(t.chatId)))), 'invalid tellings')
    for (const key of ['pinned', 'unresolved']) require(m[key] === undefined || typeof m[key] === 'boolean', `invalid ${key}`)
  }
  const ids = new Set(c.memories.map((m: any) => m.id))
  for (const key of ['expectedIds', 'forbiddenIds']) {
    require(strings(c[key]) && c[key].every((id: string) => ids.has(id)) && new Set(c[key]).size === c[key].length, `invalid ${key}`)
  }
  require(c.expectedIds.length > 0, 'at least one expected memory is required')
  require(!c.expectedIds.some((id: string) => c.forbiddenIds.includes(id)), 'a memory cannot be both expected and forbidden')
  require(typeof c.mustNeverRegress === 'boolean', 'mustNeverRegress must be explicit')
  return c as RecallCase
}

export interface EvalOptions { budgetTokens?: number; module?: 'off' | 'on' }

export function evaluateCase(c: RecallCase, options: EvalOptions = {}) {
  if (options.module === 'on') throw new Error('Deep Memory is not implemented yet; use --module off for the baseline.')
  const budgetTokens = options.budgetTokens ?? MEMORY_TOKEN_BUDGET
  if (!Number.isFinite(budgetTokens) || budgetTokens < 0) throw new Error('Budget must be a non-negative number.')
  const chats = new Map(c.chats.map((v) => [v.id, v]))
  const stories = new Map(c.stories.map((v) => [v.id, v]))
  const chain = new Set(sceneChainIds(c.scene.chatId, (id) => chats.get(id), (id) => stories.get(id)))
  // Same order as GET /chats/:id/memories: scene scope, branch-scoped tellings, then ranking.
  const visible = c.memories.filter((m) => chain.has(m.chatId)).map((m) => memoryAsSeenFrom(m, chain))
  const picks = selectMemoriesExplained(visible, {
    characterId: c.scene.speakerId,
    presentIds: c.scene.presentIds,
    recentText: c.scene.recentMessages.slice(-6).join('\n'),
    budgetTokens,
  })
  const picked = new Set(picks.map((p) => p.memory.id))
  const recalled = c.expectedIds.filter((id) => picked.has(id))
  const missing = c.expectedIds.filter((id) => !picked.has(id))
  const forbidden = c.forbiddenIds.filter((id) => picked.has(id))
  return {
    id: c.id, question: c.question, mustNeverRegress: c.mustNeverRegress,
    budgetTokens, picks, recalled, missing, forbidden,
    expected: c.expectedIds.length,
    hit: missing.length === 0 && forbidden.length === 0,
    usedTokens: picks.reduce((sum, p) => sum + estimateTokens(`- ${formatMemoryLine(p.memory, c.scene.speakerId)}\n`), 0),
  }
}

export type RecallResult = ReturnType<typeof evaluateCase>

export function summarize(results: RecallResult[]) {
  const expected = results.reduce((sum, r) => sum + r.expected, 0)
  const recalled = results.reduce((sum, r) => sum + r.recalled.length, 0)
  return {
    cases: results.length, hits: results.filter((r) => r.hit).length,
    expected, recalled, recall: expected ? recalled / expected : 0,
    violations: results.reduce((sum, r) => sum + r.forbidden.length, 0),
    regressions: results.filter((r) => r.mustNeverRegress && !r.hit).length,
  }
}
