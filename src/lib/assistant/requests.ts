/**
 * Recognising the two things the assistant can *make* rather than just answer: a roleplay character,
 * and a long-form story.
 *
 * Deliberately lexical and deliberately advisory. A classifier call would cost a round trip on every
 * message to decide something the player already knows, and getting it wrong is worse than not
 * asking: silently turning "what makes a good elf character?" into a 5-stage generation run is a
 * confusing waste, while missing a real request costs one button press. So this only ever *offers*
 * the producer, and plain chat stays plain.
 */

export type ProducerKind = 'character' | 'story' | 'update'

/** A verb that means "bring this into existence", as opposed to discussing it. */
const MAKE = String.raw`(?:generate|create|make|design|build|write|draft|come up with|invent|give me)`

/** "a character", "an OC", "a companion for me" — the object of a character request. */
const CHARACTER_OBJECT = String.raw`(?:\w+\s+){0,6}?(?:character|oc|npc|companion|persona|protagonist|villain|waifu|husbando)`

const CHARACTER_PATTERNS = [
  new RegExp(String.raw`\b${MAKE}\b[^.?!]{0,80}?\b${CHARACTER_OBJECT}\b`, 'i'),
  // "generate a 3000 year old white hair elf for me" — a species/archetype noun with no "character".
  new RegExp(
    String.raw`\b${MAKE}\b[^.?!]{0,80}?\b(?:elf|elven|orc|dwarf|vampire|demon|angel|witch|wizard|mage|sorcerer|knight|samurai|ninja|android|robot|werewolf|dragon|fae|fairy|catgirl|nekomimi|succubus|god|goddess|priestess|assassin|mercenary|pirate|alien)\b`,
    'i',
  ),
  /\b(?:character|oc) (?:card|sheet)\b/i,
]

/** Words that mean "change what's saved" rather than "make something new". */
const EDIT_VERB = /\b(?:update|edit|change|revise|adjust|fix|tweak|rework|give|assign|add|set|fill in|stat (?:out|up)|round out|flesh out)\b/i

/** The parts of a saved character an update can touch. */
const UPDATE_OBJECT = /\b(?:(?:character )?sheet|stats?|stat block|stat line|attributes|modifiers|ratings|backstory|description|personality|goals|likes|profile|bio)\b/i

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The first saved character named in `text`, by full name or a first name of at least 3 letters. */
function namedCharacter(text: string, knownNames: readonly string[]): string | undefined {
  for (const name of [...knownNames].sort((a, b) => b.length - a.length)) {
    const full = name.trim()
    const first = full.split(/\s+/)[0] ?? ''
    for (const candidate of [full, first.length >= 3 ? first : '']) {
      if (candidate && new RegExp(String.raw`(?:^|[^\p{L}\p{N}])${escapeRe(candidate)}(?:'s)?(?![\p{L}\p{N}])`, 'iu').test(text)) return full
    }
  }
  return undefined
}

const STORY_PATTERNS = [
  // "chapters" is one of the object nouns rather than a pattern of its own: standalone it matches
  // "I like stories with chapters", which is conversation, not a commission.
  new RegExp(
    String.raw`\b${MAKE}\b[^.?!]{0,80}?\b(?:story|novel|novella|book|fanfic|fanfiction|tale|saga|screenplay|chapters?)\b`,
    'i',
  ),
  /\bchapter[- ]by[- ]chapter\b/i,
  /\b(?:full|complete|whole|entire|long)[- ](?:story|novel|book)\b/i,
]

/**
 * What this message is asking to have made, or `undefined` for ordinary conversation.
 *
 * A message matching both reads as a story, since "write a story about a 3000 year old elf" wants
 * prose with an elf in it, not a character card.
 */
export function detectProducer(text: string, knownNames: readonly string[] = []): ProducerKind | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  // Questions *about* the subject aren't requests to produce one: "what makes a good character?",
  // "how would you write a story like that?". Checked before the patterns, since several of them
  // would otherwise match a question containing the verb.
  if (
    /^(?:what|which|why|is it|are there|do you think|can you explain|tell me about)\b/i.test(trimmed) ||
    /^how\s+(?:come|would|do|does|did|can|could|should|much|many)\b/i.test(trimmed)
  ) {
    return undefined
  }
  if (STORY_PATTERNS.some((re) => re.test(trimmed))) return 'story'
  // A saved character named with something to change ("make Ash's character sheet", "give Ash
  // stats") is an update to them, not a request for a new character. "Make a new character who is
  // Ash's sister" names no part to change, so it still reads as a new character.
  if (namedCharacter(trimmed, knownNames) && (UPDATE_OBJECT.test(trimmed) || (EDIT_VERB.test(trimmed) && !/new/i.test(trimmed)))) return 'update'
  if (CHARACTER_PATTERNS.some((re) => re.test(trimmed))) return 'character'
  return undefined
}

/** Player-facing label for the offer chip. */
export const PRODUCER_LABEL: Record<ProducerKind, string> = {
  character: 'Build this as a character',
  story: 'Write this as a full story',
  update: 'Update this character',
}

/** One line under the chip saying what pressing it will actually do. */
export const PRODUCER_DETAIL: Record<ProducerKind, string> = {
  character:
    'Runs the full character build (card, profile, wardrobe, lore) and offers to save it to your library for roleplay.',
  story: 'Plans a chapter outline first, then writes each chapter in order, keeping continuity across them.',
  update: "Drafts the change, such as a character sheet for a world's rules, for you to review and edit. Nothing is saved until you apply it.",
}
