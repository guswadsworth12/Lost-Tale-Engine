import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomInt } from 'node:crypto'
import {
  characterStore,
  chatFactStore,
  chatStore,
  db,
  assistantThreadStore,
  instructTemplateStore,
  messageStore,
  newId,
  objectiveStore,
  personaStore,
  presetStore,
  relationshipEventStore,
  themeStore,
  worldInfoBookStore,
  worldStore,
  avatarsDir,
} from './db.ts'
import { addVoiceSample, listVoiceSamples, luxttsSpeak, luxttsStatus } from './luxtts.ts'
import { listVrmLibrary, removeAvatar, resolveAvatar, resolveAvatarMap, resolveAvatarMapVariants, resolveCharacterModel, resolveWorldBackgroundsNightMap, resolveWorldMusicMap } from './avatars.ts'
import { encodeTokens, tokenizerForModel } from './novelaiTokenizer.ts'
import { originGuard } from './originCheck.ts'
import { openMayhemRouter } from './openMayhem.ts'
import { storiesRouter } from './stories.ts'
import { createResolvedCampaignRoll, requiredRollText, sameRollRequest } from './campaignRoll.ts'
import { searchLocalLibrary } from './assistantSearch.ts'
import { isCampaignResolver, normalizeCampaignRanks, normalizeCampaignStats, normalizeCharacterSheet, normalizeCharacterSheets, sheetForWorld, sheetModifier, statForMove, type CampaignConfig } from '../src/lib/world/campaign.ts'
import type { Character } from '../src/lib/characters/cardSpec.ts'
import type { Chat, ChatFact, Objective, StoredMessage, WorldCard, WorldInfoBook } from '../src/lib/types.ts'

/**
 * Express app: REST routes for characters, personas, chats/messages, world info books, sampler
 * presets, themes, instruct templates, worlds, objectives, relationship events, chat facts, full
 * backup/restore, and the NovelAI tokenize endpoint — plus the request-body normalization helpers
 * that validate client-authored JSON before it's persisted.
 */
export const app = express()

// Rejects a request whose Origin is another website; any loopback origin is allowed. See originCheck.ts.
app.use(originGuard)

// Raised generously (a bulk sprite upload easily clears 25MB) — local-only app, no untrusted-request concern.
app.use(express.json({ limit: '150mb' }))
app.use('/api/openmayhem', openMayhemRouter())
app.use('/api', storiesRouter)
app.use('/avatars', express.static(avatarsDir))

function notFound(res: express.Response) {
  res.status(404).json({ error: 'Not found' })
}

function normalizePromptItems(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const items = raw.slice(0, 200)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id : newId(),
      name: typeof item.name === 'string' ? item.name.slice(0, 200) : 'Prompt item',
      content: typeof item.content === 'string' ? item.content.slice(0, 100_000) : '',
      role: item.role === 'user' || item.role === 'assistant' ? item.role : 'system',
      enabled: item.enabled === true,
      importWarning: typeof item.importWarning === 'string' ? item.importWarning.slice(0, 500) : undefined,
      source: item.source === 'tavernai2' ? 'tavernai2' : undefined,
    }))
  return items.length ? items : undefined
}

/** `Character.spriteSources`: sprite key -> sha256 of the art the library importer last wrote there. */
function normalizeSpriteSources(raw: unknown) {
  if (!raw || typeof raw !== 'object') return undefined
  const entries = Object.entries(raw as Record<string, unknown>)
    .filter(([key, hash]) => /^[a-z0-9][a-z0-9-]{0,89}$/i.test(key) && typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash))
  return entries.length ? Object.fromEntries(entries) as Record<string, string> : undefined
}

/** `Character.vrm`: an optional 3D model for VN mode. `null` clears it. */
function normalizeVrm(id: string, raw: unknown) {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const url = resolveCharacterModel(id, value.url)
  if (!url) return undefined
  return {
    url,
    enabled: value.enabled !== false,
    label: typeof value.label === 'string' ? value.label.trim().slice(0, 200) || undefined : undefined,
  }
}

function normalizeWorldModules(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const modules: Record<string, boolean | 'guided' | 'mechanical'> = {}
  if (value.campaignRules === false || value.campaignRules === 'guided' || value.campaignRules === 'mechanical') modules.campaignRules = value.campaignRules
  for (const key of ['relationships', 'dating', 'visualNovel', 'worldSimulation']) {
    if (typeof value[key] === 'boolean') modules[key] = value[key] as boolean
  }
  return modules
}

function normalizeCampaign(raw: unknown) {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const ruleset = typeof value.ruleset === 'string' ? value.ruleset.trim().slice(0, 200) : ''
  return {
    ruleset: ruleset || 'Custom',
    edition: typeof value.edition === 'string' ? value.edition.trim().slice(0, 100) : undefined,
    mode: value.mode === 'mechanical' ? 'mechanical' : 'guided',
    resolver: isCampaignResolver(value.resolver) ? value.resolver : 'pbta',
    relationships: value.relationships === true,
    dating: value.dating === true && value.relationships === true,
    ...(Array.isArray(value.stats) ? { stats: normalizeCampaignStats(value.stats) ?? [] } : {}),
    ...(Array.isArray(value.ranks) ? { ranks: normalizeCampaignRanks(value.ranks) ?? [] } : {}),
    moves: Array.isArray(value.moves) ? value.moves.slice(0, 100)
      .filter((move): move is Record<string, unknown> => !!move && typeof move === 'object')
      .map((move) => ({
        id: typeof move.id === 'string' && move.id.trim() ? move.id.slice(0, 100) : newId(),
        name: typeof move.name === 'string' ? move.name.slice(0, 200) : '',
        trigger: typeof move.trigger === 'string' ? move.trigger.slice(0, 2000) : '',
        stat: typeof move.stat === 'string' ? move.stat.slice(0, 100) : '',
        ...(typeof move.statId === 'string' && move.statId.trim() ? { statId: move.statId.slice(0, 100) } : {}),
        ...(Number.isInteger(move.target) && (move.target as number) >= -30 && (move.target as number) <= 100 ? { target: move.target } : {}),
        strong: typeof move.strong === 'string' ? move.strong.slice(0, 4000) : '',
        mixed: typeof move.mixed === 'string' ? move.mixed.slice(0, 4000) : '',
        miss: typeof move.miss === 'string' ? move.miss.slice(0, 4000) : '',
      })) : [],
  }
}

function normalizeCanonFacts(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  return raw.slice(0, 500)
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object' && typeof item.text === 'string' && !!item.text.trim())
    .map((item) => ({
      id: typeof item.id === 'string' && item.id.trim() ? item.id.slice(0, 100) : newId(),
      text: (item.text as string).trim().slice(0, 4000),
      createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
      sourceChatId: typeof item.sourceChatId === 'string' ? item.sourceChatId.slice(0, 100) : undefined,
    }))
}

function normalizeCustomExpressions(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const entries = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id.trim() : '',
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Custom',
    }))
    .filter((e) => !!e.id)
  return entries.length ? entries : undefined
}

/** A character's wardrobe states (`src/lib/vn/outfits.ts`); `id` is slug-validated since it becomes half of a sprite filename, and `base` is reserved. */
function normalizeOutfits(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const entries = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id.trim().toLowerCase() : '',
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Outfit',
      unlockAffection: Number.isFinite(Number(e.unlockAffection))
        ? Math.max(0, Math.min(100, Math.round(Number(e.unlockAffection))))
        : undefined,
      requiredFlags: normalizeStringArray(e.requiredFlags),
      // Wardrobe shop. Clamped rather than trusted, same as `unlockAffection` above — this is a
      // price the client sends, and it is the whole gate on a purchasable outfit.
      price: Number.isFinite(Number(e.price)) ? Math.max(0, Math.min(999, Math.round(Number(e.price)))) : undefined,
      manualOnly: e.manualOnly === true,
      intimate: e.intimate === true,
    }))
    .filter((e) => /^[a-z0-9][a-z0-9-]{0,39}$/.test(e.id) && e.id !== 'base' && !e.id.includes('--'))
  // A duplicate id would make two outfits fight over the same sprite keys.
  const seen = new Set<string>()
  const unique = entries.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
  return unique.length ? unique : undefined
}

/** A world's own content rating (`WorldCard.intimacyLevel`); an unrecognized value falls back to "inherit the global setting". */
function normalizeIntimacyLevel(raw: unknown) {
  return raw === 'default' || raw === 'fade_to_black' || raw === 'suggestive' || raw === 'explicit' ? raw : undefined
}

/** `null` means "inherit the global setting" and must map to `undefined` here, since `'intimacyLevel' in req.body` needs the key present to clear it. */
function normalizeClearableIntimacyLevel(raw: unknown) {
  return raw === null ? undefined : normalizeIntimacyLevel(raw)
}

