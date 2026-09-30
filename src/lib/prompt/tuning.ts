import type { Character } from '@/lib/characters/cardSpec'
import { buildJournalPrompt } from '@/lib/memory/journal'
import { buildScribePrompt } from '@/lib/memory/scribe'
import { renderPromptItems, type PromptItem } from '@/lib/prompt/items'
import { buildChapterRecapPrompt } from '@/lib/story/chapterRecap'
import { buildRecapPrompt } from '@/lib/story/recapWriter'
import type { WorldCard } from '@/lib/types'
import { DEFAULT_CAMPAIGN } from '@/lib/world/campaign'
import { buildGmPrompt } from '@/lib/world/gm'
import { revisionsOf, withChanges, type WorldRevision } from '@/lib/world/revisions'
import { promptOverride, type TunablePromptId } from './promptOverrides'
import { tunablePrompt } from './tunable'

/**
 * Writer's Room prompt tuning: what can be tuned (an engine prompt's guidance, a world's GM notes,
 * a world's or character's prompt items), what it says now, the change that applies an edit (kept
 * in the record's revision history), and what the model would receive on a sample turn, so an
 * edit can be previewed before it's applied.
 */

export type TuningTarget =
  | { kind: 'engine'; id: TunablePromptId }
  | { kind: 'gmNotes' }
  | { kind: 'worldItem'; itemId: string }
  | { kind: 'characterItem'; characterId: string; itemId: string }

type TunableWorld = Pick<WorldCard, 'name' | 'description' | 'rules' | 'campaign' | 'gmNotes' | 'promptItems' | 'promptOverrides' | 'revisions'>
type TunableCharacter = Pick<Character, 'id' | 'promptItems' | 'revisions'> & { card: { name: string } }

const itemOf = (items: PromptItem[] | undefined, id: string) => items?.find((item) => item.id === id)

/** What the target says now: an engine prompt's override or default, or the saved text. */
export function targetText(target: TuningTarget, world: TunableWorld, character?: TunableCharacter): string {
  if (target.kind === 'engine') return promptOverride(world.promptOverrides, target.id) ?? tunablePrompt(target.id).defaultText
  if (target.kind === 'gmNotes') return world.gmNotes ?? ''
  if (target.kind === 'worldItem') return itemOf(world.promptItems, target.itemId)?.content ?? ''
  return itemOf(character?.promptItems, target.itemId)?.content ?? ''
}

/** How the target is named in the editor and in its history. */
export function targetLabel(target: TuningTarget, world: TunableWorld, character?: TunableCharacter): string {
  if (target.kind === 'engine') return tunablePrompt(target.id).label
  if (target.kind === 'gmNotes') return 'GM notes'
  if (target.kind === 'worldItem') return `${world.name}: ${itemOf(world.promptItems, target.itemId)?.name || 'prompt item'}`
  return `${character?.card.name ?? 'Character'}: ${itemOf(character?.promptItems, target.itemId)?.name || 'prompt item'}`
}

/**
 * The patch that saves `text` to the target, on the record that holds it (the character for a
 * character's item, the world otherwise), recorded in that record's history. An engine prompt set
 * back to its default text, or cleared, drops the override.
 */
export function tuningPatch(target: TuningTarget, world: TunableWorld, character: TunableCharacter | undefined, text: string, now: number, newId: () => string): Record<string, unknown> {
  const label = targetLabel(target, world, character)
  if (target.kind === 'engine') {
    const isDefault = !text.trim() || text.trim() === tunablePrompt(target.id).defaultText.trim()
    return withChanges(world, [{ field: 'promptOverrides', key: target.id, value: isDefault ? undefined : text.trim(), label: isDefault ? `Reset ${label} to the engine default` : `Tuned ${label}` }], now, newId)
  }
  if (target.kind === 'gmNotes') return withChanges(world, [{ field: 'gmNotes', value: text, label: 'Edited GM notes' }], now, newId)
  const record = target.kind === 'worldItem' ? world : character
  if (!record) throw new Error('That character is no longer in your library.')
  const items = (record.promptItems ?? []).map((item) => (item.id === target.itemId ? { ...item, content: text } : item))
  return withChanges(record, [{ field: 'promptItems', value: items, label: `Edited ${label}` }], now, newId)
}

/** The target's history, newest first. Prompt items share one history per record. */
export function targetHistory(target: TuningTarget, world: TunableWorld, character?: TunableCharacter): WorldRevision[] {
  if (target.kind === 'engine') return revisionsOf(world, 'promptOverrides', target.id)
  if (target.kind === 'gmNotes') return revisionsOf(world, 'gmNotes')
  return revisionsOf(target.kind === 'worldItem' ? world : character ?? {}, 'promptItems')
}

// ---- Previewing on a sample turn ---------------------------------------------------------------

