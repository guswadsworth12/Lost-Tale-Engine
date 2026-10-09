import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import {
  characterStore, chatCheckpointStore, chatFactStore, chatStore, dataDir, db, messageStore, objectiveStore,
  relationshipEventStore, worldStore,
} from './db.ts'
import { recordIntroductions } from './introductions.ts'
import { retractMessageMemories } from './memories.ts'
import { checkpointOf, planRewind, type Checkpoint } from './rewindPlan.ts'

type Row = Record<string, unknown>

/** The world a scene is set in: its lead character's. */
function worldOf(chat: Row): Row | undefined {
  const character = typeof chat.characterId === 'string' ? characterStore.get(chat.characterId) : undefined
  return typeof character?.worldId === 'string' ? worldStore.get(character.worldId) : undefined
}

const asWorld = (world: Row | undefined) => (world ? { id: String(world.id), currentDay: world.currentDay as number | undefined, currentPhaseIndex: world.currentPhaseIndex as number | undefined } : undefined)

/**
 * Saves the scene's turn state, and its world's clock, as they stand just before `messageId` is
 * added, so a rewind to that message can put them back (#57). Best effort: a missing checkpoint
 * only means a rewind there undoes less.
 */
export function saveCheckpoint(chatId: string, messageId: string): void {
  try {
    const chat = chatStore.get(chatId)
    if (!chat || !messageId || chatCheckpointStore.get(messageId)) return
    chatCheckpointStore.insert({ id: messageId, chatId, createdAt: Date.now(), ...checkpointOf(chat, asWorld(worldOf(chat))) })
  } catch {
    // Never in the way of saving the message itself.
  }
}

/** A scene's checkpoints go with it. */
export function purgeChatCheckpoints(chatId: string): void {
  for (const row of chatCheckpointStore.list({ where: 'chatId = ?', params: [chatId] })) chatCheckpointStore.remove(String(row.id))
}

const KEEP_BACKUPS = 10

/** A copy of the database from just before a rewind; the newest few are kept. */
function backup(): string {
  const dir = path.join(dataDir, 'backups')
  fs.mkdirSync(dir, { recursive: true })
  const name = `pre-rewind-${new Date().toISOString().replace(/[:.]/g, '-')}.db`
  db.exec(`VACUUM INTO '${path.join(dir, name).replace(/'/g, "''")}'`)
  const older = fs.readdirSync(dir).filter((f) => f.startsWith('pre-rewind-') && f.endsWith('.db')).sort().reverse().slice(KEEP_BACKUPS)
  for (const file of older) fs.rmSync(path.join(dir, file), { force: true })
  return name
}

/** Whether any other scene in this world has a message after `cutAt`. */
function othersPlayedSince(chatId: string, worldId: string | undefined, cutAt: number): boolean {
  if (!worldId) return false
  for (const other of chatStore.list()) {
    if (other.id === chatId || other.deletedAt) continue
    if (worldOf(other)?.id !== worldId) continue
    if (messageStore.list({ where: 'chatId = ? AND createdAt > ?', params: [String(other.id), cutAt] }).length) return true
  }
  return false
}

export const rewindRouter = express.Router()

/**
 * `POST /api/chats/:id/rewind { messageId, dryRun?, restoreClock? }`: removes the message and
 * everything after it, and takes the scene back to how it stood just before it (`rewindPlan.ts`).
 * `dryRun` only says what would go. The world clock is wound back only with `restoreClock`, since
 * every story in the world shares it.
 */
rewindRouter.post('/chats/:id/rewind', (req, res) => {
  const chatId = req.params.id
  const chat = chatStore.get(chatId)
  if (!chat) return res.status(404).json({ error: 'Not found' })
  if (chat.endedAt) return res.status(409).json({ error: 'This scene has ended, and an ended scene is read-only history.' })
  const messageId = typeof req.body?.messageId === 'string' ? req.body.messageId : ''
  const messages = messageStore.list({ where: 'chatId = ?', params: [chatId], orderBy: 'createdAt' })
  const world = worldOf(chat)
  const saved = messageId ? chatCheckpointStore.get(messageId) : undefined
  const checkpoint: Checkpoint | undefined = saved && saved.chatId === chatId ? { chat: saved.chat as Row, clock: saved.clock as Checkpoint['clock'] } : undefined
  const target = messages.find((m) => m.id === messageId)
  const plan = planRewind({
    chat,
    messages,
    messageId,
    checkpoint,
    facts: chatFactStore.list({ where: 'chatId = ?', params: [chatId] }),
    events: relationshipEventStore.list({ where: 'chatId = ?', params: [chatId] }),
    objectives: objectiveStore.list({ where: 'chatId = ?', params: [chatId] }),
    world: asWorld(world),
    othersPlayedSince: target ? othersPlayedSince(chatId, world?.id as string | undefined, Number(target.createdAt) || 0) : false,
  })
  if (!plan) return res.status(404).json({ error: 'That message is not in this scene.' })
  if (req.body?.dryRun) return res.json({ summary: plan.summary, clock: plan.clock ?? null })

  const restoreClock = req.body?.restoreClock === true && !!plan.clock && !!world
  const backupFile = backup()
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const id of plan.removeMessageIds) {
      // Memories from the message, and tellings in it, go with it (as deleting one message does).
      retractMessageMemories(chatId, id)
      messageStore.remove(id)
      chatCheckpointStore.remove(id)
    }
    for (const id of plan.deleteFactIds) chatFactStore.remove(id)
    for (const id of plan.deleteEventIds) relationshipEventStore.remove(id)
    for (const id of plan.deleteObjectiveIds) objectiveStore.remove(id)
    for (const { id, patch } of plan.updateObjectives) objectiveStore.update(id, { ...patch, updatedAt: Date.now() })
    if (plan.chatPatch) chatStore.update(chatId, { ...plan.chatPatch, updatedAt: Date.now() })
    recordIntroductions(chatId)
    if (restoreClock) worldStore.update(String(world!.id), { currentDay: plan.clock!.day, currentPhaseIndex: plan.clock!.phaseIndex })
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  res.json({ summary: plan.summary, clockRestored: restoreClock, backup: backupFile })
})
