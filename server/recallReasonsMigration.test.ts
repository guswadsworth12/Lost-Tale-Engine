import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { migrateRecallReasons } from './recallReasonsMigration.ts'
import { validRecallReasons } from './recallReasons.ts'
it('adds the nullable reasons column once without changing old events or saved reasons', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec("CREATE TABLE memory_recall_events (memoryId TEXT); INSERT INTO memory_recall_events VALUES ('synthetic-memory')")
    migrateRecallReasons(db); migrateRecallReasons(db)
    expect(db.prepare('SELECT * FROM memory_recall_events').get()).toMatchObject({ memoryId: 'synthetic-memory', reasons: null })
    db.prepare('UPDATE memory_recall_events SET reasons = ?').run('{"score":1}')
    migrateRecallReasons(db)
    expect(db.prepare('SELECT reasons FROM memory_recall_events').get()?.reasons).toBe('{"score":1}')
  } finally { db.close() }
})
it('rejects nonfinite numbers and bounds each array, name and map as well as allowed keys', () => {
  const base = { pinned: false, openThread: false, recent: false, important: false, aboutPresent: [], matchedWords: [], score: 0 }
  expect(validRecallReasons(base)).toBe(true)
  expect(validRecallReasons({ ...base, score: Infinity })).toBe(false)
  expect(validRecallReasons({ ...base, linkedWeights: { Mara: NaN } })).toBe(false)
  expect(validRecallReasons({ ...base, linkedWeights: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [String(i), 1])) })).toBe(false)
  expect(validRecallReasons({ ...base, aboutPresent: ['a'.repeat(81)] })).toBe(false)
  expect(validRecallReasons({ ...base, surprise: true })).toBe(false)
})