/** A world's author-defined triggers (`src/lib/world/triggers.ts`); malformed rules and unknown condition/action kinds are dropped rather than stored dead. */
function normalizeTriggers(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const STATS = new Set(['affection', 'warmth', 'trust', 'chemistry', 'comfort', 'respect', 'curiosity', 'tension'])
  const COMMITMENTS = new Set(['none', 'dating', 'exclusive', 'living_together', 'married'])
  const num = (v: unknown, lo: number, hi: number) =>
    Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : null
  const str = (v: unknown, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

  const condition = (c: unknown) => {
    if (!c || typeof c !== 'object') return null
    const o = c as Record<string, unknown>
    if ((o.kind === 'stat_at_least' || o.kind === 'stat_below') && STATS.has(String(o.stat))) {
      const value = num(o.value, 0, 100)
      return value === null ? null : { kind: o.kind, stat: o.stat, value }
    }
    if (o.kind === 'flag_set') {
      const flag = str(o.flag, 60)
      return flag ? { kind: 'flag_set', flag } : null
    }
    if (o.kind === 'commitment_at_least' && COMMITMENTS.has(String(o.status))) {
      return { kind: 'commitment_at_least', status: o.status }
    }
    if (o.kind === 'day_at_least') {
      const day = num(o.day, 0, 100000)
      return day === null ? null : { kind: 'day_at_least', day }
    }
    if (o.kind === 'trigger_fired') {
      const triggerId = str(o.triggerId, 80)
      return triggerId ? { kind: 'trigger_fired', triggerId } : null
    }
    return null
  }

  const action = (a: unknown) => {
    if (!a || typeof a !== 'object') return null
    const o = a as Record<string, unknown>
    if (o.kind === 'set_flag') {
      const flag = str(o.flag, 60)
      return flag ? { kind: 'set_flag', flag } : null
    }
    if (o.kind === 'remember' || o.kind === 'notify' || o.kind === 'style_guidance') {
      const text = str(o.text, 300)
      return text ? { kind: o.kind, text } : null
    }
    if (o.kind === 'social_reaction') {
      const topic = str(o.topic, 200)
      return topic ? { kind: 'social_reaction', topic } : null
    }
    if (o.kind === 'start_scene') {
      const title = str(o.title, 120)
      const objectiveTitle = str(o.objectiveTitle, 120)
      if (!title || !objectiveTitle) return null
      const description = str(o.description, 500) ?? ''
      const objectiveDescription = str(o.objectiveDescription, 500)
      return { kind: 'start_scene', title, description, objectiveTitle, ...(objectiveDescription ? { objectiveDescription } : {}) }
    }
    return null
  }

  const seen = new Set<string>()
  const entries = raw
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      id: typeof t.id === 'string' ? t.id.trim() : '',
      label: str(t.label, 80) ?? 'Trigger',
      enabled: t.enabled !== false,
      repeatable: t.repeatable === true,
      when: Array.isArray(t.when) ? t.when.map(condition).filter(Boolean) : [],
      then: Array.isArray(t.then) ? t.then.map(action).filter(Boolean) : [],
    }))
    // A rule with no surviving conditions or actions is broken, not disabled — drop it.
    .filter((t) => !!t.id && t.when.length > 0 && t.then.length > 0)
    .filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)))
  return entries.length ? entries : undefined
}

/** A world's own scene locations beyond the 12 built-in defaults — same shape/validation as `normalizeCustomExpressions` above. */
function normalizeCustomBackgrounds(raw: unknown) {
  if (!Array.isArray(raw)) return undefined
  const entries = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      id: typeof e.id === 'string' ? e.id.trim() : '',
      label: typeof e.label === 'string' && e.label.trim() ? e.label.trim() : 'Custom',
    }))
    .filter((e) => !!e.id)
  return entries.length ? entries : undefined
}

const RELATIONSHIP_STAGES = new Set(['near_strangers', 'acquaintances', 'warming_up', 'getting_close', 'close', 'sweethearts'])

/** Item 10's `GalleryEntry.autoTrigger` — a discriminated union, so validation checks `kind` before trusting the field it implies. */
function normalizeCgTrigger(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return undefined
  const t = raw as Record<string, unknown>
  if (t.kind === 'intimacyPhase' && (t.phase === 'building' || t.phase === 'peak')) return { kind: 'intimacyPhase', phase: t.phase }
  if (t.kind === 'catalogAction' && typeof t.optionId === 'string' && t.optionId.trim()) return { kind: 'catalogAction', optionId: t.optionId.trim() }
  if (t.kind === 'sceneFlag' && typeof t.flag === 'string' && t.flag.trim()) return { kind: 'sceneFlag', flag: t.flag.trim() }
  if (t.kind === 'relationshipStage' && RELATIONSHIP_STAGES.has(t.stage as string)) return { kind: 'relationshipStage', stage: t.stage }
  return undefined
}

function normalizeGalleryEntries(id: string, galleryRaw: unknown) {
  if (!Array.isArray(galleryRaw)) return []
  const mapInput: Record<string, string> = {}
  const variantsInput: Record<string, unknown> = {}
  const entries = galleryRaw
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map((g, i) => {
      const gid = typeof g.id === 'string' && g.id.trim() ? g.id.trim() : `cg-${i}`
      const imageUrl = typeof g.imageUrl === 'string' ? g.imageUrl : ''
      if (imageUrl) mapInput[gid] = imageUrl
      if (Array.isArray(g.variants)) variantsInput[gid] = g.variants
      return {
        id: gid,
        title: typeof g.title === 'string' ? g.title : `CG ${i + 1}`,
        imageUrl,
        unlockAffection: Number(g.unlockAffection ?? 0),
        unlockHint: typeof g.unlockHint === 'string' ? g.unlockHint : undefined,
        requiredFlags: Array.isArray(g.requiredFlags)
          ? g.requiredFlags.filter((f): f is string => typeof f === 'string' && !!f.trim())
          : undefined,
        isEnding: g.isEnding === true ? true : undefined,
        autoTrigger: normalizeCgTrigger(g.autoTrigger),
      }
    })
  const resolvedMap = resolveAvatarMap('characters', 'gallery', id, mapInput) ?? {}
  const resolvedVariants = resolveAvatarMapVariants('characters', 'gallery', id, variantsInput) ?? {}
  // Entries with no imageUrl yet are kept, not dropped — GalleryView renders that safely as a placeholder.
  return entries.map((g) => ({
    ...g,
    imageUrl: resolvedMap[g.id] || g.imageUrl,
    variants: resolvedVariants[g.id]?.length ? resolvedVariants[g.id] : undefined,
  }))
}

const GIFT_RARITIES = new Set(['common', 'uncommon', 'rare', 'epic'])

function normalizeGiftItems(raw: unknown) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .map((g, i) => ({
      id: typeof g.id === 'string' && g.id.trim() ? g.id.trim() : `gift-${i}`,
      name: typeof g.name === 'string' && g.name.trim() ? g.name.trim() : `Gift ${i + 1}`,
      rarity: GIFT_RARITIES.has(g.rarity as string) ? (g.rarity as string) : 'common',
      price: Math.max(0, Number(g.price) || 0),
      tags: Array.isArray(g.tags) ? g.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [],
    }))
}

const RELATIONSHIP_DELTA_KEYS = new Set(['affection', 'trust', 'chemistry', 'comfort', 'respect', 'curiosity', 'tension'])
/** Flags always available regardless of world; a world's `customSceneFlags` extend this set (see `normalizeItemDefs`'s `allowedFlags`). */
const DEFAULT_SCENE_FLAGS = new Set(['first_date', 'confession', 'jealousy', 'promise'])

/** Drops any entry missing a label; empty descriptions are allowed. */
function normalizeCustomSceneFlags(raw: unknown): { id: string; label: string; description: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .map((f, i) => ({
      id: typeof f.id === 'string' && f.id.trim() ? f.id.trim() : `flag-${i}`,
      label: typeof f.label === 'string' ? f.label.trim() : '',
      description: typeof f.description === 'string' ? f.description.trim() : '',
    }))
    .filter((f) => !!f.label)
}

/** Validates an item's effect union; a "Set scene flag" referencing an id outside `allowedFlags` falls through to the default relationship-nudge branch. */
function normalizeItemEffect(
  raw: unknown,
  allowedFlags: Set<string>,
): { kind: string; dimension?: string; flag?: string; amount?: number } {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (obj.kind === 'flag' && allowedFlags.has(obj.flag as string)) {
    return { kind: 'flag', flag: obj.flag as string }
  }
  if (obj.kind === 'currency') {
    return { kind: 'currency', amount: Math.max(0, Number(obj.amount) || 0) }
  }
  const dimension = RELATIONSHIP_DELTA_KEYS.has(obj.dimension as string) ? (obj.dimension as string) : 'affection'
  const amount = Number(obj.amount)
  // Round rather than reject a fractional amount, so it isn't silently replaced with a fixed 1.
  return {
    kind: 'relationship',
    dimension,
    amount: Number.isFinite(amount) ? Math.max(-10, Math.min(10, Math.round(amount))) : 1,
  }
}

function normalizeItemDefs(raw: unknown, allowedFlags: Set<string>) {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
    .map((i, idx) => ({
      id: typeof i.id === 'string' && i.id.trim() ? i.id.trim() : `item-${idx}`,
      name: typeof i.name === 'string' && i.name.trim() ? i.name.trim() : `Item ${idx + 1}`,
      rarity: GIFT_RARITIES.has(i.rarity as string) ? (i.rarity as string) : 'common',
      price: Math.max(0, Number(i.price) || 0),
      tags: Array.isArray(i.tags) ? i.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [],
      description: typeof i.description === 'string' ? i.description : undefined,
      effect: normalizeItemEffect(i.effect, allowedFlags),
    }))
}

/** A deduped array of non-empty string ids, always an array (never undefined) — for World Info book scoping. */
function normalizeIdArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim()))]
}

/** A trimmed, non-empty-string array or undefined — used for the free-text `giftLikes`/`giftDislikes` lists. */
function normalizeStringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const cleaned = raw.filter((v): v is string => typeof v === 'string' && !!v.trim()).map((v) => v.trim())
  return cleaned.length > 0 ? cleaned : undefined
}

