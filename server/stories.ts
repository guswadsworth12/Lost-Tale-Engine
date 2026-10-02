import express from 'express'
import { characterStore, chatFactStore, chatStore, messageStore, newId, objectiveStore, relationshipEventStore, storyStore, worldStore } from './db.ts'
import { StoryPlanError, planChapterEdit, planNextScene, planSceneRemoval, planSceneRestore, type ChapterEdit, type NextSceneRequest } from './storyPlan.ts'
import { canSeeChat, hiddenIds, lookups, siteOwnerId, storyVisible } from './access.ts'
import { ownerOf } from './ownership.ts'
import { planLeadChange } from '../src/lib/story/lead.ts'
import { carryGameState, gameStateFrom, type CampaignTrack, type GameState } from '../src/lib/world/gameState.ts'

/**
 * Stories made of scenes. A scene is an ordinary chat carrying `storyId`; ending one writes its
 * recap and opens the next scene as a fresh chat that inherits the story's state but not its
 * transcript, so each scene's context stays small. See `planNextScene` for what carries over.
 */

type Row = Record<string, unknown>

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export const storiesRouter = express.Router()

storiesRouter.get('/stories', (req, res) => {
  res.json(storyStore.list({ orderBy: 'updatedAt DESC' }).filter((story) => storyVisible(req, story)))
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
    .filter((c) => c.storyId === req.params.id && !c.deletedAt && canSeeChat(req, c))
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
  // Scenes in the trash don't count: a deleted scene's number is free again.
  const storyScenes = existingStory ? chatStore.list().filter((c) => c.storyId === existingStory.id && !c.deletedAt) : []
  const nextLead = str(body?.next?.leadId)
  if (nextLead && (!characterStore.get(nextLead) || hiddenIds(req, [nextLead], lookups.character).length)) return res.status(404).json({ error: 'That character was not found.' })
  const now = Date.now()
  // Tracked state is folded here, from the saved branch, rather than taken from the client.
  const lead = str(source.characterId) ? characterStore.get(str(source.characterId)) : undefined
  const world = str(lead?.worldId) ? worldStore.get(str(lead?.worldId)) : undefined
  const tracks = (world?.campaign as { tracks?: CampaignTrack[] } | undefined)?.tracks
  const messages = messageStore.list({ where: 'chatId = ?', params: [source.id], orderBy: 'createdAt' })
  const { state } = gameStateFrom(tracks, source.gameState as GameState | undefined, messages, { playerId: str(source.playerCharacterId) || undefined })
  let plan
  try {
    plan = planNextScene(source, storyScenes, existingStory, body, now, newId, carryGameState(state, tracks))
  } catch (error) {
    if (error instanceof StoryPlanError) return res.status(error.status).json({ error: error.message })
    throw error
  }

  // A story and its scenes are their starter's alone (ownership.ts).
  const owner = ownerOf(source, siteOwnerId())
  if (plan.storyIsNew) storyStore.insert({ ...plan.story, ownerUserId: owner })
  else storyStore.update(str(plan.story.id), plan.story)
  chatStore.update(str(source.id), plan.sourcePatch)
  const created = chatStore.insert({ ...plan.newChat, ownerUserId: owner })
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

/**
 * Names a scene's chapter, sets its goal, or corrects an ended chapter's recap (`chapterId` picks
 * another chapter of the same story). A scene not yet in a story becomes scene 1 of one. Returns the story.
 */
storiesRouter.put('/chats/:id/chapter', (req, res) => {
  const source = chatStore.get(req.params.id)
  if (!source || source.deletedAt) return res.status(404).json({ error: 'Not found' })
  const body = (req.body ?? {}) as Row
  const edit: ChapterEdit = {
    ...(typeof body.chapterId === 'string' ? { chapterId: body.chapterId } : {}),
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
    ...(typeof body.goal === 'string' ? { goal: body.goal } : {}),
    ...(body.recap && typeof body.recap === 'object' ? { recap: body.recap as ChapterEdit['recap'] } : {}),
  }
  const existingStory = str(source.storyId) ? storyStore.get(str(source.storyId)) : undefined
  const storyScenes = existingStory ? chatStore.list().filter((c) => c.storyId === existingStory.id) : []
  let plan
  try {
    plan = planChapterEdit(source, storyScenes, existingStory, edit, Date.now(), newId)
  } catch (error) {
    if (error instanceof StoryPlanError) return res.status(error.status).json({ error: error.message })
    throw error
  }
  if (plan.storyIsNew) storyStore.insert({ ...plan.story, ownerUserId: ownerOf(source, siteOwnerId()) })
  else storyStore.update(str(plan.story.id), plan.story)
  if (Object.keys(plan.sourcePatch).length) chatStore.update(str(source.id), plan.sourcePatch)
  res.json(plan.story)
})

/**
 * Makes another character this scene's lead (`story/lead.ts`). Both relationship tracks move with
 * it. `keepPrevious: false` takes the old lead out of the scene. An ended scene keeps its lead.
 */
storiesRouter.put('/chats/:id/lead', (req, res) => {
  const chat = chatStore.get(req.params.id)
  if (!chat || chat.deletedAt) return res.status(404).json({ error: 'Not found' })
  if (chat.endedAt) return res.status(409).json({ error: 'This scene has ended. Change the lead in the scene you are playing.' })
  const leadId = str(req.body?.characterId)
  if (!leadId || !characterStore.get(leadId) || hiddenIds(req, [leadId], lookups.character).length) return res.status(404).json({ error: 'That character was not found.' })
  if (leadId === chat.playerCharacterId) return res.status(409).json({ error: 'That is the character you play. Switch Play As first.' })
  if (leadId === chat.characterId) return res.json(chat)
  // The lead's own lines are saved with no speaker: it's implied. Name them before it stops being true.
  const oldLead = str(chat.characterId)
  for (const m of messageStore.list({ where: 'chatId = ?', params: [chat.id] })) {
    if (oldLead && m.role === 'char' && !m.speakerId) messageStore.update(str(m.id), { speakerId: oldLead })
  }
  const patch = planLeadChange(chat as never, leadId, { keepPrevious: req.body?.keepPrevious !== false })
  res.json(chatStore.update(str(chat.id), { ...patch, updatedAt: Date.now() }))
})

/**
 * Deletes one scene of a story into the trash (`planSceneRemoval`): the story closes the gap around
 * it. Answers with the scene to open in its place.
 */
storiesRouter.delete('/chats/:id/scene', (req, res) => {
  const source = chatStore.get(req.params.id)
  if (!source || source.deletedAt) return res.status(404).json({ error: 'Not found' })
  const story = str(source.storyId) ? storyStore.get(str(source.storyId)) : undefined
  const scenes = story ? chatStore.list().filter((c) => c.storyId === story.id) : []
  const messages = messageStore.list({ where: 'chatId = ?', params: [source.id], orderBy: 'createdAt' })
  let plan
  try {
    plan = planSceneRemoval(source, scenes, story, messages, Date.now())
  } catch (error) {
    if (error instanceof StoryPlanError) return res.status(error.status).json({ error: error.message })
    throw error
  }
  for (const [id, patch] of Object.entries(plan.scenePatches)) chatStore.update(id, patch)
  if (plan.storyPatch && story) storyStore.update(str(story.id), plan.storyPatch)
  chatStore.update(str(source.id), plan.sourcePatch)
  res.json({ openSceneId: plan.openSceneId })
})

/**
 * Puts a scene deleted with `DELETE /chats/:id/scene` back in its place (`planSceneRestore`).
 * `POST /chats/:id/restore` hands a deleted scene here. Answers with the restored scene.
 */
export function restoreScene(source: Record<string, unknown>, res: express.Response): void {
  const story = str(source.storyId) ? storyStore.get(str(source.storyId)) : undefined
  const scenes = story ? chatStore.list().filter((c) => c.storyId === story.id) : []
  const removal = source.sceneRemoval as { removedAt: number; reopened?: { id: string } } | undefined
  const playedSince = removal?.reopened
    ? messageStore.list({ where: 'chatId = ? AND createdAt > ?', params: [removal.reopened.id, removal.removedAt] }).length
    : 0
  let plan
  try {
    plan = planSceneRestore(source, scenes, story, playedSince, Date.now())
  } catch (error) {
    if (error instanceof StoryPlanError) { res.status(error.status).json({ error: error.message }); return }
    throw error
  }
  for (const [id, patch] of Object.entries(plan.scenePatches)) chatStore.update(id, patch)
  if (plan.storyPatch && story) storyStore.update(str(story.id), plan.storyPatch)
  res.json(chatStore.update(str(source.id), plan.sourcePatch))
}
