import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { migrateLinkWeights } from './linkWeightMigration'
it('adds only two nullable columns to an old database and reruns without changing stored weights', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('CREATE TABLE memory_links (id TEXT, data TEXT)')
    db.prepare('INSERT INTO memory_links VALUES (?, ?)').run('old', '{"weight":1.4,"lastUsedAt":123}')
    db.prepare('INSERT INTO memory_links VALUES (?, ?)').run('legacy', '{}')
    migrateLinkWeights(db); migrateLinkWeights(db)
    expect(db.prepare('SELECT weight, lastUsedAt FROM memory_links WHERE id = ?').get('old')).toMatchObject({ weight: 1.4, lastUsedAt: 123 })
    expect(db.prepare('SELECT weight, lastUsedAt FROM memory_links WHERE id = ?').get('legacy')).toMatchObject({ weight: null, lastUsedAt: null })
    expect(db.prepare('PRAGMA table_info(memory_links)').all()).toHaveLength(4)
  } finally { db.close() }
})