/** Drops any entry missing a name — the one field a connection is meaningless without. */
function normalizeSocialConnections(raw: unknown): { id: string; name: string; relation: string; notes?: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const entries = raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c, i) => ({
      id: typeof c.id === 'string' && c.id.trim() ? c.id.trim() : `conn-${i}`,
      name: typeof c.name === 'string' ? c.name.trim() : '',
      relation: typeof c.relation === 'string' ? c.relation.trim() : '',
      notes: typeof c.notes === 'string' && c.notes.trim() ? c.notes.trim() : undefined,
    }))
    .filter((c) => !!c.name)
  return entries.length > 0 ? entries : undefined
}

/** Drops any entry missing `then` — the one field a rule is meaningless without. */
function normalizeBehavioralRules(raw: unknown): { id: string; kind: 'when_then' | 'never'; when?: string; then: string }[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const entries = raw
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
    .map((r, i) => ({
      id: typeof r.id === 'string' && r.id.trim() ? r.id.trim() : `rule-${i}`,
      kind: r.kind === 'never' ? ('never' as const) : ('when_then' as const),
      when: typeof r.when === 'string' && r.when.trim() ? r.when.trim() : undefined,
      then: typeof r.then === 'string' ? r.then.trim() : '',
    }))
    .filter((r) => !!r.then)
  return entries.length > 0 ? entries : undefined
}

/** `Character.touchProfile`: a per-region 0-3 score map plus limit lists. Unknown regions are the client's
 *  problem to filter; this only enforces shape, so an imported card can't corrupt the record. */
function normalizeTouchProfile(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const numberMap = (value: unknown): Record<string, number> | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const out: Record<string, number> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    }
    return Object.keys(out).length ? out : undefined
  }
  const profile: Record<string, unknown> = {}
  const sensitivity = numberMap(src.sensitivity)
  if (sensitivity) profile.sensitivity = sensitivity
  const offLimits = normalizeStringArray(src.offLimits)
  if (offLimits) profile.offLimits = offLimits
  const gated = numberMap(src.gated)
  if (gated) profile.gated = gated
  return Object.keys(profile).length ? profile : undefined
}

/** `Character.kinkProfile`: valence scores plus hard limits. Same shape-only contract as above. */
function normalizeKinkProfile(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const src = raw as Record<string, unknown>
  const profile: Record<string, unknown> = {}
  if (src.valence && typeof src.valence === 'object') {
    const valence: Record<string, number> = {}
    for (const [kink, v] of Object.entries(src.valence as Record<string, unknown>)) {
      if (typeof v === 'number' && v >= -2 && v <= 2) valence[kink] = Math.round(v)
    }
    if (Object.keys(valence).length) profile.valence = valence
  }
  const hardLimits = normalizeStringArray(src.hardLimits)
  if (hardLimits) profile.hardLimits = hardLimits
  return Object.keys(profile).length ? profile : undefined
}

/** `Character.voiceFingerprint`: trims free-typed speech-pattern fields, dropping empties. */
function normalizeVoiceFingerprint(
  raw: unknown,
): { verbalTics?: string[]; catchphrases?: string[]; dialectNotes?: string; sentenceRhythm?: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const result: { verbalTics?: string[]; catchphrases?: string[]; dialectNotes?: string; sentenceRhythm?: string } = {}
  const verbalTics = normalizeStringArray(obj.verbalTics)
  const catchphrases = normalizeStringArray(obj.catchphrases)
  if (verbalTics) result.verbalTics = verbalTics
  if (catchphrases) result.catchphrases = catchphrases
  if (typeof obj.dialectNotes === 'string' && obj.dialectNotes.trim()) result.dialectNotes = obj.dialectNotes.trim()
  if (typeof obj.sentenceRhythm === 'string' && obj.sentenceRhythm.trim()) result.sentenceRhythm = obj.sentenceRhythm.trim()
  return Object.keys(result).length > 0 ? result : undefined
}

const OUTREACH_FREQUENCIES = new Set(['never', 'rare', 'normal', 'eager'])

/** Rejects an unrecognized frequency rather than letting it fall through as `undefined`, which would make the character permanently eligible. */
function normalizeOutreach(raw: unknown): { frequency: string } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const frequency = (raw as Record<string, unknown>).frequency
  return typeof frequency === 'string' && OUTREACH_FREQUENCIES.has(frequency) ? { frequency } : undefined
}

/** `Character.birthday` — a day-of-year (world/calendar.ts's 112-day year), clamped/rounded rather
 *  than rejected outright so a stray out-of-range value from the client still lands somewhere sane. */
function normalizeDayOfYear(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.min(111, Math.round(raw))) : undefined
}

const REPLY_LENGTHS = new Set(['auto', 'brief', 'moderate', 'detailed'])

/** 'auto' and unset both mean "measure the card"; only the three explicit bands are stored. */
function normalizeReplyLength(raw: unknown): string | undefined {
  return typeof raw === 'string' && REPLY_LENGTHS.has(raw) && raw !== 'auto' ? raw : undefined
}

function normalizeRelationshipThresholds(raw: unknown) {
  if (!raw || typeof raw !== 'object') return undefined
  const obj = raw as Record<string, unknown>
  const result: Record<string, number> = {}
  for (const stage of ['acquaintances', 'warming_up', 'getting_close', 'close', 'sweethearts']) {
    if (typeof obj[stage] === 'number') result[stage] = Math.max(0, Math.min(100, obj[stage] as number))
  }
  return Object.keys(result).length > 0 ? result : undefined
}

// ---- Characters ----

// ---- LuxTTS voice relay (server/luxtts.ts) ----

app.get('/api/voice-samples', (_req, res) => {
  res.json(listVoiceSamples())
})

app.post('/api/voice-samples', (req, res) => {
  res.status(201).json(addVoiceSample(req.body.label, req.body.dataUrl))
})

app.get('/api/tts/luxtts/status', async (_req, res) => {
  res.json(await luxttsStatus())
})

app.post('/api/tts/luxtts', async (req, res) => {
  const controller = new AbortController()
  const disconnect = () => { if (!res.writableEnded) controller.abort() }
  res.on('close', disconnect)
  try {
    const { audio, contentType } = await luxttsSpeak(req.body ?? {}, controller.signal)
    if (!controller.signal.aborted) res.type(contentType).send(audio)
  } catch (e) {
    if (!controller.signal.aborted) {
      const status = (e as { status?: number }).status ?? 502
      res.status(status).json({ error: e instanceof Error ? e.message : 'LuxTTS request failed' })
    }
  } finally {
    res.off('close', disconnect)
  }
})

app.get('/api/vrm-library', (_req, res) => {
  res.json(listVrmLibrary())
})

app.get('/api/characters', (_req, res) => {
  res.json(characterStore.list({ orderBy: 'updatedAt DESC' }))
})

// Lightweight public cast list for the GM. Card prompts, private memories, and artwork never leave this route.
app.get('/api/characters/roster', (req, res) => {
  const worldId = typeof req.query.worldId === 'string' ? req.query.worldId : ''
  if (!worldId) return res.status(400).json({ error: 'worldId is required' })
  res.json(characterStore.list({ where: 'worldId = ?', params: [worldId] }).map((c) => ({
    id: c.id,
    name: (c.card as { name?: string } | undefined)?.name ?? '',
    occupation: c.occupation,
    // A "you only" card is never voiced by the AI, so the GM can't cast it either.
    gmEligible: c.gmEligible !== false && c.playerOnly !== true,
    playerOnly: c.playerOnly === true,
    // Their standing in this world, so the GM can scale what they can do.
    rank: sheetForWorld(c as Parameters<typeof sheetForWorld>[0], worldId)?.rank,
  })))
})

app.get('/api/characters/:id', (req, res) => {
  const row = characterStore.get(req.params.id)
  if (!row) return notFound(res)
  res.json(row)
})

function normalizePlayerDescription(raw: unknown): string | undefined {
  return typeof raw === 'string' ? raw.slice(0, 20_000) || undefined : undefined
}

