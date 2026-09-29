/**
 * Planning half of stories made of scenes (`stories.ts` has the routes). Kept free of any database
 * import so it can be tested without opening one.
 */

import { FIRST_CHAPTER_ID, chapterIdOf, chapterLine, chaptersOf, nextSceneNumberIn } from '../src/lib/story/chapters.ts'
import type { Chapter, Chat, Story } from '../src/lib/types.ts'

type Row = Record<string, unknown>

/** A request the story can't carry out as asked; `status` is the HTTP answer. */
export class StoryPlanError extends Error {
  // A plain field: Node's type stripping, which runs the server, has no parameter properties.
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export const MAIN_STORYLINE_ID = 'main'

export interface NextSceneRequest {
  recap: { text: string; presentIds: string[]; openThreads?: string[]; location?: string }
  /** Confirmed consequences from the ending scene's GM turns, to keep in force afterwards. */
  consequences?: string[]
  /** Set events carried out in the ending scene or before it, so they do not happen twice. */
  setEventsDone?: string[]
  /** Ends the scene's chapter too, with its recap, and opens the next scene as the first of a new chapter. */
  chapter?: {
    recap: { text: string; openThreads?: string[] }
    next?: { title?: string; goal?: string }
  }
  next?: {
    title?: string
    location?: string | null
    atmosphere?: string | null
    /** Who is in the next scene. The lead is always included. */
    presentIds?: string[]
    /** An existing storyline to continue in, or a new one to split off with this name. */
    storylineId?: string
    newStorylineName?: string
  }
}

export interface NextScenePlan {
  story: Row
  storyIsNew: boolean
  sourcePatch: Row
  newChat: Row
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : [])
const threadsOf = (v: unknown) => strings(v).map((t) => t.trim().slice(0, 300)).slice(0, 12)

/** The story's chapters as editable copies: saved ones, or the implicit first chapter written down. */
function workingChapters(story: Row | undefined, scenes: Row[]): Chapter[] {
  return chaptersOf(story as Pick<Story, 'chapters'> | undefined, scenes as unknown as Chat[]).map((c) => ({ ...c, ...(c.recap ? { recap: { ...c.recap } } : {}) }))
}

/**
 * Plans ending `source` and opening the scene after it. Pure, so it can be tested without a
 * database. Carried over: the relationship track, gifts, inventory, gallery unlocks, flags, assist
 * settings, the player, confirmed consequences, and tracked state as the scene ended (`endState`,
 * from `carryGameState`). Left behind: the transcript, the rolling summary (the recap replaces it),
 * and per-scene bookkeeping (World Info timers, a live date read).
 *
 * The next scene stays in the ending scene's chapter, unless `body.chapter` ends that chapter: then
 * the chapter gets its recap and the next scene opens a new one. Earlier scenes are never touched.
 */
export function planNextScene(
  source: Row,
  storyScenes: Row[],
  existingStory: Row | undefined,
  body: NextSceneRequest,
  now: number,
  id: () => string,
  endState?: Row,
): NextScenePlan {
  const storyIsNew = !existingStory
  const story: Row = existingStory
    ? { ...existingStory, updatedAt: now }
    : { id: id(), title: str(source.title) || 'Untitled story', createdAt: now, updatedAt: now, storylines: [] }
  const storyId = str(story.id)

  let storylineId = str(body.next?.storylineId) || str(source.storylineId) || MAIN_STORYLINE_ID
  const newName = str(body.next?.newStorylineName).trim()
  if (newName) {
    storylineId = id()
    story.storylines = [...((story.storylines as Row[] | undefined) ?? []), { id: storylineId, name: newName.slice(0, 80) }]
  }

  // Chapters: the scene's own, or a new one when this ends it. Written down only when one ends.
  const allScenes = [...storyScenes.filter((s) => s.id !== source.id), source]
  const sourceChapterId = chapterIdOf(source as Pick<Chat, 'chapterId'>)
  let nextChapterId = sourceChapterId
  let chapterSceneNumber = nextSceneNumberIn(allScenes as unknown as Chat[], sourceChapterId)
  if (body.chapter) {
    const chapters = workingChapters(existingStory, allScenes)
    const current = chapters.find((c) => c.id === sourceChapterId)
    if (!current) throw new StoryPlanError('This scene\'s chapter is missing.')
    if (current.endedAt) throw new StoryPlanError('This chapter has already ended. End the scene alone to carry on in it.', 409)
    const recapText = str(body.chapter.recap?.text).trim()
    if (!recapText) throw new StoryPlanError('A recap is required to end a chapter.')
    const threads = threadsOf(body.chapter.recap?.openThreads)
    current.endedAt = now
    current.recap = {
      text: recapText.slice(0, 8000),
      ...(threads.length ? { openThreads: threads } : {}),
      sceneIds: chapterLine(allScenes as unknown as Chat[], source as unknown as Chat).map((s) => s.id),
      writtenAt: now,
    }
    const title = str(body.chapter.next?.title).trim().slice(0, 120)
    const goal = str(body.chapter.next?.goal).trim().slice(0, 500)
    const next: Chapter = { id: id(), number: Math.max(...chapters.map((c) => c.number)) + 1, ...(title ? { title } : {}), ...(goal ? { goal } : {}), startedAt: now }
    story.chapters = [...chapters, next]
    nextChapterId = next.id
    chapterSceneNumber = 1
  }

  const sourceNumber = typeof source.sceneNumber === 'number' ? source.sceneNumber : 1
  const highest = Math.max(sourceNumber, ...storyScenes.map((s) => (typeof s.sceneNumber === 'number' ? s.sceneNumber : 0)))
  const recap = {
    text: str(body.recap?.text).trim(),
    presentIds: [...new Set(strings(body.recap?.presentIds))],
    openThreads: strings(body.recap?.openThreads),
    location: str(body.recap?.location).trim() || undefined,
    writtenAt: now,
  }
  const sourcePatch: Row = {
    endedAt: now,
    recap,
    ...(storyIsNew || !source.storyId ? { storyId, sceneNumber: sourceNumber, storylineId: str(source.storylineId) || MAIN_STORYLINE_ID } : {}),
  }

  // Fork-style copy of the chat's state, minus what belongs to one scene only.
  const {
    id: _id, createdAt: _ca, updatedAt: _ua, deletedAt: _da, worldInfoState: _wis, rapport: _rap,
    summary: _sum, summaryUpToTimestamp: _sut, endedAt: _end, recap: _rec, parentChatId: _pc,
    forkedFromMessageId: _ff, sceneTitle: _st, lastOutreachCheckedAt: _lo, memoryScribedUpTo: _msu, gameState: _gs, ...rest
  } = source
  const lead = str(source.characterId)
  const player = str(source.playerCharacterId)
  const participants = strings(source.participants)
  const present = body.next?.presentIds ? [...new Set([lead, ...strings(body.next.presentIds)])].filter((p) => p !== player) : undefined
  const scene = (source.scene as Row | undefined) ?? undefined
  const nextScene: Row | undefined = scene || present || body.next?.location !== undefined
    ? {
        ...(scene ?? { turnPolicy: 'manual' }),
        roundRobinIndex: 0,
        ...(present ? { presentCharacterIds: present } : {}),
        ...(body.next && 'location' in body.next ? { location: body.next.location ?? null } : {}),
        ...(body.next && 'atmosphere' in body.next ? { atmosphere: body.next.atmosphere ?? null } : {}),
      }
    : undefined
  const carried = [...new Set([...strings(source.carriedConsequences), ...strings(body.consequences)])]
  const eventsDone = [...new Set([...strings(source.setEventsDone), ...strings(body.setEventsDone)])]
  const newChat: Row = {
    ...rest,
    id: id(),
    title: str(story.title),
    storyId,
    sceneNumber: highest + 1,
    sceneTitle: str(body.next?.title).trim().slice(0, 120) || undefined,
    storylineId,
    chapterId: nextChapterId,
    chapterSceneNumber,
    previousSceneId: str(source.id),
    participants: participants.length ? participants : undefined,
    scene: nextScene,
    carriedConsequences: carried.length ? carried : undefined,
    setEventsDone: eventsDone.length ? eventsDone : undefined,
    gameState: endState && Object.keys(endState).length ? endState : undefined,
    createdAt: now,
    updatedAt: now,
  }
  return { story, storyIsNew, sourcePatch, newChat }
}

export interface ChapterEdit {
  /** The chapter to edit; unset edits the chapter the scene is in. */
  chapterId?: string
  title?: string
  goal?: string
  /** Only an ended chapter has a recap to correct. */
  recap?: { text: string; openThreads?: string[] }
}

export interface ChapterEditPlan {
  story: Row
  storyIsNew: boolean
  sourcePatch: Row
}

/**
 * Names a chapter, sets its goal, or corrects its recap, from one of the story's scenes. A scene
 * that isn't part of a story yet becomes scene 1 of a new one, so a chapter can be named from the
 * start. The implicit first chapter is written down here. Pure, like `planNextScene`.
 */
export function planChapterEdit(source: Row, storyScenes: Row[], existingStory: Row | undefined, edit: ChapterEdit, now: number, id: () => string): ChapterEditPlan {
  const storyIsNew = !existingStory
  const story: Row = existingStory
    ? { ...existingStory, updatedAt: now }
    : { id: id(), title: str(source.title) || 'Untitled story', createdAt: now, updatedAt: now, storylines: [] }
  const chapters = workingChapters(existingStory, [...storyScenes.filter((s) => s.id !== source.id), source])
  const targetId = str(edit.chapterId) || chapterIdOf(source as Pick<Chat, 'chapterId'>)
  const chapter = chapters.find((c) => c.id === targetId)
  if (!chapter) throw new StoryPlanError('That chapter is not part of this story.', 404)
  if (edit.title !== undefined) {
    const title = str(edit.title).trim().slice(0, 120)
    if (title) chapter.title = title
    else delete chapter.title
  }
  if (edit.goal !== undefined) {
    const goal = str(edit.goal).trim().slice(0, 500)
    if (goal) chapter.goal = goal
    else delete chapter.goal
  }
  if (edit.recap !== undefined) {
    if (!chapter.endedAt || !chapter.recap) throw new StoryPlanError('A chapter gets its recap when it ends.', 409)
    const text = str(edit.recap?.text).trim()
    if (!text) throw new StoryPlanError('A chapter recap cannot be empty.')
    const threads = threadsOf(edit.recap?.openThreads)
    chapter.recap = { ...chapter.recap, text: text.slice(0, 8000), openThreads: threads.length ? threads : undefined }
  }
  story.chapters = chapters
  const sourcePatch: Row = storyIsNew || !source.storyId
    ? { storyId: str(story.id), sceneNumber: typeof source.sceneNumber === 'number' ? source.sceneNumber : 1, storylineId: str(source.storylineId) || MAIN_STORYLINE_ID, ...(source.chapterId ? {} : { chapterId: FIRST_CHAPTER_ID }) }
    : {}
  return { story, storyIsNew, sourcePatch }
}
