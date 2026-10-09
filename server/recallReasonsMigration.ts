import type { DatabaseSync } from 'node:sqlite'
export function migrateRecallReasons(db: DatabaseSync): void {
  if (!(db.prepare('PRAGMA table_info(memory_recall_events)').all() as { name: string }[]).some((c) => c.name === 'reasons')) {
    db.exec('ALTER TABLE memory_recall_events ADD COLUMN reasons TEXT')
  }
}
