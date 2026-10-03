import type { Character } from '@/lib/characters/cardSpec'
import { isPhysicalForm } from '@/lib/vn/appearances'

/** Prompt items that are scaffolding rather than about the character: example lines, voice rules, wrapper tags. */
const NOT_ABOUT_THEM = /example|sample|dialog|voice|style|format|tag/i
/** A line that is only a wrapper tag, like `<{{this_card}} Lore>` or `</General>`. */
const BARE_TAG = /^<\/?[^<>]*>$/

/**
 * Who a character is, from their own card, for the Game Master when it voices them itself
 * (`GmPlayedCharacter`). The description and personality fields first, then the card's prompt
 * items, which is where imported cards keep everything. Not for other characters' agents: a card's
 * items can hold private backstory those characters have no way of knowing.
 */
export function cardBrief(character: Pick<Character, 'card' | 'promptItems' | 'outfits' | 'baseForm'>, opts: { userName: string; maxChars?: number }): string {
  const name = character.card.name
  const sub = (text: string) => text
    .replace(/\{\{(?:this_card|char)\}\}/gi, name)
    .replace(/\{\{user\}\}/gi, opts.userName)
  const items = (character.promptItems ?? [])
    .filter((item) => item.enabled && !item.importWarning && !NOT_ABOUT_THEM.test(item.name))
    .map((item) => item.content.split('\n').filter((line) => !BARE_TAG.test(line.trim())).join('\n').trim())
  const parts = [
    character.card.description?.trim(),
    character.card.personality?.trim() ? `Personality: ${character.card.personality.trim()}` : '',
    appearancesLine(character.outfits, character.baseForm),
    ...items,
  ].filter((part): part is string => !!part)
  const text = sub(parts.join('\n\n')).replace(/\n{3,}/g, '\n\n').trim()
  const max = opts.maxChars ?? 1500
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

/** Their described forms and outfits, one line: what each looks like, so the GM can tell them apart. */
export function appearancesLine(outfits: Character['outfits'], baseForm?: Character['baseForm']): string {
  const described = (outfits ?? []).filter((outfit) => outfit.description?.trim())
  const list = (forms: boolean) => described.filter((outfit) => isPhysicalForm(outfit) === forms).map((outfit) => `${outfit.label}: ${outfit.description!.trim()}`)
  return [
    list(true).length ? `Forms (besides their usual one${baseForm?.label?.trim() ? `, ${baseForm.label.trim()}` : ''}): ${list(true).join(' | ')}` : '',
    list(false).length ? `Outfits: ${list(false).join(' | ')}` : '',
  ].filter(Boolean).join('\n')
}

/**
 * What the model is told about the form or outfit a character is in right now, if it's described.
 * Someone with other forms is told when they're in their usual one too, so a model that saw them
 * as a wisp a few lines back knows they've changed back.
 */
export function appearanceNote(name: string, outfits: Character['outfits'], currentId: string | undefined, baseForm?: Character['baseForm']): string {
  const outfit = currentId ? (outfits ?? []).find((o) => o.id === currentId) : undefined
  if (!outfit && (outfits ?? []).some(isPhysicalForm)) {
    const label = baseForm?.label?.trim()
    return label ? `Right now ${name} is in their ${label} form, their usual look (their Description).` : `Right now ${name} is in their usual form (their Description), not any of their other forms.`
  }
  if (!outfit?.description?.trim()) return ''
  return isPhysicalForm(outfit)
    ? `Right now ${name} is in their ${outfit.label} form: ${outfit.description.trim()}`
    : `Right now ${name} is wearing ${outfit.label}: ${outfit.description.trim()}`
}
