/**
 * What removed accounts left behind, and what cleaning it up does. Pure: `admin.ts` reads the rows
 * and applies the plan.
 *
 * Removing an account keeps everything it made, owned by an id nobody signs in as, so no one can
 * see or reach it. The owner either takes it all (it keeps its sharing) or deletes it. Deleting
 * never takes anything from anyone else: what the account had shared, and what a living account
 * still uses (a character in their chat, a world their character lives in, a persona their chat
 * plays), passes to the owner instead.
 */
import { PERSONAL_TABLES, SHAREABLE_TABLES, type OwnedTable } from './migrations/privateByDefault.ts'

type Row = Record<string, unknown>
export type OwnedRows = Record<OwnedTable, Row[]>

export interface RemovedAccount {
  username?: string
  /** When it was removed. */
  removedAt?: number
}

export interface LeftoverAccount {
  formerOwnerId: string
  /** Unknown for accounts removed before removals were recorded. */
  username?: string
  removedAt?: number
  /** How many of each kind of record. */
  counts: Partial<Record<OwnedTable, number>>
  total: number
  /** Of the worlds, characters, lore books and personas, how many were shared. */
  shared: number
}

export type CleanupMode = 'adopt' | 'delete'

export interface RowRef {
  table: OwnedTable
  id: string
}

export interface CleanupPlan {
  /** Passes to the owner as it is. */
  adopt: RowRef[]
  /** Deleted, with everything that hangs off it. Stories come first, so their scenes go with them. */
  remove: RowRef[]
}

export const OWNED_TABLES: readonly OwnedTable[] = [...SHAREABLE_TABLES, ...PERSONAL_TABLES]

/** Deletion order: whole stories, then loose chats, then what chats point at, then the rest. */
const REMOVE_ORDER: readonly OwnedTable[] = [
  'stories', 'chats', 'characters', 'personas', 'worlds', 'world_info_books', 'presets', 'themes', 'instruct_templates', 'assistant_threads',
]

const ownerOf = (row: Row): string | undefined => (typeof row.ownerUserId === 'string' && row.ownerUserId ? row.ownerUserId : undefined)

/** Every account that left records behind, newest removal first. */
export function findLeftovers(rows: OwnedRows, liveUserIds: ReadonlySet<string>, removed: ReadonlyMap<string, RemovedAccount>): LeftoverAccount[] {
  const byOwner = new Map<string, LeftoverAccount>()
  for (const table of OWNED_TABLES) {
    for (const row of rows[table] ?? []) {
      const owner = ownerOf(row)
      if (!owner || liveUserIds.has(owner)) continue
      let entry = byOwner.get(owner)
      if (!entry) {
        const known = removed.get(owner)
        entry = { formerOwnerId: owner, ...(known?.username ? { username: known.username } : {}), ...(known?.removedAt ? { removedAt: known.removedAt } : {}), counts: {}, total: 0, shared: 0 }
        byOwner.set(owner, entry)
      }
      entry.counts[table] = (entry.counts[table] ?? 0) + 1
      entry.total += 1
      if ((SHAREABLE_TABLES as readonly string[]).includes(table) && row.visibility === 'shared') entry.shared += 1
    }
  }
  return [...byOwner.values()].sort((a, b) => (b.removedAt ?? 0) - (a.removedAt ?? 0))
}

/** Whether a living account still depends on this record, so deleting it would take something from them. */
function usedByOthers(table: OwnedTable, id: string, rows: OwnedRows, liveUserIds: ReadonlySet<string>): boolean {
  const living = (row: Row) => {
    const owner = ownerOf(row)
    return !!owner && liveUserIds.has(owner)
  }
  const chats = (rows.chats ?? []).filter(living)
  switch (table) {
    case 'characters':
      return chats.some((c) => c.characterId === id || (Array.isArray(c.participants) && c.participants.includes(id)))
        || (rows.world_info_books ?? []).some((b) => living(b) && Array.isArray(b.boundCharacterIds) && b.boundCharacterIds.includes(id))
    case 'worlds':
      return (rows.characters ?? []).some((c) => living(c) && c.worldId === id) || chats.some((c) => c.worldId === id)
    case 'personas':
      return chats.some((c) => c.personaId === id)
    default:
      return false
  }
}

/** What cleaning up one removed account does. */
export function planCleanup(rows: OwnedRows, formerOwnerId: string, mode: CleanupMode, liveUserIds: ReadonlySet<string>): CleanupPlan {
  const plan: CleanupPlan = { adopt: [], remove: [] }
  if (!formerOwnerId || liveUserIds.has(formerOwnerId)) return plan
  for (const table of REMOVE_ORDER) {
    for (const row of rows[table] ?? []) {
      if (ownerOf(row) !== formerOwnerId) continue
      const ref = { table, id: String(row.id) }
      const keep = mode === 'adopt' || row.visibility === 'shared' || usedByOthers(table, ref.id, rows, liveUserIds)
      ;(keep ? plan.adopt : plan.remove).push(ref)
    }
  }
  return plan
}
