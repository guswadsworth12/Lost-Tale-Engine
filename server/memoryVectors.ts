import express from 'express'
import { characterStore, chatStore, db, memoryStore, memoryVectorStore, worldStore } from './db.ts'
import { canSeeCharacter, canSeeChat } from './access.ts'
import { chainOf, memoriesIn } from './memories.ts'
import { modulesForWorld } from '../src/lib/world/worldTemplates.ts'
import { MAX_VECTOR_DIMS, normalizeVector } from '../src/lib/memory/vector.ts'
import { memorySimilarities, memoryTextHash } from './memoryVectorPlan.ts'

export const memoryVectorsRouter = express.Router()
const modelName = (v: unknown): v is string => typeof v === 'string' && !!v.trim() && v.length <= 512
const enabled = (chat: Record<string, unknown>) => modulesForWorld(worldStore.get(String(characterStore.get(String(chat.characterId))?.worldId)) as Parameters<typeof modulesForWorld>[0]).deepMemory

memoryVectorsRouter.get('/chats/:id/memory-vectors/missing', (req, res) => {
  const chat = chatStore.get(req.params.id)
  if (!chat || !canSeeChat(req, chat)) return res.status(404).json({ error: 'Not found' })
  if (!enabled(chat)) return res.status(409).json({ error: 'Deep Memory is off.' })
  const model = req.query.model
  if (!modelName(model)) return res.status(400).json({ error: 'Choose an embedding model.' })
  const dims = req.query.dims === undefined ? undefined : Number(req.query.dims)
  if (dims !== undefined && (!Number.isInteger(dims) || dims < 1 || dims > MAX_VECTOR_DIMS)) return res.status(400).json({ error: 'Invalid embedding dimensions.' })
  const visible = memoriesIn(chainOf(req.params.id)).filter((m) => canSeeChat(req, chatStore.get(m.chatId)))
  const missing = visible.filter((m) => m.active && m.kind !== 'journal')
    .map((m) => ({ memoryId: m.id, text: m.text, textHash: memoryTextHash(model, m.text) }))
    .filter((m) => !memoryVectorStore.current(m.memoryId, model, m.textHash, dims))
  res.json({ total: missing.length, missing: missing.slice(0, 32) })
})

memoryVectorsRouter.put('/memory-vectors', (req, res) => {
  const rows = req.body?.vectors
  if (!Array.isArray(rows) || rows.length > 32) return res.status(400).json({ error: 'Send up to 32 vectors.' })
  const prepared: { memoryId: string; model: string; dims: number; textHash: string; vector: Float32Array }[] = []
  for (const row of rows) {
    if (!row || typeof row.memoryId !== 'string' || !modelName(row.model) || !Array.isArray(row.vector) || row.dims !== row.vector.length) return res.status(400).json({ error: 'Invalid embedding.' })
    const memory = memoryStore.get(row.memoryId)
    const chat = memory && chatStore.get(String(memory.chatId))
    if (!memory || !chat || !canSeeChat(req, chat)) return res.status(404).json({ error: 'Not found' })
    if (!enabled(chat)) return res.status(409).json({ error: 'Deep Memory is off.' })
    if (row.textHash !== memoryTextHash(row.model, String(memory.text))) return res.status(409).json({ error: 'The memory changed. Index it again.' })
    let vector: Float32Array
    try { vector = normalizeVector(row.vector) } catch { return res.status(400).json({ error: 'Invalid embedding vector.' }) }
    prepared.push({ ...row, vector })
  }
  db.exec('BEGIN')
  try {
    for (const row of prepared) memoryVectorStore.insert(row)
    db.exec('COMMIT')
  } catch (e) { db.exec('ROLLBACK'); throw e }
  res.status(204).end()
})

memoryVectorsRouter.post('/chats/:id/memory-similarity', (req, res) => {
  const chat = chatStore.get(req.params.id)
  const { characterId, model, vector } = req.body ?? {}
  const character = typeof characterId === 'string' ? characterStore.get(characterId) : undefined
  if (!chat || !character || !canSeeChat(req, chat) || !canSeeCharacter(req, character)) return res.status(404).json({ error: 'Not found' })
  if (!enabled(chat)) return res.status(409).json({ error: 'Deep Memory is off.' })
  if (!modelName(model) || !Array.isArray(vector)) return res.status(400).json({ error: 'Invalid embedding query.' })
  let query: Float32Array
  try { query = normalizeVector(vector) } catch { return res.status(400).json({ error: 'Invalid embedding vector.' }) }
  const chain = new Set(chainOf(req.params.id))
  const memories = memoriesIn([...chain]).filter((m) => canSeeChat(req, chatStore.get(m.chatId)))
  res.json(memorySimilarities(memories, chain, characterId, model, query, (id) => memoryVectorStore.get(id, model)))
})
