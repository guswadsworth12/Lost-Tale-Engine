import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { sceneChainIds } from '../memoryPlan'
import { sceneSettingFrom } from '../../src/lib/chat/sceneSetting'
import { backgroundLabel } from '../../src/lib/vn/backgrounds'
import { witnessedMessage } from '../../src/lib/memory/witnesses'
import { parseCase } from './bench'

/** Owner-run only. No app/db import: that would open the configured store and run migrations. */
export function exportCase(databasePath: string, chatId: string, speakerId: string, expectedIds: string[], question: string) {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  type Row = Record<string, any>
  const decode = (row: Row): Row => {
    const { data, ...columns } = row
    return { ...JSON.parse(data), ...columns }
  }
  const get = (table: 'chats' | 'stories' | 'characters' | 'worlds', id: string): Row | undefined => {
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id)
    return row ? decode(row) : undefined
  }
  try {
    const chat = get('chats', chatId)
    if (!chat) throw new Error('Scene not found.')
    const chain = sceneChainIds(chatId, (id) => get('chats', id), (id) => get('stories', id))
    const memories = db.prepare(`SELECT * FROM memories WHERE chatId IN (${chain.map(() => '?').join(', ')}) ORDER BY createdAt, id`)
      .all(...chain).map(decode)
    const now = Date.now()
    if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_recalls'").get()) {
      const recalls = db.prepare('SELECT * FROM memory_recalls WHERE characterId = ?').all(speakerId)
      for (const row of recalls) {
        const events = (JSON.parse(String(row.events)) as { chatId: string; at: number }[]).filter((e) => chain.includes(e.chatId))
        const memory = memories.find((m) => m.id === row.memoryId)
        if (memory && events.length) memory.recalls = { count: events.length, lastAt: Math.max(...events.map((e) => e.at)) }
      }
    }
    const chats = chain.map((id) => {
      const row = get('chats', id)!
      return { id, previousSceneId: row.previousSceneId, storyId: row.storyId }
    })
    // Include only ids for out-of-branch tellings, so the evaluator can reject their knowledge.
    const otherChats = new Set<string>(memories.flatMap((m) => (m.toldVia ?? []).map((t: Row) => t.chatId).filter(Boolean)))
    for (const id of otherChats) if (!chain.includes(id)) chats.push({ id, previousSceneId: undefined, storyId: undefined })
    const stories = [...new Set(chats.map((c) => c.storyId).filter(Boolean))].map((id) => ({ id, continuesFrom: get('stories', id)?.continuesFrom }))
    const presentIds = chat.scene?.presentCharacterIds ?? [chat.characterId, ...(chat.participants ?? [])].filter(Boolean)
    const ids = new Set<string>([speakerId, ...presentIds, ...memories.flatMap((m) => [
      ...m.witnesses, ...m.knownBy, ...(m.about ?? []), ...(m.consolidatedFor ?? []),
      ...Object.keys(m.feelings ?? {}), ...(m.toldVia ?? []).flatMap((t: Row) => t.to),
    ])])
    const cast = [...ids].map((id) => ({ id, name: get('characters', id)?.card?.name ?? id }))
    const branch = db.prepare('SELECT * FROM messages WHERE chatId = ? ORDER BY createdAt, id').all(chatId).map(decode)
    const worldId = get('characters', String(chat.characterId))?.worldId
    const world = worldId ? get('worlds', String(worldId)) : undefined
    const setting = sceneSettingFrom(branch as unknown as Parameters<typeof sceneSettingFrom>[0], chat.scene, (id) => backgroundLabel(id, world))
    const recentMessages = branch.filter((m) => !m.failed && witnessedMessage(m as Parameters<typeof witnessedMessage>[0], speakerId))
      .map((m) => m.text).filter((v): v is string => typeof v === 'string' && !!v.trim()).slice(-6)
    return parseCase({
      id: chatId, category: 'private', cast, memories, chats, stories,
      scene: { chatId, speakerId, presentIds, location: setting.location, atmosphere: setting.atmosphere, recentMessages, now },
      question, expectedIds, forbiddenIds: [], mustNeverRegress: false,
    })
  } finally { db.close() }
}

export function exportLocal(args: string[], cwd = process.cwd()): string {
  const options = new Map<string, string>()
  const flags = ['--database', '--chat', '--speaker', '--expected', '--question']
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (!flags.includes(flag)) throw new Error(`Unknown export option: ${flag}`)
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    if (options.has(flag)) throw new Error(`Duplicate export option: ${flag}`)
    options.set(flag, value)
  }
  for (const flag of flags) if (!options.has(flag)) throw new Error(`${flag} is required`)
  const chatId = options.get('--chat')!
  if (!/^[a-zA-Z0-9_-]+$/.test(chatId)) throw new Error('Scene id must contain only letters, numbers, underscores or hyphens.')
  const result = exportCase(options.get('--database')!, chatId, options.get('--speaker')!, options.get('--expected')!.split(',').map((s) => s.trim()), options.get('--question')!)
  const dir = path.join(cwd, '.memory-eval/private')
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const output = path.join(dir, `${chatId}.json`)
  fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(`Saved local case: ${exportLocal(process.argv.slice(2))}`) }
  catch (error) {
    console.error('Export failed. Check the options, database schema, scene and expected memory ids. Existing exports are never overwritten.')
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
