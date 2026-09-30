/**
 * Revision history: whenever Writer's Room applies a change to a world (its rules, one of its
 * prompts, its GM notes) or a character (its prompt items), what was there before is kept here, so
 * any applied change can be reverted in one step. A revert is itself a change, so it can be undone
 * the same way.
 *
 * Kept on the record (`WorldCard.revisions`, `Character.revisions`), newest first, at most
 * `MAX_REVISIONS`. It is this install's history: it never travels in a pack.
 *
 * Only relative `.ts` imports here: the server loads this file with plain Node.
 */

/** The parts of a world a revision can hold. A keyed field keeps one history per key. */
export const REVISABLE_FIELDS = ['campaign', 'modules', 'promptOverrides', 'gmNotes', 'promptItems'] as const
export type RevisableField = (typeof REVISABLE_FIELDS)[number]
const KEYED: readonly RevisableField[] = ['promptOverrides']

export interface WorldRevision {
  id: string
  at: number
  field: RevisableField
  /** For a keyed field, which entry changed (a prompt's id). */
  key?: string
  /** The value before this change. Unset: there was none. */
  before?: unknown
  /** One line on what the change was, e.g. "Applied Harbor Rules from Writer's Room". */
  label: string
}

export const MAX_REVISIONS = 60
/** The largest `before` kept, as JSON. A bigger one is still applied, just not kept for revert. */
const MAX_BEFORE_CHARS = 200_000

type Revisable = { revisions?: WorldRevision[] } & Partial<Record<RevisableField, unknown>>

/** What a field (or one keyed entry of it) holds now. */
export function currentValue(world: Revisable, field: RevisableField, key?: string): unknown {
  const value = world[field]
  if (!KEYED.includes(field)) return value
  return key !== undefined && value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}

function setValue(world: Revisable, field: RevisableField, key: string | undefined, value: unknown): unknown {
  if (!KEYED.includes(field)) return value === undefined ? null : value
  const entries = { ...((world[field] as Record<string, unknown> | undefined) ?? {}) }
  if (value === undefined) delete entries[key!]
  else entries[key!] = value
  return entries
}

const copy = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))

/**
 * The world patch for one or more changes applied together (a ruleset and the module that turns
 * it on), each recorded as a revision with the value it replaces. `undefined` clears a value.
 */
export function withChanges(
  world: Revisable,
  changes: readonly { field: RevisableField; key?: string; value: unknown; label: string }[],
  now: number,
  newId: () => string,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  const recorded: WorldRevision[] = []
  let working: Revisable = world
  for (const change of changes) {
    if (KEYED.includes(change.field) && !change.key) throw new Error(`A change to ${change.field} needs a key.`)
    const before = currentValue(working, change.field, change.key)
    const kept = before !== undefined && JSON.stringify(before).length <= MAX_BEFORE_CHARS
    recorded.push({ id: newId(), at: now, field: change.field, ...(change.key ? { key: change.key } : {}), ...(kept ? { before: copy(before) } : {}), label: change.label })
    patch[change.field] = setValue(working, change.field, change.key, copy(change.value))
    working = { ...working, [change.field]: patch[change.field] }
  }
  patch.revisions = [...recorded, ...(world.revisions ?? [])].slice(0, MAX_REVISIONS)
  return patch
}

/**
 * Puts a field back to what it was before `revisionId`, recorded as a change of its own ("Reverted:
 * ..."), so the revert can be undone too.
 */
export function revertRevision(world: Revisable, revisionId: string, now: number, newId: () => string): Record<string, unknown> {
  const revision = world.revisions?.find((r) => r.id === revisionId)
  if (!revision) throw new Error('That change is no longer in the history.')
  return withChanges(world, [{ field: revision.field, key: revision.key, value: revision.before, label: `Reverted: ${revision.label}` }], now, newId)
}

/** The history of one field (or one keyed entry), newest first. */
export function revisionsOf(world: Revisable, field: RevisableField, key?: string): WorldRevision[] {
  return (world.revisions ?? []).filter((r) => r.field === field && (key === undefined || r.key === key))
}

/** A world's or character's history from a request: known fields only, newest first, capped. */
export function normalizeWorldRevisions(raw: unknown): WorldRevision[] | undefined {
  if (!Array.isArray(raw)) return undefined
  return raw.slice(0, MAX_REVISIONS).flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const v = entry as Record<string, unknown>
    const field = REVISABLE_FIELDS.find((f) => f === v.field)
    const id = typeof v.id === 'string' ? v.id.slice(0, 100) : ''
    const label = typeof v.label === 'string' ? v.label.trim().slice(0, 200) : ''
    if (!field || !id || !label || typeof v.at !== 'number' || !Number.isFinite(v.at)) return []
    const key = typeof v.key === 'string' && v.key ? v.key.slice(0, 100) : undefined
    if (KEYED.includes(field) && !key) return []
    const before = v.before !== undefined && JSON.stringify(v.before).length <= MAX_BEFORE_CHARS ? v.before : undefined
    return [{ id, at: v.at, field, ...(key ? { key } : {}), ...(before !== undefined ? { before } : {}), label }]
  })
}
