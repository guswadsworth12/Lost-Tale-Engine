/**
 * One-time move to "private unless shared on purpose" (`ownership.ts`).
 *
 * Before this, a world, character, world-info book or persona was everyone's unless made private,
 * and the create routes stamped new ones `shared` by default. None of those `shared` values was a
 * choice, so every one becomes private to its owner, and anything with no owner (made before
 * accounts) becomes the site owner's. Sharing is chosen again from here on, by the owner. The
 * starter content bundled with the app (`SHARED_SEED_IDS`) is shared on purpose, so it stays shared.
 *
 * Stories and personal records (presets, themes, instruct templates, Writer's Room threads) get the
 * site owner as their owner where they have none; they are never shared.
 *
 * Runs once per install: a marker file records that it has, so a later deliberate share is never
 * undone. The database is backed up before anything is written.
 */

type Row = Record<string, unknown>

export const PRIVATE_BY_DEFAULT_MARKER = 'private-by-default.done'

/** What can be shared, and what is always its owner's. */
export const SHAREABLE_TABLES = ['worlds', 'characters', 'world_info_books', 'personas'] as const
export const PERSONAL_TABLES = ['chats', 'stories', 'presets', 'themes', 'instruct_templates', 'assistant_threads'] as const
export type OwnedTable = (typeof SHAREABLE_TABLES)[number] | (typeof PERSONAL_TABLES)[number]

export interface RowPatch {
  table: OwnedTable
  id: string
  patch: Row
}

/**
 * The patches that make an install private by default. `siteOwnerId` is the first owner account
 * (undefined on an install nobody has signed up to yet: then only the bundled content is touched,
 * and anything without an owner falls to whoever becomes the site owner).
 */
export function planPrivateByDefault(
  rows: Record<OwnedTable, Row[]>,
  siteOwnerId: string | undefined,
  sharedSeedIds: ReadonlySet<string>,
): RowPatch[] {
  const patches: RowPatch[] = []
  for (const table of SHAREABLE_TABLES) {
    for (const row of rows[table] ?? []) {
      const id = String(row.id)
      if (sharedSeedIds.has(id)) {
        if (row.visibility !== 'shared') patches.push({ table, id, patch: { visibility: 'shared' } })
        continue
      }
      const owner = typeof row.ownerUserId === 'string' && row.ownerUserId ? row.ownerUserId : siteOwnerId
      const patch: Row = {}
      if (row.visibility !== 'private') patch.visibility = 'private'
      if (owner && owner !== row.ownerUserId) patch.ownerUserId = owner
      if (Object.keys(patch).length) patches.push({ table, id, patch })
    }
  }
  if (siteOwnerId) {
    for (const table of PERSONAL_TABLES) {
      for (const row of rows[table] ?? []) {
        if (typeof row.ownerUserId === 'string' && row.ownerUserId) continue
        patches.push({ table, id: String(row.id), patch: { ownerUserId: siteOwnerId } })
      }
    }
  }
  return patches
}

export interface PrivateByDefaultDeps {
  /** Every row of a table. */
  list: (table: OwnedTable) => Row[]
  update: (table: OwnedTable, id: string, patch: Row) => void
  siteOwnerId: () => string | undefined
  sharedSeedIds: ReadonlySet<string>
  /** Whether it has run, and recording that it has. */
  done: () => boolean
  markDone: () => void
  backup: () => void
  transaction: (fn: () => void) => void
  log: (message: string) => void
}

export function makePrivateByDefault(deps: PrivateByDefaultDeps): void {
  if (deps.done()) return
  const rows = Object.fromEntries([...SHAREABLE_TABLES, ...PERSONAL_TABLES].map((table) => [table, deps.list(table)])) as Record<OwnedTable, Row[]>
  const patches = planPrivateByDefault(rows, deps.siteOwnerId(), deps.sharedSeedIds)
  if (patches.length) {
    deps.backup()
    deps.transaction(() => {
      for (const { table, id, patch } of patches) deps.update(table, id, patch)
    })
    deps.log(`[rp-server] made ${patches.length} records private to their owners (sharing is now chosen, never the default)`)
  }
  deps.markDone()
}
