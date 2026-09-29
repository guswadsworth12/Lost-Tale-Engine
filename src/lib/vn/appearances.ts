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

export function availableAppearances(
  outfits: Outfit[] | undefined,
  sprites: Record<string, string> | undefined,
  affection: number,
  flags: ReadonlySet<string>,
): { id: string; label: string }[] {
  return [
    { id: BASE_OUTFIT_ID, label: 'Default' },
    ...(outfits ?? [])
      .filter((outfit) => isOutfitUnlocked(outfit, affection, flags) && expressionIdsForOutfit(sprites, outfit.id).length > 0)
      .map(({ id, label }) => ({ id, label })),
  ]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** How narration refers to a character: the full card name, or the first name alone ("Wren" for "Wren Talley"). */
export function nameVariants(name: string): string[] {
  const full = name.trim()
  const first = full.split(/\s+/)[0] ?? ''
  return [...new Set([full, first.length >= 3 ? first : ''])].filter(Boolean)
}

/** Whether a passage mentions the character by either name. */
export function mentionsCharacter(text: string, name: string): boolean {
  return nameVariants(name).some((variant) => new RegExp(`\\b${escapeRegExp(variant)}\\b`, 'i').test(text))
}

/** Immediate cue for old stories without stored appearance metadata; avoid treating nicknames as transformations. */
export function formMentionedInText(text: string, name: string, forms: Outfit[]): string | undefined {
  if (forms.length < 2 || !text || !name.trim()) return undefined
  const nameMatch = new RegExp(`\\b(?:${nameVariants(name).map(escapeRegExp).join('|')})\\b`, 'ig')
  let result: string | undefined
  for (const match of text.matchAll(nameMatch)) {
    const passage = text.slice(match.index, match.index + 320).split(/\n\s*\n/)[0]
    let mentioned: string | undefined
    for (const form of forms) {
      const label = escapeRegExp(form.label.toLowerCase())
      const id = escapeRegExp(form.id.toLowerCase())
      const term = `(?:${label}|${id})`
      if (new RegExp(`(?:\\b(?:in|into|as|takes|assumes|shifts|transforms|changes|reveals|returns to|appears in)\\b.{0,65}\\b${term}\\b|\\b${term}\\s+form\\b)`, 'i').test(passage)) {
        mentioned = form.id
      }
    }
    // A clearly human physical entrance can be described without the literal words "human form".
    // Require several distinct cues; a lone "hand" or a metaphor like "dragon daughter" is insufficient.
    const human = forms.find((form) => form.id === 'human')
    if (human && forms.some((form) => form.id === 'dragon') && !mentioned) {
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
  character: { id: string; name: string; outfits?: Outfit[]; sprites?: Record<string, string> },
  primaryCharacterId: string,
  affection: number,
  flags: ReadonlySet<string>,
  override?: string,
): string {
  const allowed = new Set(availableAppearances(character.outfits, character.sprites, affection, flags).map((o) => o.id))
  if (override && allowed.has(override)) return override
  const forms = (character.outfits ?? []).filter((o) => isPhysicalForm(o) && allowed.has(o.id))
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    const scene = message.swipeScenes?.[message.activeSwipe ?? 0] ?? message.scene
    const inferred = message.role === 'char' ? formMentionedInText(message.text ?? '', character.name, forms) : undefined
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
