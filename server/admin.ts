/**
 * Owner-only housekeeping (Settings → Admin): what removed accounts left behind (`leftovers.ts`).
 * Taking it over moves it to the owner as it is; deleting it backs the database up first.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Router } from 'express'
import {
  assistantThreadStore,
  characterStore,
  chatStore,
  dataDir,
  db,
  instructTemplateStore,
  personaStore,
  presetStore,
  removedUserStore,
  storyStore,
  themeStore,
  userStore,
  worldInfoBookStore,
  worldStore,
} from './db.ts'
import { requireOwner } from './auth.ts'
import { userOf } from './access.ts'
import { deleteCharacter, deletePersona, deleteStory, deleteWorld, purgeChat } from './deletion.ts'
import { findLeftovers, OWNED_TABLES, planCleanup, type CleanupMode, type OwnedRows, type RemovedAccount } from './leftovers.ts'
import type { OwnedTable } from './migrations/privateByDefault.ts'

const stores: Record<OwnedTable, typeof worldStore> = {
  worlds: worldStore,
  characters: characterStore,
  world_info_books: worldInfoBookStore,
  personas: personaStore,
  chats: chatStore,
  stories: storyStore,
  presets: presetStore,
  themes: themeStore,
  instruct_templates: instructTemplateStore,
  assistant_threads: assistantThreadStore,
}

/** Deletes one record the way its own delete route does. */
const removers: Record<OwnedTable, (id: string) => void> = {
  worlds: deleteWorld,
  characters: deleteCharacter,
  personas: deletePersona,
  chats: purgeChat,
  stories: deleteStory,
  world_info_books: (id) => worldInfoBookStore.remove(id),
  presets: (id) => presetStore.remove(id),
  themes: (id) => themeStore.remove(id),
  instruct_templates: (id) => instructTemplateStore.remove(id),
  assistant_threads: (id) => assistantThreadStore.remove(id),
}

const allRows = () => Object.fromEntries(OWNED_TABLES.map((table) => [table, stores[table].list()])) as OwnedRows
const liveUserIds = () => new Set(userStore.list().map((u) => String(u.id)))
const removedAccounts = () =>
  new Map<string, RemovedAccount>(removedUserStore.list().map((r) => [String(r.id), { username: r.username as string | undefined, removedAt: r.createdAt as number }]))

function backup(): void {
  const dir = path.join(dataDir, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `before-cleanup-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
}

/** Takes over or deletes what one removed account left behind. Returns how many records each way. */
export function cleanUpLeftovers(formerOwnerId: string, mode: CleanupMode, toUserId: string): { adopted: number; deleted: number } {
  const plan = planCleanup(allRows(), formerOwnerId, mode, liveUserIds())
  if (plan.remove.length) backup()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const { table, id } of plan.adopt) stores[table].update(id, { ownerUserId: toUserId })
    // A story's removal takes its scenes with it, so a scene listed after it may already be gone.
    for (const { table, id } of plan.remove) if (stores[table].get(id)) removers[table](id)
    removedUserStore.remove(formerOwnerId)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return { adopted: plan.adopt.length, deleted: plan.remove.length }
}

export const adminRouter = Router()

adminRouter.get('/api/admin/leftovers', requireOwner, (_req, res) => {
  res.json(findLeftovers(allRows(), liveUserIds(), removedAccounts()))
})

/** `{ action: 'adopt' | 'delete' }`: take it over (as it is) or delete it (what others use passes to you instead). */
adminRouter.post('/api/admin/leftovers/:id', requireOwner, (req, res) => {
  const formerOwnerId = String(req.params.id)
  const action = req.body?.action
  if (action !== 'adopt' && action !== 'delete') return res.status(400).json({ error: 'The action is adopt or delete.' })
  if (userStore.get(formerOwnerId)) return res.status(400).json({ error: 'That account still exists.' })
  res.json(cleanUpLeftovers(formerOwnerId, action, userOf(req)!.id))
})
