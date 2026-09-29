import express from 'express'
import { chatFactStore, chatStore, newId, objectiveStore, relationshipEventStore, storyStore } from './db.ts'
import { planNextScene, type NextSceneRequest } from './storyPlan.ts'

/**
 * Stories made of scenes. A scene is an ordinary chat carrying `storyId`; ending one writes its
 * recap and opens the next scene as a fresh chat that inherits the story's state but not its
 * transcript, so each scene's context stays small. See `planNextScene` for what carries over.
 */

type Row = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export const storiesRouter = express.Router()

storiesRouter.get('/stories', (_req, res) => {
  res.json(storyStore.list({ orderBy: 'updatedAt DESC' }))
})

storiesRouter.get('/stories/:id', (req, res) => {
  const row = storyStore.get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

/** The story's scenes, oldest first. Scenes in the trash are left out. */
storiesRouter.get('/stories/:id/scenes', (req, res) => {
  const scenes = chatStore
    .list({ orderBy: 'createdAt' })
    .filter((c) => c.storyId === req.params.id && !c.deletedAt)
    .sort((a, b) => ((a.sceneNumber as number) ?? 0) - ((b.sceneNumber as number) ?? 0))
  res.json(scenes)
})

storiesRouter.put('/stories/:id', (req, res) => {
  const row = storyStore.get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Not found' })
  const patch: Row = { updatedAt: Date.now() }
  if (typeof req.body.title === 'string' && req.body.title.trim()) patch.title = req.body.title.trim().slice(0, 200)
  if (Array.isArray(req.body.storylines)) {
    patch.storylines = req.body.storylines
      .filter((s: Row) => typeof s?.id === 'string' && typeof s?.name === 'string')
      .map((s: Row) => ({ id: s.id, name: String(s.name).slice(0, 80) }))
  }
  // A sequel: `{ storyId, sceneId }` of the scene in another story this one follows on from; null clears it.
  if (req.body.continuesFrom === null) patch.continuesFrom = undefined
  else if (req.body.continuesFrom !== undefined) {
    const cf = req.body.continuesFrom as Row
    const storyId = str(cf?.storyId)
    const sceneId = str(cf?.sceneId)
    if (!storyId || !sceneId) return res.status(400).json({ error: 'continuesFrom needs a storyId and a sceneId.' })
    if (storyId === req.params.id) return res.status(400).json({ error: 'A story cannot continue from itself.' })
    if (!storyStore.get(storyId)) return res.status(404).json({ error: `Story ${storyId} not found` })
    const scene = chatStore.get(sceneId)
    if (!scene) return res.status(404).json({ error: `Scene ${sceneId} not found` })
    if (scene.storyId !== storyId) return res.status(400).json({ error: 'That scene is not part of that story.' })
    patch.continuesFrom = { storyId, sceneId }
  }
  res.json(storyStore.update(req.params.id, patch))
})

/** Ends a scene with its recap and opens the next one. Returns the new scene. */
storiesRouter.post('/chats/:id/next-scene', (req, res) => {
  const source = chatStore.get(req.params.id)
  if (!source || source.deletedAt) return res.status(404).json({ error: 'Not found' })
  if (source.endedAt) return res.status(409).json({ error: 'This scene has already ended.' })
  const body = req.body as NextSceneRequest
  if (!str(body?.recap?.text).trim()) return res.status(400).json({ error: 'A recap is required to end a scene.' })

  const existingStory = str(source.storyId) ? storyStore.get(str(source.storyId)) : undefined
  const storyScenes = existingStory ? chatStore.list().filter((c) => c.storyId === existingStory.id) : []
  const now = Date.now()
  const plan = planNextScene(source, storyScenes, existingStory, body, now, newId)

  if (plan.storyIsNew) storyStore.insert(plan.story)
  else storyStore.update(str(plan.story.id), plan.story)
  chatStore.update(str(source.id), plan.sourcePatch)
  const created = chatStore.insert(plan.newChat)
  const newChatId = str(created.id)

  const activeObjective = objectiveStore.list({ where: 'chatId = ? AND status = ?', params: [source.id, 'active'] })[0]
  if (activeObjective) {
    const { id: _oid, chatId: _ocid, createdAt: _oca, updatedAt: _oua, ...oRest } = activeObjective
    objectiveStore.insert({ ...oRest, id: newId(), chatId: newChatId, createdAt: now, updatedAt: now })
  }
  for (const e of relationshipEventStore.list({ where: 'chatId = ?', params: [source.id], orderBy: 'createdAt' })) {
    const { id: _eid, chatId: _ecid, ...eRest } = e
    relationshipEventStore.insert({ ...eRest, id: newId(), chatId: newChatId })
  }
  for (const f of chatFactStore.list({ where: 'chatId = ?', params: [source.id], orderBy: 'createdAt' })) {
    const { id: _fid, chatId: _fcid, ...fRest } = f
    chatFactStore.insert({ ...fRest, id: newId(), chatId: newChatId })
  }
  res.status(201).json(created)
})