app.post('/api/characters', (req, res) => {
  const now = Date.now()
  const id = newId()
  const avatarDataUrl = resolveAvatar('characters', id, req.body.avatarDataUrl)
  const sprites = resolveAvatarMap('characters', 'sprites', id, req.body.sprites)
  const spriteVariants = resolveAvatarMapVariants('characters', 'sprites', id, req.body.spriteVariants)
  const gallery = normalizeGalleryEntries(id, req.body.gallery)
  const created = characterStore.insert({
    id,
    card: req.body.card,
    promptItems: normalizePromptItems(req.body.promptItems),
    privateMemory: typeof req.body.privateMemory === 'string' ? req.body.privateMemory.slice(0, 100_000) : undefined,
    modelOverride: typeof req.body.modelOverride === 'string' ? req.body.modelOverride.trim().slice(0, 200) || undefined : undefined,
    playerOnly: req.body.playerOnly === true || undefined,
    playerDescription: normalizePlayerDescription(req.body.playerDescription),
    sheet: normalizeCharacterSheet(req.body.sheet),
    sheets: normalizeCharacterSheets(req.body.sheets),
    vrm: normalizeVrm(id, req.body.vrm),
    spriteSources: normalizeSpriteSources(req.body.spriteSources),
    avatarDataUrl,
    sprites,
    spriteVariants,
    spriteUnlocks: req.body.spriteUnlocks ?? {},
    outfits: normalizeOutfits(req.body.outfits),
    customExpressions: normalizeCustomExpressions(req.body.customExpressions),
    giftPreferences: req.body.giftPreferences ?? {},
    giftLikes: normalizeStringArray(req.body.giftLikes),
    giftDislikes: normalizeStringArray(req.body.giftDislikes),
    loveLanguage: typeof req.body.loveLanguage === 'string' ? req.body.loveLanguage : undefined,
    explicitVoiceNote: typeof req.body.explicitVoiceNote === 'string' ? req.body.explicitVoiceNote : undefined,
    gallery,
    relationshipStarters: req.body.relationshipStarters ?? [],
    voice: req.body.voice ?? undefined,
    voiceFingerprint: normalizeVoiceFingerprint(req.body.voiceFingerprint),
    sfxWords: normalizeStringArray(req.body.sfxWords),
    instructTemplateId: typeof req.body.instructTemplateId === 'string' ? req.body.instructTemplateId : undefined,
    replyLength: normalizeReplyLength(req.body.replyLength),
    weatherPreferences: req.body.weatherPreferences ?? undefined,
    schedule: Array.isArray(req.body.schedule) ? req.body.schedule : undefined,
    worldId: req.body.worldId || undefined,
    likes: normalizeStringArray(req.body.likes),
    goals: normalizeStringArray(req.body.goals),
    boundaries: normalizeStringArray(req.body.boundaries),
    socialConnections: normalizeSocialConnections(req.body.socialConnections),
    behavioralRules: normalizeBehavioralRules(req.body.behavioralRules),
    touchProfile: normalizeTouchProfile(req.body.touchProfile),
    kinkProfile: normalizeKinkProfile(req.body.kinkProfile),
    occupation: typeof req.body.occupation === 'string' ? req.body.occupation : undefined,
    workplace: typeof req.body.workplace === 'string' ? req.body.workplace : undefined,
    homeLocation: typeof req.body.homeLocation === 'string' ? req.body.homeLocation : undefined,
    birthday: normalizeDayOfYear(req.body.birthday),
    frequentedLocations: normalizeStringArray(req.body.frequentedLocations),
    dateModeOptOut: req.body.dateModeOptOut === true,
    outreach: normalizeOutreach(req.body.outreach),
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/characters/:id', (req, res) => {
  const id = req.params.id
  if (!characterStore.get(id)) return notFound(res)
  const patch: Record<string, unknown> = { updatedAt: Date.now() }
  if ('card' in req.body) patch.card = req.body.card
  if ('promptItems' in req.body) patch.promptItems = normalizePromptItems(req.body.promptItems)
  if ('privateMemory' in req.body) patch.privateMemory = typeof req.body.privateMemory === 'string' ? req.body.privateMemory.slice(0, 100_000) : undefined
  if ('modelOverride' in req.body) patch.modelOverride = typeof req.body.modelOverride === 'string' ? req.body.modelOverride.trim().slice(0, 200) || undefined : undefined
  if ('playerOnly' in req.body) patch.playerOnly = req.body.playerOnly === true || undefined
  if ('playerDescription' in req.body) patch.playerDescription = normalizePlayerDescription(req.body.playerDescription)
  if ('sheet' in req.body) patch.sheet = normalizeCharacterSheet(req.body.sheet)
  if ('sheets' in req.body) patch.sheets = normalizeCharacterSheets(req.body.sheets)
  if ('worldId' in req.body) patch.worldId = req.body.worldId || undefined
  if ('avatarDataUrl' in req.body) patch.avatarDataUrl = resolveAvatar('characters', id, req.body.avatarDataUrl)
  if ('sprites' in req.body) patch.sprites = resolveAvatarMap('characters', 'sprites', id, req.body.sprites)
  if ('spriteVariants' in req.body) patch.spriteVariants = resolveAvatarMapVariants('characters', 'sprites', id, req.body.spriteVariants)
  if ('spriteUnlocks' in req.body) patch.spriteUnlocks = req.body.spriteUnlocks ?? {}
  if ('spriteSources' in req.body) patch.spriteSources = normalizeSpriteSources(req.body.spriteSources)
  if ('vrm' in req.body) patch.vrm = normalizeVrm(id, req.body.vrm)
  if ('outfits' in req.body) patch.outfits = normalizeOutfits(req.body.outfits)
  if ('customExpressions' in req.body) patch.customExpressions = normalizeCustomExpressions(req.body.customExpressions)
  if ('giftPreferences' in req.body) patch.giftPreferences = req.body.giftPreferences ?? {}
  if ('giftLikes' in req.body) patch.giftLikes = normalizeStringArray(req.body.giftLikes)
  if ('giftDislikes' in req.body) patch.giftDislikes = normalizeStringArray(req.body.giftDislikes)
  if ('loveLanguage' in req.body) patch.loveLanguage = typeof req.body.loveLanguage === 'string' ? req.body.loveLanguage : undefined
  if ('explicitVoiceNote' in req.body) patch.explicitVoiceNote = typeof req.body.explicitVoiceNote === 'string' ? req.body.explicitVoiceNote : undefined
  if ('gallery' in req.body) patch.gallery = normalizeGalleryEntries(id, req.body.gallery)
  if ('relationshipStarters' in req.body) patch.relationshipStarters = req.body.relationshipStarters ?? []
  if ('voice' in req.body) patch.voice = req.body.voice ?? undefined
  if ('voiceFingerprint' in req.body) patch.voiceFingerprint = normalizeVoiceFingerprint(req.body.voiceFingerprint)
  if ('sfxWords' in req.body) patch.sfxWords = normalizeStringArray(req.body.sfxWords)
  if ('instructTemplateId' in req.body) patch.instructTemplateId = typeof req.body.instructTemplateId === 'string' ? req.body.instructTemplateId : undefined
  if ('replyLength' in req.body) patch.replyLength = normalizeReplyLength(req.body.replyLength)
  if ('weatherPreferences' in req.body) patch.weatherPreferences = req.body.weatherPreferences ?? undefined
  if ('schedule' in req.body) patch.schedule = Array.isArray(req.body.schedule) ? req.body.schedule : undefined
  if ('likes' in req.body) patch.likes = normalizeStringArray(req.body.likes)
  if ('goals' in req.body) patch.goals = normalizeStringArray(req.body.goals)
  if ('boundaries' in req.body) patch.boundaries = normalizeStringArray(req.body.boundaries)
  if ('socialConnections' in req.body) patch.socialConnections = normalizeSocialConnections(req.body.socialConnections)
  if ('behavioralRules' in req.body) patch.behavioralRules = normalizeBehavioralRules(req.body.behavioralRules)
  if ('touchProfile' in req.body) patch.touchProfile = normalizeTouchProfile(req.body.touchProfile)
  if ('kinkProfile' in req.body) patch.kinkProfile = normalizeKinkProfile(req.body.kinkProfile)
  if ('occupation' in req.body) patch.occupation = typeof req.body.occupation === 'string' ? req.body.occupation : undefined
  if ('workplace' in req.body) patch.workplace = typeof req.body.workplace === 'string' ? req.body.workplace : undefined
  if ('homeLocation' in req.body) patch.homeLocation = typeof req.body.homeLocation === 'string' ? req.body.homeLocation : undefined
  if ('birthday' in req.body) patch.birthday = normalizeDayOfYear(req.body.birthday)
  if ('frequentedLocations' in req.body) patch.frequentedLocations = normalizeStringArray(req.body.frequentedLocations)
  if ('dateModeOptOut' in req.body) patch.dateModeOptOut = req.body.dateModeOptOut === true
  if ('outreach' in req.body) patch.outreach = normalizeOutreach(req.body.outreach)
  const updated = characterStore.update(id, patch)
  res.json(updated)
})

app.delete('/api/characters/:id', (req, res) => {
  const characterId = req.params.id
  // The character is gone for good, so there's no useful "trash" state — purge its chats directly.
  const chats = chatStore.list({ where: 'characterId = ?', params: [characterId] })
  for (const chat of chats) purgeChat(chat.id as string)
  // A character can also appear as a group-chat participant (a full scan — `participants` isn't an
  // indexed column); drop the dangling id and any tracked relationship for it instead of deleting the chat.
  for (const chat of chatStore.list()) {
    const participants = chat.participants as string[] | undefined
    const participantRelationships = chat.participantRelationships as Record<string, unknown> | undefined
    const patch: Record<string, unknown> = {}
    if (participants?.includes(characterId)) patch.participants = participants.filter((id) => id !== characterId)
    if (participantRelationships && characterId in participantRelationships) {
      const { [characterId]: _dropped, ...rest } = participantRelationships
      patch.participantRelationships = rest
    }
    if (Object.keys(patch).length > 0) chatStore.update(chat.id as string, patch)
  }
  // Removes the whole per-character folder in one shot (avatar, sprites, gallery — see avatars.ts).
  removeAvatar('characters', characterId)
  characterStore.remove(characterId)
  res.status(204).end()
})

// ---- Personas (legacy) ----
// Personas were folded into character cards (`migrations/mergePersonas.ts`); the app plays cards
// now. These routes stay so old ids can be mapped (`migratedToCharacterId`) and nothing that still
// calls them breaks, but no current screen creates or edits a persona.

/**
 * A persona linked to a character (TavernAI-style "play as any character") takes that card's name
 * and portrait live. Its description stays the persona's own public blurb, falling back to the
 * card's description — never the character's private prompts or memory, which would otherwise
 * reach every other character's prompt as `{{user}}` context.
 */
function resolvePersona(row: Record<string, unknown>) {
  if (typeof row.characterId !== 'string') return row
  const character = characterStore.get(row.characterId)
  if (!character) return { ...row, characterMissing: true }
  const card = (character.card ?? {}) as Record<string, unknown>
  const own = typeof row.description === 'string' ? row.description.trim() : ''
  return {
    ...row,
    name: (typeof card.name === 'string' && card.name) || row.name,
    avatarDataUrl: character.avatarDataUrl ?? row.avatarDataUrl,
    description: own || (typeof card.description === 'string' ? card.description : ''),
  }
}

function linkedCharacterId(raw: unknown): string | undefined {
  return typeof raw === 'string' && characterStore.get(raw) ? raw : undefined
}

app.get('/api/personas', (_req, res) => {
  res.json(personaStore.list({ orderBy: 'createdAt' }).map(resolvePersona))
})

app.get('/api/personas/:id', (req, res) => {
  const row = personaStore.get(req.params.id)
  if (!row) return notFound(res)
  res.json(resolvePersona(row))
})

app.post('/api/personas', (req, res) => {
  const id = newId()
  const avatarDataUrl = resolveAvatar('personas', id, req.body.avatarDataUrl)
  const characterId = linkedCharacterId(req.body.characterId)
  if (req.body.characterId && !characterId) return res.status(400).json({ error: 'That character no longer exists.' })
  const linkedName = characterId ? ((characterStore.get(characterId)?.card as Record<string, unknown> | undefined)?.name as string | undefined) : undefined
  const created = personaStore.insert({
    id,
    name: req.body.name || linkedName || 'You',
    description: req.body.description,
    avatarDataUrl,
    characterId,
    createdAt: Date.now(),
  })
  res.status(201).json(resolvePersona(created))
})

app.put('/api/personas/:id', (req, res) => {
  const id = req.params.id
  if (!personaStore.get(id)) return notFound(res)
  const patch: Record<string, unknown> = {}
  if ('name' in req.body) patch.name = req.body.name
  if ('description' in req.body) patch.description = req.body.description
  if ('avatarDataUrl' in req.body) patch.avatarDataUrl = resolveAvatar('personas', id, req.body.avatarDataUrl)
  if ('characterId' in req.body) {
    patch.characterId = linkedCharacterId(req.body.characterId)
    if (req.body.characterId && !patch.characterId) return res.status(400).json({ error: 'That character no longer exists.' })
  }
  const updated = personaStore.update(id, patch)
  res.json(updated && resolvePersona(updated))
})

app.delete('/api/personas/:id', (req, res) => {
  const personaId = req.params.id
  // `Chat.personaId` isn't indexed, so a full scan; clear dangling refs to avoid a silent 404 on load.
  for (const chat of chatStore.list()) {
    // Cleared to '' (not null/undefined) to stay a valid value of its required-string type.
    if (chat.personaId === personaId) chatStore.update(chat.id as string, { personaId: '' })
  }
  removeAvatar('personas', personaId)
  personaStore.remove(personaId)
  res.status(204).end()
})

// ---- Chats ----

// How long a deleted chat sits recoverable before `purgeExpiredTrash` purges it for real (called at server startup).
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/** Permanent cascading delete: messages/objectives/relationship events/facts, un-parents any fork, then the chat row. */
function purgeChat(chatId: string): void {
  for (const msg of messageStore.list({ where: 'chatId = ?', params: [chatId] })) messageStore.remove(msg.id as string)
  for (const o of objectiveStore.list({ where: 'chatId = ?', params: [chatId] })) objectiveStore.remove(o.id as string)
  for (const e of relationshipEventStore.list({ where: 'chatId = ?', params: [chatId] })) relationshipEventStore.remove(e.id as string)
  for (const f of chatFactStore.list({ where: 'chatId = ?', params: [chatId] })) chatFactStore.remove(f.id as string)
  // Un-parent any chat forked from this one (parentChatId isn't indexed, so a full scan).
  for (const chat of chatStore.list()) {
    if (chat.parentChatId !== chatId) continue
    chatStore.update(chat.id as string, { parentChatId: undefined, forkedFromMessageId: undefined })
  }
  chatStore.remove(chatId)
}

/** Called once at server startup — purges anything that's been sitting in the trash past `TRASH_RETENTION_MS`. */
export function purgeExpiredTrash(): void {
  const cutoff = Date.now() - TRASH_RETENTION_MS
  const expired = chatStore.list().filter((c) => typeof c.deletedAt === 'number' && c.deletedAt < cutoff)
  for (const chat of expired) purgeChat(chat.id as string)
  if (expired.length) console.log(`[rp-server] purged ${expired.length} chat(s) past the ${TRASH_RETENTION_MS / 86400000}-day trash retention window`)
}

app.get('/api/chats', (_req, res) => {
  res.json(chatStore.list({ orderBy: 'updatedAt DESC' }).filter((c) => !c.deletedAt))
})

// Registered before `/api/chats/:id`, or Express would match "trash" as an :id.
app.get('/api/chats/trash', (_req, res) => {
  const trashed = chatStore
    .list()
    .filter((c) => typeof c.deletedAt === 'number')
    .sort((a, b) => (b.deletedAt as number) - (a.deletedAt as number))
  res.json(trashed)
})

app.get('/api/chats/:id', (req, res) => {
  const row = chatStore.get(req.params.id)
  if (!row) return notFound(res)
  res.json(row)
})

app.get('/api/chats/:id/messages', (req, res) => {
  res.json(messageStore.list({ where: 'chatId = ?', params: [req.params.id], orderBy: 'createdAt' }))
})

app.post('/api/chats', (req, res) => {
  const now = Date.now()
  const created = chatStore.insert({
    id: newId(),
    characterId: req.body.characterId,
    participants: Array.isArray(req.body.participants) && req.body.participants.length ? req.body.participants : undefined,
    playerCharacterId: typeof req.body.playerCharacterId === 'string' && req.body.playerCharacterId ? req.body.playerCharacterId : undefined,
    personaId: typeof req.body.personaId === 'string' && req.body.personaId ? req.body.personaId : undefined,
    title: req.body.title,
    affection: Number(req.body.affection ?? 0),
    relationshipStats: req.body.relationshipStats ?? undefined,
    relationshipStage: req.body.relationshipStage ?? 'near_strangers',
    sceneFlags: Array.isArray(req.body.sceneFlags) ? req.body.sceneFlags : [],
    giftCoins: Number(req.body.giftCoins ?? 0),
    giftInventory: req.body.giftInventory ?? {},
    giftsGiven: req.body.giftsGiven ?? {},
    unlockedGalleryIds: Array.isArray(req.body.unlockedGalleryIds) ? req.body.unlockedGalleryIds : [],
    activeEvent: req.body.activeEvent,
    summary: req.body.summary || undefined,
    assistOverrides: req.body.assistOverrides ?? undefined,
    scene: req.body.scene ?? undefined,
    mode: req.body.mode ?? undefined,
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/chats/:id', (req, res) => {
  // skipTouch: 10f's outreach tick writes lastOutreachCheckedAt on every chat it evaluates,
  // whether or not a message actually landed — without this, that bookkeeping-only write would
  // bump updatedAt and reorder ChatsPanel (sorted by updatedAt DESC) for a chat nothing happened in.
  const { characterId: _c, id: _id, createdAt: _ca, skipTouch, ...patch } = req.body
  const updated = chatStore.update(req.params.id, {
    ...patch,
    ...(skipTouch ? {} : { updatedAt: Date.now() }),
  })
  if (!updated) return notFound(res)
  res.json(updated)
})

// Forks a chat at a given message (or its latest), copying relationship/gift/gallery state and the transcript up to that point.
app.post('/api/chats/:id/fork', (req, res) => {
  const sourceChatId = req.params.id
  const source = chatStore.get(sourceChatId)
  if (!source) return notFound(res)

  const allMessages = messageStore.list({ where: 'chatId = ?', params: [sourceChatId], orderBy: 'createdAt' })
  let cutoff = allMessages.length
  if (req.body.messageId) {
    const idx = allMessages.findIndex((m) => m.id === req.body.messageId)
    if (idx === -1) return res.status(400).json({ error: 'Message not found in this chat' })
    cutoff = idx + 1
  }
  const keptMessages = allMessages.slice(0, cutoff)
  const forkedFromMessageId = keptMessages[keptMessages.length - 1]?.id as string | undefined

  const now = Date.now()
  const newChatId = newId()
  // worldInfoState (turn-numbered bookkeeping) and rapport (a live-date scene read) don't carry over to a fork.
  // A fork of a scene is another take on that scene: it keeps its place in the story (storyId,
  // sceneNumber, previousSceneId) but is live again, so an ended scene's ending and recap stay behind.
  const { id: _id, createdAt: _ca, updatedAt: _ua, title, worldInfoState: _wis, rapport: _rap, endedAt: _end, recap: _rec, ...rest } = source
  const forkedChat = chatStore.insert({
    ...rest,
    id: newChatId,
    title: `${title} (fork)`,
    parentChatId: sourceChatId,
    forkedFromMessageId,
    createdAt: now,
    updatedAt: now,
  })

  for (const m of keptMessages) {
    const { id: _mid, ...mRest } = m
    messageStore.insert({ ...mRest, id: newId(), chatId: newChatId })
  }

  const activeObjective = objectiveStore.list({ where: 'chatId = ? AND status = ?', params: [sourceChatId, 'active'] })[0]
  if (activeObjective) {
    const { id: _oid, chatId: _ocid, createdAt: _oca, updatedAt: _oua, ...oRest } = activeObjective
    objectiveStore.insert({ ...oRest, id: newId(), chatId: newChatId, createdAt: now, updatedAt: now })
  }

  // Only events up to the fork point actually happened in this branch's shared past.
  const cutoffCreatedAt = keptMessages[keptMessages.length - 1]?.createdAt as number | undefined
  const sourceEvents = relationshipEventStore.list({ where: 'chatId = ?', params: [sourceChatId], orderBy: 'createdAt' })
  for (const e of sourceEvents) {
    if (cutoffCreatedAt !== undefined && (e.createdAt as number) > cutoffCreatedAt) continue
    const { id: _eid, chatId: _ecid, ...eRest } = e
    relationshipEventStore.insert({ ...eRest, id: newId(), chatId: newChatId })
  }

  // Same cutoff rule as events above.
  const sourceFacts = chatFactStore.list({ where: 'chatId = ?', params: [sourceChatId], orderBy: 'createdAt' })
  for (const f of sourceFacts) {
    if (cutoffCreatedAt !== undefined && (f.createdAt as number) > cutoffCreatedAt) continue
    const { id: _fid, chatId: _fcid, ...fRest } = f
    chatFactStore.insert({ ...fRest, id: newId(), chatId: newChatId })
  }

  res.status(201).json(forkedChat)
})

// Soft delete: drops out of the normal list but stays recoverable via `POST /:id/restore` until purged.
app.delete('/api/chats/:id', (req, res) => {
  const updated = chatStore.update(req.params.id, { deletedAt: Date.now() })
  if (!updated) return notFound(res)
  res.json(updated)
})

app.post('/api/chats/:id/restore', (req, res) => {
  const updated = chatStore.update(req.params.id, { deletedAt: null, updatedAt: Date.now() })
  if (!updated) return notFound(res)
  res.json(updated)
})

app.post('/api/chats/:id/roll', (req, res) => {
  const chat = chatStore.get(req.params.id)
  if (!chat) return notFound(res)
  let messageId: string
  let moveId: string
  let action: string
  let text: string
  const modifier = req.body?.modifier
  const target = req.body?.target
  const rollMode = req.body?.rollMode ?? 'normal'
  const pendingGmMessageId = req.body?.pendingGmMessageId
  try {
    messageId = requiredRollText(req.body?.messageId, 'Message id', 100)
    moveId = requiredRollText(req.body?.moveId, 'Move id', 100)
    action = requiredRollText(req.body?.action, 'Action', 500)
    text = requiredRollText(req.body?.text, 'Message', 10_000)
    if (!Number.isInteger(modifier) || modifier < -100 || modifier > 100) throw new Error('Sheet value must be an integer from -100 to 100.')
    if (target !== undefined && (!Number.isInteger(target) || target < -30 || target > 100)) throw new Error('Difficulty must be an integer from -30 to 100.')
    if (rollMode !== 'normal' && rollMode !== 'advantage' && rollMode !== 'disadvantage') throw new Error('Unknown roll mode.')
    if (pendingGmMessageId !== undefined && (typeof pendingGmMessageId !== 'string' || !pendingGmMessageId.trim() || pendingGmMessageId.length > 100)) throw new Error('Invalid pending GM message id.')
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message })
  }
  const request = { chatId: req.params.id, moveId, modifier: modifier as number, action, text, target: target as number | undefined, rollMode: rollMode as 'normal' | 'advantage' | 'disadvantage', pendingGmMessageId: pendingGmMessageId as string | undefined }
  const existing = messageStore.get(messageId)
  if (existing) return sameRollRequest(existing, request)
    ? res.json(existing)
    : res.status(409).json({ error: 'That message id already belongs to a different action.' })

  const character = typeof chat.characterId === 'string' ? characterStore.get(chat.characterId) : undefined
  const world = typeof character?.worldId === 'string' ? worldStore.get(character.worldId) : undefined
  const campaign = world?.campaign as CampaignConfig | undefined
  if (campaign?.mode !== 'mechanical') return res.status(400).json({ error: 'This chat has no mechanical campaign.' })
  const move = campaign.moves.find((entry) => entry.id === moveId)
  if (!move) return res.status(400).json({ error: 'That campaign move is no longer available.' })
  const latestMessage = messageStore.list({ where: 'chatId = ?', params: [req.params.id], orderBy: 'createdAt' }).at(-1)
  const pending = (latestMessage?.gm as { adjudication?: { source?: string; moveId?: string; target?: number } } | undefined)?.adjudication
  if (pending?.source === 'roll_needed') {
    if (pendingGmMessageId !== latestMessage?.id || pending.moveId !== moveId) return res.status(409).json({ error: 'Resolve the pending GM check before making another roll.' })
    if (pending.target !== undefined && (move.target ?? target) !== pending.target) return res.status(409).json({ error: 'The GM set a different difficulty for this check.' })
  } else if (pendingGmMessageId !== undefined) return res.status(409).json({ error: 'That GM check is no longer pending.' })
  const player = typeof chat.playerCharacterId === 'string' ? characterStore.get(chat.playerCharacterId) : undefined
  const sheet = typeof world?.id === 'string' ? sheetForWorld(player, world.id) : undefined
  const sheetStat = sheet ? statForMove(campaign, move) : undefined
  if (sheet) {
    if (!sheetStat) return res.status(400).json({ error: 'This move has no character sheet stat. Assign one in the world editor.' })
    const savedModifier = sheetModifier(campaign, move, sheet)
    if (savedModifier === undefined) return res.status(400).json({ error: `Set ${sheetStat.name} on the player character sheet before rolling.` })
    if (modifier !== savedModifier) return res.status(409).json({ error: `The ${sheetStat.name} roll value changed. Reopen the roll panel and try again.` })
  } else if (player?.sheet || player?.sheets && Object.keys(player.sheets).length) {
    return res.status(400).json({ error: 'This character needs a sheet for the story world. Add one in Cast.' })
  }
  if (campaign.resolver === 'pbta' && (modifier < -5 || modifier > 5)) return res.status(400).json({ error: '2d6 move modifiers must be from -5 to 5.' })
  if (campaign.resolver === 'roll-under' && modifier < 0) return res.status(400).json({ error: 'Roll-under targets cannot be negative.' })
  if (move.target !== undefined && target !== undefined && target !== move.target) return res.status(409).json({ error: 'This move has a fixed difficulty set by the world.' })
  if (campaign.resolver !== 'd20' && campaign.resolver !== 'd20-degree' && rollMode !== 'normal') return res.status(400).json({ error: 'Advantage is only available for d20 checks.' })
  const now = Date.now()
  const dice = campaign.resolver === 'pbta' ? [randomInt(1, 7), randomInt(1, 7)]
    : campaign.resolver === 'd20' || campaign.resolver === 'd20-degree' ? Array.from({ length: rollMode === 'normal' ? 1 : 2 }, () => randomInt(1, 21))
    : campaign.resolver === 'fate' ? Array.from({ length: 4 }, () => randomInt(-1, 2))
    : Array.from({ length: 3 }, () => randomInt(1, 7))
  let roll
  try {
    roll = {
      ...createResolvedCampaignRoll(campaign, move, modifier as number, dice, target as number | undefined, rollMode, action, newId(), now),
      modifierSource: sheet ? 'sheet' as const : 'manual' as const,
      ...(target !== undefined ? { requestedTarget: target as number } : {}),
      ...(pendingGmMessageId !== undefined ? { pendingGmMessageId: pendingGmMessageId as string } : {}),
      ...(sheetStat ? { sheetStatId: sheetStat.id } : {}),
    }
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message })
  }
  const card = player?.card as Record<string, unknown> | undefined
  const name = typeof card?.name === 'string' && card.name.trim() ? card.name : 'You'
  try {
    const created = messageStore.insert({ id: messageId, chatId: req.params.id, role: 'user', name, text, campaignRoll: roll, createdAt: now })
    return res.status(201).json(created)
  } catch (error) {
    // A concurrent retry may have won the unique message-id insert in another server process.
    const duplicate = messageStore.get(messageId)
    if (duplicate) return sameRollRequest(duplicate, request)
      ? res.json(duplicate)
      : res.status(409).json({ error: 'That message id already belongs to a different action.' })
    throw error
  }
})

