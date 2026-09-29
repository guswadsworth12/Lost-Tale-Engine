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
})