/** A short exchange to build sample prompts from: the world's latest scene, or a stand-in. */
export interface TuningSample {
  playerName: string
  castNames: string[]
  lines: { speaker: string; text: string; isPlayer: boolean }[]
}

export const STAND_IN_SAMPLE: TuningSample = {
  playerName: 'Wren',
  castNames: ['Bea', 'Cole'],
  lines: [
    { speaker: 'Wren', text: 'I set the lantern on the table and ask who sent the letter.', isPlayer: true },
    { speaker: 'Bea', text: '"Nobody signs letters like that. You know that as well as I do."', isPlayer: false },
    { speaker: 'Cole', text: '"I will find out by morning. I promise."', isPlayer: false },
  ],
}

/** The last few lines of a real scene as the sample, or undefined when it has none worth using. */
export function sampleFrom(messages: readonly { role: string; name?: string; text: string; failed?: boolean }[], playerName: string): TuningSample | undefined {
  const lines = messages
    .filter((m) => !m.failed && m.text.trim() && (m.role === 'user' || m.role === 'char'))
    .slice(-6)
    .map((m) => ({ speaker: m.role === 'user' ? playerName : m.name?.trim() || 'Someone', text: m.text.trim().slice(0, 600), isPlayer: m.role === 'user' }))
  if (!lines.length) return undefined
  const castNames = [...new Set(lines.filter((l) => !l.isPlayer && l.speaker !== 'Game Master').map((l) => l.speaker))]
  return { playerName, castNames: castNames.length ? castNames : STAND_IN_SAMPLE.castNames, lines }
}

/**
 * What the model would receive for this target on the sample turn, with `text` in place of the
 * target's saved text: the whole prompt for an engine prompt or the GM notes, and the prompt items
 * section every character turn is given for an item.
 */
export function previewPrompt(target: TuningTarget, world: TunableWorld, character: TunableCharacter | undefined, text: string, sample: TuningSample = STAND_IN_SAMPLE): string {
  const guidance = (id: TunablePromptId) => (target.kind === 'engine' && target.id === id ? text : promptOverride(world.promptOverrides, id))
  const lead = sample.castNames[0] ?? 'the character'
  const action = [...sample.lines].reverse().find((l) => l.isPlayer)?.text ?? 'I look around.'
  if (target.kind === 'gmNotes' || (target.kind === 'engine' && target.id === 'gm-style')) {
    const { system, user } = buildGmPrompt({
      campaign: world.campaign ?? DEFAULT_CAMPAIGN,
      styleGuidance: guidance('gm-style'),
      worldName: world.name,
      worldDescription: world.description,
      worldRules: world.rules,
      gmNotes: target.kind === 'gmNotes' ? text : world.gmNotes,
      canonFacts: [],
      branchConsequences: [],
      scenery: '',
      roster: sample.castNames.map((name, i) => ({ id: `cast-${i}`, name })),
      playerName: sample.playerName,
      transcript: sample.lines.map((l) => ({ speaker: l.speaker, text: l.text })),
      playerAction: action,
      maxSpeakers: 3,
    })
    return `${system}\n\n${user}`
  }
  if (target.kind === 'engine' && target.id === 'scribe') {
    return buildScribePrompt({
      guidance: guidance('scribe'),
      worldName: world.name,
      playerName: sample.playerName,
      cast: [sample.playerName, ...sample.castNames].map((name, i) => ({ id: `p${i}`, name })),
      messages: sample.lines.map((l, i) => ({ n: i + 1, id: `m${i}`, name: l.speaker, text: l.text, witnessIds: [sample.playerName, ...sample.castNames].map((_, j) => `p${j}`) })),
      existing: [],
    })
  }
  if (target.kind === 'engine' && target.id === 'scene-recap') {
    return buildRecapPrompt({
      guidance: guidance('scene-recap'),
      messages: sample.lines.map((l) => ({ role: l.isPlayer ? 'user' : 'char', name: l.speaker, text: l.text })),
      playerName: sample.playerName,
      castNames: sample.castNames,
    })
  }
  if (target.kind === 'engine' && target.id === 'chapter-recap') {
    return buildChapterRecapPrompt({
      guidance: guidance('chapter-recap'),
      chapterLabel: 'Chapter 1',
      playerName: sample.playerName,
      scenes: [{ label: 'Scene 1', recap: sample.lines.map((l) => `${l.speaker}: ${l.text}`).join(' ') }],
    })
  }
  if (target.kind === 'engine' && target.id === 'journal') {
    return buildJournalPrompt({ guidance: guidance('journal'), name: lead, worldName: world.name, toFold: sample.lines.map((l) => ({ text: `${l.speaker}: ${l.text}` })) })
  }
  const record = target.kind === 'worldItem' ? world : character
  const items = (record?.promptItems ?? []).map((item) => (item.id === (target as { itemId: string }).itemId ? { ...item, content: text } : item))
  return renderPromptItems(items) || '(No enabled system prompt items: nothing is sent.)'
}