// The real, permanent delete — reachable from the trash view, a deliberate second step after soft-delete.
app.delete('/api/chats/:id/purge', (req, res) => {
  const chatId = req.params.id
  if (!chatStore.get(chatId)) return notFound(res)
  purgeChat(chatId)
  res.status(204).end()
})

// ---- Messages ----

// Plain substring scan (not SQL LIKE) over every message. Registered before `/:id`, or Express would match "search" as an :id.
app.get('/api/messages/search', (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase()
  if (!q) return res.json([])
  const hits = messageStore
    .list({ orderBy: 'createdAt DESC' })
    .filter((m) => String(m.text ?? '').toLowerCase().includes(q))
    .slice(0, 50)
  res.json(hits)
})

app.get('/api/messages/:id', (req, res) => {
  const row = messageStore.get(req.params.id)
  if (!row) return notFound(res)
  res.json(row)
})

app.post('/api/messages', (req, res) => {
  if ('campaignRoll' in req.body) return res.status(409).json({ error: 'Use the server roll endpoint to record a campaign move.' })
  const created = messageStore.insert({ ...req.body, id: req.body.id || newId(), createdAt: req.body.createdAt ?? Date.now() })
  res.status(201).json(created)
})

app.put('/api/messages/:id', (req, res) => {
  const existing = messageStore.get(req.params.id)
  if (!existing) return notFound(res)
  const body = req.body
  if ('campaignRoll' in body) {
    return res.status(409).json({ error: 'A recorded campaign roll cannot be changed after the message is created.' })
  }
  if (existing.campaignRoll && (
    (body.chatId && body.chatId !== existing.chatId)
    || (body.role && body.role !== 'user')
    || ('text' in body && body.text !== existing.text)
  )) {
    return res.status(400).json({ error: 'A rolled action cannot change chat, role, or text. Rewind and roll again.' })
  }
  const updated = messageStore.update(req.params.id, body)
  res.json(updated)
})

