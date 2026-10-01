import type { Character } from '@/lib/characters/cardSpec'

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
export function cardBrief(character: Pick<Character, 'card' | 'promptItems'>, opts: { userName: string; maxChars?: number }): string {
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
    ...items,
  ].filter((part): part is string => !!part)
  const text = sub(parts.join('\n\n')).replace(/\n{3,}/g, '\n\n').trim()
  const max = opts.maxChars ?? 1500
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}
