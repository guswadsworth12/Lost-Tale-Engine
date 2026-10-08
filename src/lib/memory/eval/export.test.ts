import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { exportCase, exportLocal } from './export'
import { evaluateCase } from './bench'

describe('private recall export', () => {
  it('exports a synthetic scene read-only, without card descriptions or unrelated stories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-export-'))
    const file = path.join(dir, 'synthetic.db')
    const db = new DatabaseSync(file)
    const put = (table: string, id: string, data: Record<string, unknown>) => {
      if (table === 'memories' || table === 'messages') {
        const { chatId, createdAt, ...rest } = data
        db.prepare(`INSERT INTO ${table} (id, data, chatId, createdAt) VALUES (?, ?, ?, ?)`).run(id, JSON.stringify(rest), String(chatId), Number(createdAt))
      } else db.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?)`).run(id, JSON.stringify(data))
    }
    try {
      for (const table of ['chats', 'stories', 'characters']) db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, data TEXT)`)
      for (const table of ['messages', 'memories']) db.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY, data TEXT, chatId TEXT, createdAt INTEGER)`)
      put('chats', 'past', { storyId: 'first' })
      put('chats', 'now', { previousSceneId: 'past', storyId: 'first', characterId: 'aveline', scene: { location: 'Quay', presentCharacterIds: ['aveline'] } })
      put('chats', 'unrelated', { summary: 'DO NOT EXPORT' })
      put('stories', 'first', { title: 'DO NOT EXPORT' })
      put('characters', 'aveline', { card: { name: 'Aveline', description: 'DO NOT EXPORT' } })
      put('characters', 'tavi', { card: { name: 'Tavi' } })
      put('messages', 'line', { chatId: 'now', text: 'Remember the quay?', createdAt: 3 })
      put('messages', 'elsewhere', { chatId: 'unrelated', text: 'DO NOT EXPORT', createdAt: 4 })
      put('messages', 'unheard', { chatId: 'now', text: 'DO NOT EXPORT', presentIds: ['tavi'], createdAt: 5 })
      const memory = { chatId: 'past', text: 'Aveline met Tavi at the quay.', kind: 'event', importance: 0.8, witnesses: ['aveline'], knownBy: ['aveline'], active: true, origin: 'manual', createdAt: 1 }
      put('memories', 'wanted', memory)
      put('memories', 'secret', { ...memory, witnesses: ['tavi'], knownBy: ['tavi', 'aveline'], toldVia: [{ to: ['aveline'], chatId: 'unrelated', at: 2 }] })
      db.close()
      const before = fs.readFileSync(file)
      const result = exportCase(file, 'now', 'aveline', ['wanted'], 'What happened at the quay?')
      expect(JSON.stringify(result)).not.toContain('DO NOT EXPORT')
      expect(result.scene.location).toBe('Quay')
      expect(result.scene.recentMessages).toEqual(['Remember the quay?'])
      expect(evaluateCase(result).picks.map((p) => p.memory.id)).toEqual(['wanted'])
      expect(fs.readFileSync(file)).toEqual(before)
      const output = exportLocal(['--database', file, '--chat', 'now', '--speaker', 'aveline', '--expected', 'wanted', '--question', 'What happened?'], dir)
      expect(output).toBe(path.join(dir, '.memory-eval/private/now.json'))
      expect(fs.statSync(output).mode & 0o777).toBe(0o600)
      expect(() => exportLocal(['--database', file, '--chat', 'now', '--speaker', 'aveline', '--expected', 'wanted', '--question', 'What happened?'], dir)).toThrow()
      expect(() => exportCase(file, 'missing', 'aveline', ['wanted'], 'What happened?')).toThrow()
    } finally {
      try { db.close() } catch { /* Already closed before the read-only check. */ }
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('requires explicit database and labels, with no default real-data path', () => {
    expect(() => exportLocal([])).toThrow(/--database/)
    expect(() => exportLocal(['--unknown', 'value'])).toThrow(/Unknown/)
    expect(() => exportLocal(['--database'])).toThrow(/value/)
  })
})