app.delete('/api/messages/:id', (req, res) => {
  messageStore.remove(req.params.id)
  res.status(204).end()
})

// ---- World info books (global lorebooks) ----

app.get('/api/world-info-books', (_req, res) => {
  res.json(worldInfoBookStore.list({ orderBy: 'createdAt' }))
})

app.post('/api/world-info-books', (req, res) => {
  const created = worldInfoBookStore.insert({
    ...req.body,
    id: req.body.id || newId(),
    boundChatIds: normalizeIdArray(req.body.boundChatIds),
    boundCharacterIds: normalizeIdArray(req.body.boundCharacterIds),
    boundWorldIds: normalizeIdArray(req.body.boundWorldIds),
    createdAt: Date.now(),
  })
  res.status(201).json(created)
})

app.put('/api/world-info-books/:id', (req, res) => {
  const patch: Record<string, unknown> = { ...req.body }
  for (const key of ['boundChatIds', 'boundCharacterIds', 'boundWorldIds'] as const) {
    if (key in req.body) patch[key] = normalizeIdArray(req.body[key])
  }
  const updated = worldInfoBookStore.update(req.params.id, patch)
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/world-info-books/:id', (req, res) => {
  worldInfoBookStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Sampler presets ----

app.get('/api/presets', (_req, res) => {
  res.json(presetStore.list({ orderBy: 'createdAt' }))
})

app.post('/api/presets', (req, res) => {
  const created = presetStore.insert({ id: newId(), name: req.body.name, params: req.body.params, createdAt: Date.now() })
  res.status(201).json(created)
})

app.delete('/api/presets/:id', (req, res) => {
  presetStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Themes ----

app.get('/api/themes', (_req, res) => {
  res.json(themeStore.list({ orderBy: 'createdAt' }))
})

app.post('/api/themes', (req, res) => {
  const created = themeStore.insert({ id: newId(), name: req.body.name, tokens: req.body.tokens, createdAt: Date.now() })
  res.status(201).json(created)
})

app.put('/api/themes/:id', (req, res) => {
  const updated = themeStore.update(req.params.id, { name: req.body.name, tokens: req.body.tokens })
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/themes/:id', (req, res) => {
  themeStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Assistant threads ----
//
// Plain model conversations, with no character and no relationship state. One row per thread with
// its messages inside, so the whole feature is a single resource (see `db.ts` for why).

app.get('/api/assistant-library/search', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q : ''
  if (!query.trim()) return res.json([])
  res.json(searchLocalLibrary(query, {
    worlds: worldStore.list() as unknown as WorldCard[],
    characters: characterStore.list() as unknown as Character[],
    books: worldInfoBookStore.list() as unknown as WorldInfoBook[],
    chats: chatStore.list() as unknown as Chat[],
    messages: messageStore.list() as unknown as StoredMessage[],
    objectives: objectiveStore.list() as unknown as Objective[],
    facts: chatFactStore.list() as unknown as ChatFact[],
  }))
})

app.get('/api/assistant-threads', (_req, res) => {
  // Newest first: the list is a recency list, and a thread is picked up where it was left.
  res.json(assistantThreadStore.list({ orderBy: 'updatedAt DESC' }))
})

app.get('/api/assistant-threads/:id', (req, res) => {
  const found = assistantThreadStore.get(req.params.id)
  if (!found) return notFound(res)
  res.json(found)
})

app.post('/api/assistant-threads', (req, res) => {
  const now = Date.now()
  const created = assistantThreadStore.insert({
    id: newId(),
    title: req.body.title ?? 'New conversation',
    messages: req.body.messages ?? [],
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/assistant-threads/:id', (req, res) => {
  const updated = assistantThreadStore.update(req.params.id, { ...req.body, updatedAt: Date.now() })
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/assistant-threads/:id', (req, res) => {
  assistantThreadStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Custom instruct templates ----

app.get('/api/instruct-templates', (_req, res) => {
  res.json(instructTemplateStore.list({ orderBy: 'createdAt' }))
})

app.post('/api/instruct-templates', (req, res) => {
  const created = instructTemplateStore.insert({
    id: newId(),
    name: req.body.name,
    systemPrefix: req.body.systemPrefix ?? '',
    systemSuffix: req.body.systemSuffix ?? '',
    userPrefix: req.body.userPrefix ?? '',
    userSuffix: req.body.userSuffix ?? '',
    assistantPrefix: req.body.assistantPrefix ?? '',
    assistantSuffix: req.body.assistantSuffix ?? '',
    stopSequences: Array.isArray(req.body.stopSequences) ? req.body.stopSequences : [],
    namesInPrompt: req.body.namesInPrompt === true,
    createdAt: Date.now(),
  })
  res.status(201).json(created)
})

app.put('/api/instruct-templates/:id', (req, res) => {
  const patch: Record<string, unknown> = {}
  if ('name' in req.body) patch.name = req.body.name
  if ('systemPrefix' in req.body) patch.systemPrefix = req.body.systemPrefix ?? ''
  if ('systemSuffix' in req.body) patch.systemSuffix = req.body.systemSuffix ?? ''
  if ('userPrefix' in req.body) patch.userPrefix = req.body.userPrefix ?? ''
  if ('userSuffix' in req.body) patch.userSuffix = req.body.userSuffix ?? ''
  if ('assistantPrefix' in req.body) patch.assistantPrefix = req.body.assistantPrefix ?? ''
  if ('assistantSuffix' in req.body) patch.assistantSuffix = req.body.assistantSuffix ?? ''
  if ('stopSequences' in req.body) patch.stopSequences = Array.isArray(req.body.stopSequences) ? req.body.stopSequences : []
  if ('namesInPrompt' in req.body) patch.namesInPrompt = req.body.namesInPrompt === true
  const updated = instructTemplateStore.update(req.params.id, patch)
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/instruct-templates/:id', (req, res) => {
  instructTemplateStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Worlds ----

app.get('/api/worlds', (_req, res) => {
  res.json(worldStore.list({ orderBy: 'updatedAt DESC' }))
})

app.get('/api/worlds/:id', (req, res) => {
  const row = worldStore.get(req.params.id)
  if (!row) return notFound(res)
  res.json(row)
})

app.post('/api/worlds', (req, res) => {
  const now = Date.now()
  const id = newId()
  const avatarDataUrl = resolveAvatar('worlds', id, req.body.avatarDataUrl)
  const backgrounds = resolveAvatarMap('worlds', 'backgrounds', id, req.body.backgrounds)
  const backgroundsNight = resolveWorldBackgroundsNightMap(id, req.body.backgroundsNight)
  const music = resolveWorldMusicMap(id, req.body.music)
  const customSceneFlags = normalizeCustomSceneFlags(req.body.customSceneFlags)
  const allowedFlags = new Set([...DEFAULT_SCENE_FLAGS, ...customSceneFlags.map((f) => f.id)])
  const created = worldStore.insert({
    id,
    name: req.body.name,
    campaign: normalizeCampaign(req.body.campaign),
    modules: normalizeWorldModules(req.body.modules),
    promptItems: normalizePromptItems(req.body.promptItems),
    canonFacts: normalizeCanonFacts(req.body.canonFacts),
    description: req.body.description,
    rules: req.body.rules,
    gmNotes: typeof req.body.gmNotes === 'string' ? req.body.gmNotes.slice(0, 100_000) : undefined,
    template: req.body.template ?? undefined,
    scenerySet: ['adventure', 'modern-school', 'custom-only'].includes(req.body.scenerySet) ? req.body.scenerySet : undefined,
    lorebook: req.body.lorebook,
    avatarDataUrl,
    backgrounds,
    backgroundsNight,
    backgroundUnlocks: req.body.backgroundUnlocks ?? {},
    music,
    gifts: normalizeGiftItems(req.body.gifts),
    items: normalizeItemDefs(req.body.items, allowedFlags),
    customSceneFlags,
    customBackgrounds: normalizeCustomBackgrounds(req.body.customBackgrounds),
    relationshipThresholds: normalizeRelationshipThresholds(req.body.relationshipThresholds),
    intimacyLevel: normalizeIntimacyLevel(req.body.intimacyLevel),
    triggers: normalizeTriggers(req.body.triggers),
    customIntimacyOptions: Array.isArray(req.body.customIntimacyOptions) ? req.body.customIntimacyOptions : undefined,
    createdAt: now,
    updatedAt: now,
  })
  res.status(201).json(created)
})

app.put('/api/worlds/:id', (req, res) => {
  const id = req.params.id
  const existing = worldStore.get(id)
  if (!existing) return notFound(res)
  const patch: Record<string, unknown> = { ...req.body, updatedAt: Date.now() }
  if ('scenerySet' in req.body) patch.scenerySet = ['adventure', 'modern-school', 'custom-only'].includes(req.body.scenerySet) ? req.body.scenerySet : undefined
  if ('campaign' in req.body) patch.campaign = normalizeCampaign(req.body.campaign)
  if ('modules' in req.body) patch.modules = normalizeWorldModules(req.body.modules)
  if ('promptItems' in req.body) patch.promptItems = normalizePromptItems(req.body.promptItems)
  if ('canonFacts' in req.body) patch.canonFacts = normalizeCanonFacts(req.body.canonFacts)
  if ('avatarDataUrl' in req.body) patch.avatarDataUrl = resolveAvatar('worlds', id, req.body.avatarDataUrl)
  if ('backgrounds' in req.body) patch.backgrounds = resolveAvatarMap('worlds', 'backgrounds', id, req.body.backgrounds)
  if ('backgroundsNight' in req.body) patch.backgroundsNight = resolveWorldBackgroundsNightMap(id, req.body.backgroundsNight)
  if ('music' in req.body) patch.music = resolveWorldMusicMap(id, req.body.music)
  if ('backgroundUnlocks' in req.body) patch.backgroundUnlocks = req.body.backgroundUnlocks ?? {}
  if ('gifts' in req.body) patch.gifts = normalizeGiftItems(req.body.gifts)
  if ('customSceneFlags' in req.body) patch.customSceneFlags = normalizeCustomSceneFlags(req.body.customSceneFlags)
  if ('intimacyLevel' in req.body) patch.intimacyLevel = normalizeClearableIntimacyLevel(req.body.intimacyLevel)
  if ('triggers' in req.body) patch.triggers = normalizeTriggers(req.body.triggers)
  if ('customBackgrounds' in req.body) patch.customBackgrounds = normalizeCustomBackgrounds(req.body.customBackgrounds)
  if ('items' in req.body) {
    // Validate against whichever custom flags are in effect after this same request, so an item
    // referencing a flag saved in the same request isn't wrongly rejected.
    const customFlags = (
      'customSceneFlags' in patch ? patch.customSceneFlags : existing.customSceneFlags
    ) as { id: string }[] | undefined
    const allowedFlags = new Set([...DEFAULT_SCENE_FLAGS, ...(customFlags ?? []).map((f) => f.id)])
    patch.items = normalizeItemDefs(req.body.items, allowedFlags)
  }
  if ('relationshipThresholds' in req.body) patch.relationshipThresholds = normalizeRelationshipThresholds(req.body.relationshipThresholds)
  const updated = worldStore.update(id, patch)
  res.json(updated)
})

app.delete('/api/worlds/:id', (req, res) => {
  const worldId = req.params.id
  // Un-assign rather than cascade-delete: characters living here lose their world, not their existence.
  for (const c of characterStore.list({ where: 'worldId = ?', params: [worldId] })) {
    characterStore.update(c.id as string, { worldId: undefined })
  }
  removeAvatar('worlds', worldId)
  worldStore.remove(worldId)
  res.status(204).end()
})

// ---- Objectives ----

app.get('/api/objectives/active', (req, res) => {
  const chatId = String(req.query.chatId ?? '')
  const row = objectiveStore.list({ where: 'chatId = ? AND status = ?', params: [chatId, 'active'] })[0]
  res.json(row ?? null)
})

app.get('/api/objectives', (req, res) => {
  const chatId = String(req.query.chatId ?? '')
  const status = req.query.status ? String(req.query.status) : undefined
  const where = status ? 'chatId = ? AND status = ?' : 'chatId = ?'
  const params = status ? [chatId, status] : [chatId]
  res.json(objectiveStore.list({ where, params }))
})

app.post('/api/objectives', (req, res) => {
  const now = Date.now()
  const created = objectiveStore.insert({ ...req.body, id: newId(), createdAt: now, updatedAt: now })
  res.status(201).json(created)
})

app.put('/api/objectives/:id', (req, res) => {
  const updated = objectiveStore.update(req.params.id, { ...req.body, updatedAt: Date.now() })
  if (!updated) return notFound(res)
  res.json(updated)
})

app.delete('/api/objectives/:id', (req, res) => {
  objectiveStore.remove(req.params.id)
  res.status(204).end()
})

// ---- Relationship events ----
// Append-only audit log; no PUT/DELETE, entries are immutable once logged.

app.get('/api/chats/:id/relationship-events', (req, res) => {
  res.json(relationshipEventStore.list({ where: 'chatId = ?', params: [req.params.id], orderBy: 'createdAt DESC' }))
})

app.post('/api/relationship-events', (req, res) => {
  const created = relationshipEventStore.insert({ ...req.body, id: newId(), createdAt: Date.now() })
  res.status(201).json(created)
})

// ---- Chat facts ----
// Durable, individually-retirable facts; retiring one sets active: false (never DELETEd).

app.get('/api/chats/:id/chat-facts', (req, res) => {
  res.json(chatFactStore.list({ where: 'chatId = ?', params: [req.params.id], orderBy: 'createdAt DESC' }))
})

app.post('/api/chat-facts', (req, res) => {
  const created = chatFactStore.insert({ active: true, ...req.body, id: newId(), createdAt: Date.now() })
  res.status(201).json(created)
})

app.put('/api/chat-facts/:id', (req, res) => {
  const updated = chatFactStore.update(req.params.id, req.body)
  if (!updated) return notFound(res)
  res.json(updated)
})

// ---- Full backup / restore ----
// One self-contained JSON snapshot of every table plus every avatar/sprite/background file (base64),
// preserving original ids — unlike character packs (importExport.ts / pack.ts), which mint new ones.

const BACKUP_VERSION = 1
const BACKUP_STORES = {
  characters: characterStore,
  personas: personaStore,
  chats: chatStore,
  messages: messageStore,
  worldInfoBooks: worldInfoBookStore,
  presets: presetStore,
  themes: themeStore,
  instructTemplates: instructTemplateStore,
  assistantThreads: assistantThreadStore,
  worlds: worldStore,
  objectives: objectiveStore,
  relationshipEvents: relationshipEventStore,
  chatFacts: chatFactStore,
} as const

function listAvatarFiles(): { relPath: string; base64: string }[] {
  const results: { relPath: string; base64: string }[] = []
  function walk(dir: string, rel: string) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name)
      const relEntry = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, relEntry)
      else results.push({ relPath: relEntry, base64: fs.readFileSync(abs).toString('base64') })
    }
  }
  walk(avatarsDir, '')
  return results
}

app.get('/api/backup', (_req, res) => {
  const data: Record<string, unknown[]> = {}
  for (const [key, store] of Object.entries(BACKUP_STORES)) data[key] = store.list()
  res.json({ version: BACKUP_VERSION, exportedAt: Date.now(), data, avatarFiles: listAvatarFiles() })
})

// A full backup with many/large images can exceed the app's normal 25mb JSON ceiling — this
// route alone accepts a much larger body instead of raising the limit for every other endpoint.
app.post('/api/restore', express.json({ limit: '1gb' }), (req, res) => {
  const body = req.body as Record<string, unknown>
  if (!body || typeof body !== 'object' || body.version !== BACKUP_VERSION || !body.data || typeof body.data !== 'object') {
    return res.status(400).json({ error: 'Not a recognized backup file.' })
  }
  const data = body.data as Record<string, unknown>
  // All-or-nothing: without a transaction, a bad row partway through would leave tables in a mixed old/new state.
  db.exec('BEGIN')
  try {
    for (const [key, store] of Object.entries(BACKUP_STORES)) {
      store.clear()
      const rows = Array.isArray(data[key]) ? (data[key] as Record<string, unknown>[]) : []
      for (const row of rows) store.insert(row)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  if (Array.isArray(body.avatarFiles)) {
    // Write into a fresh temp directory and only swap it in once every file succeeds, so a failure
    // partway through can't leave avatarsDir wiped with nothing restored.
    const tmpDir = `${avatarsDir}.restore-tmp`
    fs.rmSync(tmpDir, { recursive: true, force: true })
    fs.mkdirSync(tmpDir, { recursive: true })
    for (const f of body.avatarFiles as Record<string, unknown>[]) {
      if (typeof f.relPath !== 'string' || typeof f.base64 !== 'string') continue
      // Strip '..' segments so restore can never write outside avatarsDir.
      const safeRel = f.relPath
        .replace(/\\/g, '/')
        .split('/')
        .filter((seg) => seg && seg !== '.' && seg !== '..')
        .join('/')
      if (!safeRel) continue
      const dest = path.join(tmpDir, safeRel)
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, Buffer.from(f.base64, 'base64'))
    }
    fs.rmSync(avatarsDir, { recursive: true, force: true })
    fs.renameSync(tmpDir, avatarsDir)
  }
  res.status(204).end()
})

/** NovelAI wants its prompt pre-tokenized (see novelaiTokenizer.ts); the browser sends the resulting ids to NovelAI directly with its own API key. */
app.post('/api/novelai/tokenize', async (req, res) => {
  const { text, model } = req.body as { text?: unknown; model?: unknown }
  if (typeof text !== 'string' || typeof model !== 'string') {
    res.status(400).json({ error: '"text" and "model" are both required strings.' })
    return
  }
  const tokenizerId = tokenizerForModel(model)
  if (!tokenizerId) {
    res.status(400).json({ error: `No bundled tokenizer for NovelAI model "${model}" — only Clio and Kayra are supported so far.` })
    return
  }
  const ids = await encodeTokens(text, tokenizerId)
  res.json({ ids })
})

// Serve the built client (Docker, or `npm run build` && `npm start`). In dev this is Vite's job and
// `dist/` doesn't exist, so the whole block is skipped and `npm run dev` is untouched. Registered
// after every `/api` route so those still win; the SPA fallback then hands any other GET the app
// shell so a deep-link reload works, while unknown `/api` paths fall through to the 404 below.
const clientDir = path.resolve(fileURLToPath(import.meta.url), '..', '..', 'dist')
if (fs.existsSync(path.join(clientDir, 'index.html'))) {
  app.use(express.static(clientDir))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api/') || req.path.startsWith('/avatars/')) return next()
    res.sendFile(path.join(clientDir, 'index.html'))
  })
}

// Catches throws from any route above and returns clean JSON instead of Express's default HTML error page. Must be last.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err)
  res.status(400).json({ error: err instanceof Error ? err.message : 'Request failed' })
})
