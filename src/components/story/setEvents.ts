import type { SetEvent } from '@/lib/world/gm'

/** A set event as its editor form holds it: the recognising words as one line of text. */
export interface SetEventDraft {
  id: string
  trigger: string
  outcome: string
  consequence: string
  words: string
}

export function draftOf(event: SetEvent): SetEventDraft {
  return {
    id: event.id,
    trigger: event.trigger,
    outcome: event.outcome,
    consequence: event.consequence ?? '',
    words: (event.match ?? []).join(', '),
  }
}

/** "bind, Emily | Unbound" → ['bind', 'Emily|Unbound']: commas separate required words, a bar offers alternatives. */
export function wordsToMatch(words: string): string[] {
  return words
    .split(',')
    .map((group) => group.split('|').map((w) => w.trim()).filter(Boolean).join('|'))
    .filter(Boolean)
}

/** A readable id from the trigger, kept unique among `taken`: "Rend binds Emily's form" → "rend-binds-emilys-form". */
export function setEventId(trigger: string, taken: readonly string[]): string {
  const base = trigger.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'event'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

/** Drafts back to saved events. A draft without a trigger and an outcome is dropped: it cannot happen as written. */
export function eventsFromDrafts(drafts: readonly SetEventDraft[]): SetEvent[] {
  const events: SetEvent[] = []
  for (const draft of drafts) {
    const trigger = draft.trigger.trim()
    const outcome = draft.outcome.trim()
    if (!trigger || !outcome) continue
    const match = wordsToMatch(draft.words)
    const consequence = draft.consequence.trim()
    events.push({
      id: draft.id || setEventId(trigger, events.map((e) => e.id)),
      trigger,
      outcome,
      ...(consequence ? { consequence } : {}),
      ...(match.length ? { match } : {}),
    })
  }
  return events
}
