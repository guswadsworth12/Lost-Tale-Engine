import type { BehavioralRule, Character, VoiceFingerprint } from './cardSpec'

/**
 * Builds the "Life beyond this scene" and voice-fingerprint notes folded into a character's
 * identity block in the prompt.
 */

// Caps for free-typed profile lists so they can't grow unbounded. `boundaries` is left uncapped
// since dropping a stated hard limit for being "too many" would be a content-safety risk.
const MAX_LIKES = 8
const MAX_GOALS = 5
const MAX_LOCATIONS = 5
const MAX_SOCIAL_CONNECTIONS = 6
const MAX_BEHAVIORAL_RULES = 10

/** Composes occupation, locations, likes/goals/boundaries, and social connections into one "Life beyond this scene" line. Returns undefined if nothing is set. */
function buildLifeContextNote(character: Character): string | undefined {
  const { occupation, workplace, homeLocation, frequentedLocations, likes, goals, boundaries, socialConnections } = character
  const parts: string[] = []
  if (occupation?.trim() || workplace?.trim()) {
    parts.push(
      [occupation?.trim() ? `Works as ${occupation.trim()}` : 'Has a life outside this conversation', workplace?.trim() ? `at ${workplace.trim()}` : '']
        .filter(Boolean)
        .join(' '),
    )
  }
  if (homeLocation?.trim()) parts.push(`Lives at ${homeLocation.trim()}`)
  if (frequentedLocations?.length) parts.push(`Often found at ${frequentedLocations.slice(0, MAX_LOCATIONS).join(', ')}`)
  if (likes?.length) parts.push(`Enjoys ${likes.slice(0, MAX_LIKES).join(', ')}`)
  if (goals?.length) parts.push(`Currently working toward: ${goals.slice(0, MAX_GOALS).join(', ')}`)
  if (boundaries?.length) parts.push(`Hard limits, never crossed even in character: ${boundaries.join(', ')}`)
  if (socialConnections?.length) {
    const roster = socialConnections
      .slice(0, MAX_SOCIAL_CONNECTIONS)
      .map((c) => `${c.name} (${c.relation}${c.notes ? ` — ${c.notes}` : ''})`)
      .join('; ')
    parts.push(`Knows: ${roster}`)
  }
  if (parts.length === 0) return undefined
  return `Life beyond this scene: ${parts.join('. ')}.`
}

/** Composes structured `when X → Y` / `never: Z` rules for review alongside the current card. */
function buildBehavioralRulesNote(rules: BehavioralRule[] | undefined): string | undefined {
  const usable = (rules ?? []).filter((r) => r.then.trim())
  if (usable.length === 0) return undefined
  const lines = usable
    .slice(0, MAX_BEHAVIORAL_RULES)
    .map((r) => (r.kind === 'never' ? `Never: ${r.then.trim()}.` : `When ${r.when?.trim() || 'it comes up'}: ${r.then.trim()}.`))
  return `Additional behavioral rules (review these against the current personality and examples; current explicit author guidance takes precedence if they conflict):\n${lines.join('\n')}`
}

/** Keep dialect and rhythm; recorded tics and catchphrases are references, not turn requirements. */
function buildVoiceFingerprintNote(fingerprint: VoiceFingerprint | undefined): string | undefined {
  if (!fingerprint) return undefined
  const bits: string[] = []
  if (fingerprint.dialectNotes?.trim()) bits.push(`dialect/register: ${fingerprint.dialectNotes.trim()}`)
  if (fingerprint.sentenceRhythm?.trim()) bits.push(`sentence rhythm: ${fingerprint.sentenceRhythm.trim()}`)
  if (bits.length === 0) return undefined
  return `Voice guidance: ${bits.join('; ')}. Examples illustrate voice; do not force a tic or catchphrase into a reply.`
}

/** Combines life context, rules, and voice guidance for `builder.ts`. */
export function buildCharacterProfileNote(character: Character): string | undefined {
  const blocks = [
    buildLifeContextNote(character),
    buildBehavioralRulesNote(character.behavioralRules),
    buildVoiceFingerprintNote(character.voiceFingerprint),
  ].filter((b): b is string => !!b)
  return blocks.length ? blocks.join('\n') : undefined
}
