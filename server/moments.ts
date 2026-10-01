import express from 'express'
import { chatStore, newId, storyMomentStore } from './db.ts'
import { canSeeChat, userOf } from './access.ts'
import { removeMomentImage, writeMomentImage } from './avatars.ts'
import { normalizeMomentInput } from '../src/lib/story/moments.ts'

/**
 * Story moments (`src/lib/story/moments.ts`): pictures of things that happened in a story. Each is
 * made from a scene and seen by whoever can see that scene, like the story itself; it records who
 * made it. Made under `/api/chats/:id/moments`, which the chat guard already covers.
 */
export const momentsRouter = express.Router()

type Row = Record<string, unknown>

/** Seen by whoever can see its scene, and hidden while the scene is in the trash. */
function visible(req: express.Request, moment: Row | undefined): boolean {
  const chat = moment && chatStore.get(String(moment.chatId))
  return !!chat && !chat.deletedAt && canSeeChat(req, chat)
}

/** Deletes a scene's moments and their pictures, when the scene itself is purged. */
export function purgeChatMoments(chatId: string): void {
  for (const moment of storyMomentStore.list({ where: 'chatId = ?', params: [chatId] })) {
    removeMomentImage(moment.imageUrl)
    storyMomentStore.remove(moment.id as string)
  }
}

momentsRouter.get('/moments', (req, res) => {
  res.json(storyMomentStore.list({ orderBy: 'createdAt' }).filter((m) => visible(req, m)))
})

momentsRouter.post('/chats/:id/moments', (req, res) => {
  const chat = chatStore.get(req.params.id)
  if (!chat) return res.status(404).json({ error: 'Not found' })
  const { value, error } = normalizeMomentInput(req.body)
  if (!value) return res.status(400).json({ error })
  const id = newId()
  const storyId = typeof chat.storyId === 'string' && chat.storyId ? chat.storyId : String(chat.id)
  let imageUrl: string
  try {
    imageUrl = writeMomentImage(storyId, id, value.image)
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message })
  }
  const user = userOf(req)
  const created = storyMomentStore.insert({
    id, storyId, chatId: chat.id,
    ...(value.messageId ? { messageId: value.messageId } : {}),
    ...(typeof chat.chapterId === 'string' ? { chapterId: chat.chapterId } : {}),
    characterIds: value.characterIds, kind: value.kind, caption: value.caption, prompt: value.prompt, imageUrl,
    ...(user ? { createdBy: user.id } : {}),
    createdAt: Date.now(),
  })
  res.status(201).json(created)
})

momentsRouter.patch('/moments/:id', (req, res) => {
  const moment = storyMomentStore.get(req.params.id)
  if (!visible(req, moment)) return res.status(404).json({ error: 'Not found' })
  const caption = typeof req.body?.caption === 'string' ? req.body.caption.trim().slice(0, 200) : undefined
  if (caption === undefined) return res.status(400).json({ error: 'Only the caption can be changed.' })
  res.json(storyMomentStore.update(req.params.id, { caption }))
})

momentsRouter.delete('/moments/:id', (req, res) => {
  const moment = storyMomentStore.get(req.params.id)
  if (!visible(req, moment)) return res.status(404).json({ error: 'Not found' })
  removeMomentImage(moment!.imageUrl)
  storyMomentStore.remove(req.params.id)
  res.status(204).end()
})
