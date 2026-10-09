import type { DatabaseSync } from 'node:sqlite'
/** Optional columns only; old JSON exports retain their weights on first startup. */
export function migrateLinkWeights(db: DatabaseSync): void {
  for (const [name, type] of [['weight', 'REAL'], ['lastUsedAt', 'INTEGER']]) {
    if (!(db.prepare('PRAGMA table_info(memory_links)').all() as { name: string }[]).some((c) => c.name === name)) {
      db.exec(`ALTER TABLE memory_links ADD COLUMN ${name} ${type}`)
      db.exec(`UPDATE memory_links SET ${name} = json_extract(data, '$.${name}')`)
    }
  }
}
