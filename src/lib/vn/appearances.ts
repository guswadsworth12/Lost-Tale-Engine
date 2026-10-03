import type { Outfit } from './outfits'
import { BASE_OUTFIT_ID, expressionIdsForOutfit, isOutfitUnlocked } from './outfits'

type AppearanceMessage = {
  role: string
  speakerId?: string
  text?: string
  scene?: { outfit?: string; appearances?: Record<string, string> }
  swipeScenes?: ({ outfit?: string; appearances?: Record<string, string> } | undefined)[]
  activeSwipe?: number
}

/** Forms are a kind of appearance, using the existing outfit sprite grid and old human/dragon art. */
export function isPhysicalForm(outfit: Outfit): boolean {
  return outfit.kind === 'form' || (outfit.kind !== 'outfit' && /^(human|dragon|wolf|fox|cat|beast|animal|true-form|humanoid)$/i.test(outfit.id))
}

/** What a character's usual look is called (`Character.baseForm`), when they've named it. */
export interface BaseFormInfo {
  label?: string
  aliases?: string[]
}

/** The name shown for their usual look: its own name, else "Default". */
export function baseLabel(baseForm: BaseFormInfo | undefined): string {
  return baseForm?.label?.trim() || 'Default'
}

export function availableAppearances(
  outfits: Outfit[] | undefined,
  sprites: Record<string, string> | undefined,
  affection: number,
  flags: ReadonlySet<string>,
  baseForm?: BaseFormInfo,
): { id: string; label: string }[] {
  return [
    { id: BASE_OUTFIT_ID, label: baseLabel(baseForm) },
    ...(outfits ?? [])
      .filter((outfit) => isOutfitUnlocked(outfit, affection, flags) && expressionIdsForOutfit(sprites, outfit.id).length > 0)
      .map(({ id, label }) => ({ id, label })),
  ]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A form a passage can put someone in: their usual look or one of their physical forms, and every word for it. */
export interface FormChoice {
  id: string
  label: string
  aliases?: string[]
  /** Words that only name this form as "<word> form" ("usual form", "normal shape"), never alone ("her usual seat"). */
  formOnly?: string[]
}

/** Said of a usual look that has no name of its own: "returns to her usual form", "back to normal". */
const USUAL_WORDS = ['usual', 'normal', 'original', 'regular', 'ordinary']

/**
 * The forms a character can be seen in right now: their usual look first, then each unlocked
 * physical form with art. Empty when they have no other form, since then there is nothing to tell
 * apart. Outfits (clothes) aren't forms and stay out.
 */
export function formChoices(
  character: { outfits?: Outfit[]; sprites?: Record<string, string>; baseForm?: BaseFormInfo },
  affection: number,
  flags: ReadonlySet<string>,
): FormChoice[] {
  const allowed = new Set(availableAppearances(character.outfits, character.sprites, affection, flags).map((o) => o.id))
  const forms = (character.outfits ?? []).filter((outfit) => isPhysicalForm(outfit) && allowed.has(outfit.id))
  if (!forms.length) return []
  const named = character.baseForm?.label?.trim()
  return [
    { id: BASE_OUTFIT_ID, label: named || 'Usual', aliases: character.baseForm?.aliases ?? [], formOnly: named ? USUAL_WORDS : ['usual', ...USUAL_WORDS] },
    ...forms.map((form) => ({ id: form.id, label: form.label, aliases: form.aliases ?? [] })),
  ]
}

const cleanTerms = (terms: readonly string[]) => [...new Set(terms.map((term) => term.trim().toLowerCase()).filter((term) => term.length >= 2))]

/** Every word that names a form by itself, lowercased and unique: its own name (an unnamed usual look has none), its id (bar the internal "base"), and its aliases. */
export function formTerms(form: FormChoice): string[] {
  const unnamedBase = form.id === BASE_OUTFIT_ID && form.formOnly?.includes(form.label.toLowerCase())
  return cleanTerms([unnamedBase ? '' : form.label, form.id === BASE_OUTFIT_ID ? '' : form.id, ...(form.aliases ?? [])])
}

/** How narration refers to a character: the full card name, or the first name alone ("Wren" for "Wren Talley"). */
export function nameVariants(name: string): string[] {
  const full = name.trim()
  const first = full.split(/\s+/)[0] ?? ''
  return [...new Set([full, first.length >= 3 ? first : ''])].filter(Boolean)
}

/** Whether a passage mentions the character by either name, or by one of their aliases ("the courier"). */
export function mentionsCharacter(text: string, name: string, aliases: readonly string[] = []): boolean {
  return [...nameVariants(name), ...aliases.map((alias) => alias.trim()).filter((alias) => alias.length >= 2)]
    .some((variant) => new RegExp(`\\b${escapeRegExp(variant)}\\b`, 'i').test(text))
}

/**
 * Immediate cue, no model call: a passage that names the character and then plainly puts them in a
 * form ("Zinnia takes her human form", "Tavi shifts into the fox", "the human form steadies").
 * `forms` is `formChoices`, so their usual look can be named too. Nicknames alone aren't changes.
 */
export function formMentionedInText(text: string, name: string, forms: FormChoice[], aliases: readonly string[] = []): string | undefined {
  if (forms.length < 2 || !text || !name.trim()) return undefined
  const names = [...nameVariants(name), ...aliases.map((alias) => alias.trim()).filter((alias) => alias.length >= 2)]
  const nameMatch = new RegExp(`\\b(?:${names.map(escapeRegExp).join('|')})\\b`, 'ig')
  let result: string | undefined
  for (const match of text.matchAll(nameMatch)) {
    const passage = text.slice(match.index, match.index + 320).split(/\n\s*\n/)[0]
    let mentioned: string | undefined
    for (const form of forms) {
      const terms = formTerms(form)
      const formOnly = cleanTerms(form.formOnly ?? [])
      const term = terms.length ? `(?:${terms.map(escapeRegExp).join('|')})` : ''
      const named = term && new RegExp(`(?:\\b(?:in|into|as|takes|assumes|shifts|transforms|changes|reveals|returns to|appears in)\\b.{0,65}\\b${term}\\b|\\b${term}\\s+(?:form|shape)\\b)`, 'i').test(passage)
      const plain = formOnly.length && new RegExp(`\\b(?:${formOnly.map(escapeRegExp).join('|')})\\s+(?:form|shape|self)\\b`, 'i').test(passage)
      if (named || plain) mentioned = form.id
    }
    // A clearly human physical entrance can be described without the literal words "human form".
    // Require several distinct cues; a lone "hand" or a metaphor like "dragon daughter" is insufficient.
    const human = forms.find((form) => formTerms(form).includes('human'))
    if (human && forms.some((form) => formTerms(form).includes('dragon')) && !mentioned) {
      const cues = [/\bhand(?:s)?\b/i, /\bhair\b/i, /\bcheek(?:s)?\b/i, /\bfinger(?:s)?\b/i, /\bshoe(?:s)?\b|\bboot(?:s)?\b/i]
      const physicalAction = /\b(?:drops|climbs|steps|walks|flicks|holds|carries|enters|approaches|turns|runs|arrives|stands|sits)\b/i.test(passage)
      if (physicalAction && cues.filter((cue) => cue.test(passage)).length >= 3) mentioned = human.id
    }
    if (mentioned) result = mentioned
  }
  return result
}

/** Replay per-character appearance changes along the selected message branch. */
export function appearanceForCharacter(
  messages: readonly AppearanceMessage[],
  character: { id: string; name: string; outfits?: Outfit[]; sprites?: Record<string, string>; baseForm?: BaseFormInfo; aliases?: string[] },
  primaryCharacterId: string,
  affection: number,
  flags: ReadonlySet<string>,
  override?: string,
): string {
  const allowed = new Set(availableAppearances(character.outfits, character.sprites, affection, flags).map((o) => o.id))
  if (override && allowed.has(override)) return override
  const forms = formChoices(character, affection, flags)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    const scene = message.swipeScenes?.[message.activeSwipe ?? 0] ?? message.scene
    const inferred = message.role === 'char' ? formMentionedInText(message.text ?? '', character.name, forms, character.aliases) : undefined
    // Scene narration can establish another character's form even when someone else speaks.
    if (scene?.appearances?.[character.id] && allowed.has(scene.appearances[character.id])) return scene.appearances[character.id]
    if (inferred) return inferred
    // The old `outfit=` tag belongs to its speaker, never the entire stage. Player-driven
    // intimacy changes keep applying to the primary character for backward compatibility.
    const ownsTag = message.role === 'char'
      ? message.speakerId === character.id || (!message.speakerId && character.id === primaryCharacterId)
      : message.role === 'user' && character.id === primaryCharacterId
    if (ownsTag && scene?.outfit && allowed.has(scene.outfit)) return scene.outfit
  }
  return BASE_OUTFIT_ID
}
