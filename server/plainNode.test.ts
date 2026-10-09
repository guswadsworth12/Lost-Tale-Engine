import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * `npm start` and the Docker image run the server with plain Node, not tsx or Vite: no `@/` alias,
 * and a runtime import needs its `.ts` extension. Vitest resolves both, so a slip passes every
 * other test and only breaks production. This loads the server the way production does.
 */
describe('the server under plain Node', () => {
  it('loads every module it imports', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-tales-plain-node-'))
    try {
      const result = spawnSync(process.execPath, ['--experimental-sqlite', '--input-type=module', '-e',
        "await import('./server/app.ts'); console.log('LOADED')"], {
        cwd: path.resolve(__dirname, '..'),
        env: { ...process.env, LOST_TALES_DATA_DIR: dataDir, NODE_OPTIONS: '' },
        encoding: 'utf8',
        timeout: 60_000,
      })
      expect(result.stderr.split('\n').filter((line) => /Error|Cannot find/.test(line)).join('\n')).toBe('')
      expect(result.stdout).toContain('LOADED')
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }, 60_000)
  it('adds and indexes optional link provenance from the earlier development schema', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-tales-link-column-'))
    try {
      const result = spawnSync(process.execPath, ['--experimental-sqlite', '--input-type=module', '-e', `
        import { DatabaseSync } from 'node:sqlite';
        import path from 'node:path';
        const fixture = new DatabaseSync(path.join(process.env.LOST_TALES_DATA_DIR, 'rp.db'));
        fixture.exec('CREATE TABLE memory_links (id TEXT PRIMARY KEY, memoryId TEXT, fromKind TEXT, fromId TEXT, relation TEXT, toKind TEXT, toId TEXT, validFrom INTEGER, validTo INTEGER, closedByMessageId TEXT, createdAt INTEGER, data TEXT NOT NULL)');
        fixture.prepare('INSERT INTO memory_links (id, data) VALUES (?, ?)').run('edge', JSON.stringify({ id: 'edge', sourceMessageId: 'retiring-message' }));
        fixture.close();
        const { db } = await import('./server/db.ts');
        console.log(JSON.stringify({ row: db.prepare('SELECT sourceMessageId FROM memory_links').get(), plan: db.prepare('EXPLAIN QUERY PLAN DELETE FROM memory_links WHERE sourceMessageId = ?').all('retiring-message') }));
        db.close();
      `], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, LOST_TALES_DATA_DIR: dataDir, NODE_OPTIONS: '' }, encoding: 'utf8', timeout: 60_000 })
      expect(result.status).toBe(0)
      const output = JSON.parse(result.stdout)
      expect(output.row.sourceMessageId).toBe('retiring-message')
      expect(output.plan.some((row: { detail: string }) => row.detail.includes('idx_memory_links_sourceMessageId'))).toBe(true)
    } finally { fs.rmSync(dataDir, { recursive: true, force: true }) }
  }, 60_000)

})
