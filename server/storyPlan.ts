/**
 * Planning half of stories made of scenes (`stories.ts` has the routes). Kept free of any database
 * import so it can be tested without opening one.
 */

import { FIRST_CHAPTER_ID, chapterIdOf, chapterLine, chaptersOf, nextSceneNumberIn } from '../src/lib/story/chapters.ts'
import { planLeadChange } from '../src/lib/story/lead.ts'
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
    /** The next scene's lead, when it changes (`story/lead.ts`). Unset keeps this scene's. */
    leadId?: string
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
  const nextLead = str(body.next?.leadId) || lead
  if (nextLead !== lead && nextLead === player) throw new StoryPlanError('The lead can\'t be the character you play. Switch Play As first.', 409)
  const participants = strings(source.participants)
  const present = body.next?.presentIds ? [...new Set([nextLead, ...strings(body.next.presentIds)])].filter((p) => p !== player) : undefined
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
  // A new lead takes over the lead's place and track; the old lead stays only if picked to be there.
  if (nextLead !== lead) {
    Object.assign(newChat, planLeadChange(newChat as unknown as Chat, nextLead, { keepPrevious: present ? present.includes(lead) : true }))
  }
  return { story, storyIsNew, sourcePatch, newChat }
}

/**
 * What deleting a scene changed elsewhere in its story. Kept on the deleted scene so restoring it
 * can put everything back exactly (`planSceneRestore`).
 */
export interface SceneRemoval {
  removedAt: number
  /** The scene it continued from, if any: the scenes after it continue from this now. */
  previousSceneId?: string
  /** Scenes that continued from it. */
  relinked: string[]
  /** Scenes numbered down by one in the story, and within its chapter. A restore numbers by position instead, as scenes may have been added since. */
  renumbered: string[]
  chapterRenumbered: string[]
  /** Set events carried out in it and consequences confirmed in it, taken off the scenes after it. */
  events: string[]
  consequences: string[]
  /** The scene before it, opened again because the deleted scene was where the story stood. */
  reopened?: { id: string; endedAt: number; recap?: unknown }
  /** Its chapter, removed with it when it was the chapter's only scene, and the chapter before reopened. */
  chapter?: { removed: Chapter; reopened?: { id: string; endedAt: number; recap?: Chapter['recap'] } }
}

export interface SceneRemovalPlan {
  sourcePatch: Row
  /** Changes to the story's other scenes, by id. */
  scenePatches: Record<string, Row>
  /** Set when the story's chapters change. */
  storyPatch?: Row
  /** The scene to open in its place. */
  openSceneId: string
}

/** Set events a scene's GM turns carried out, and the branch consequences confirmed in it. */
function eventsAndConsequencesOf(messages: Row[]): { events: string[]; consequences: string[] } {
  const events = new Set<string>()
  const consequences = new Set<string>()
  for (const m of messages) {
    const gm = m.gm as { adjudication?: { setEventId?: string; setEventIds?: string[] }; proposals?: { scope?: string; status?: string; text?: string }[] } | undefined
    for (const id of [gm?.adjudication?.setEventId, ...(gm?.adjudication?.setEventIds ?? [])]) if (id) events.add(id)
    for (const p of gm?.proposals ?? []) if (p.scope === 'branch' && p.status === 'confirmed' && p.text) consequences.add(p.text)
  }
  return { events: [...events], consequences: [...consequences] }
}

/** Every scene that follows on from `fromId`, at any distance. */
function scenesAfter(fromId: string, scenes: Row[]): Row[] {
  const after: Row[] = []
  const frontier = [fromId]
  while (frontier.length) {
    const id = frontier.shift()!
    for (const s of scenes) if (str(s.previousSceneId) === id && !after.includes(s)) { after.push(s); frontier.push(str(s.id)) }
  }
  return after
}

const num = (v: unknown) => (typeof v === 'number' ? v : undefined)

/**
 * Plans deleting one scene of a story. The scenes after it continue from the scene before it, and
 * are numbered down to close the gap. What happened only in it (its set events and confirmed
 * consequences) is taken off the scenes after it. Deleting the scene the story stands at opens the
 * scene before it again, and a chapter that scene started goes with it. Its own messages, memories,
 * and moments stay with it in the trash. Pure, like `planNextScene`.
 */
export function planSceneRemoval(source: Row, storyScenes: Row[], story: Row | undefined, messages: Row[], now: number): SceneRemovalPlan {
  if (!str(source.storyId)) throw new StoryPlanError('This chat is not a scene of a story.')
  const live = storyScenes.filter((s) => !s.deletedAt && s.id !== source.id)
  if (!live.length) throw new StoryPlanError('This is the story\'s only scene. Delete the story instead.', 409)
  const byId = (id: string) => live.find((s) => s.id === id)
  const previous = byId(str(source.previousSceneId))
  const children = live.filter((s) => str(s.previousSceneId) === source.id)
  const later = scenesAfter(str(source.id), live)
  const { events, consequences } = eventsAndConsequencesOf(messages)
  const number = num(source.sceneNumber) ?? 1
  const chapterId = chapterIdOf(source as Pick<Chat, 'chapterId'>)
  const inChapter = num(source.chapterSceneNumber)

  const patches: Record<string, Row> = {}
  const patch = (s: Row, change: Row) => { patches[str(s.id)] = { ...patches[str(s.id)], ...change } }
  for (const s of children) patch(s, { previousSceneId: previous ? str(previous.id) : undefined })
  const renumbered = live.filter((s) => (num(s.sceneNumber) ?? 0) > number)
  for (const s of renumbered) patch(s, { sceneNumber: num(s.sceneNumber)! - 1 })
  const chapterRenumbered = inChapter === undefined ? [] : live.filter((s) => chapterIdOf(s as Pick<Chat, 'chapterId'>) === chapterId && (num(s.chapterSceneNumber) ?? 0) > inChapter)
  for (const s of chapterRenumbered) patch(s, { chapterSceneNumber: num(s.chapterSceneNumber)! - 1 })
  for (const s of later) {
    const done = strings(s.setEventsDone).filter((id) => !events.includes(id))
    const carried = strings(s.carriedConsequences).filter((c) => !consequences.includes(c))
    patch(s, { setEventsDone: done.length ? done : undefined, carriedConsequences: carried.length ? carried : undefined })
  }

  const removal: SceneRemoval = {
    removedAt: now,
    ...(previous ? { previousSceneId: str(previous.id) } : {}),
    relinked: children.map((s) => str(s.id)),
    renumbered: renumbered.map((s) => str(s.id)),
    chapterRenumbered: chapterRenumbered.map((s) => str(s.id)),
    events,
    consequences,
  }

  // The story stood at this scene: the one before it is where it stands again.
  let storyPatch: Row | undefined
  const reopen = !children.length && previous && typeof previous.endedAt === 'number' && !live.some((s) => str(s.previousSceneId) === previous.id)
  if (reopen) {
    removal.reopened = { id: str(previous.id), endedAt: previous.endedAt as number, ...(previous.recap ? { recap: previous.recap } : {}) }
    patch(previous, { endedAt: undefined, recap: undefined })
    const previousChapterId = chapterIdOf(previous as Pick<Chat, 'chapterId'>)
    const chapters = (story?.chapters as Chapter[] | undefined) ?? []
    const removed = chapters.find((c) => c.id === chapterId)
    if (removed && previousChapterId !== chapterId && !live.some((s) => chapterIdOf(s as Pick<Chat, 'chapterId'>) === chapterId)) {
      const before = chapters.find((c) => c.id === previousChapterId)
      removal.chapter = {
        removed,
        ...(before?.endedAt ? { reopened: { id: before.id, endedAt: before.endedAt, ...(before.recap ? { recap: before.recap } : {}) } } : {}),
      }
      storyPatch = {
        chapters: chapters.filter((c) => c.id !== chapterId).map((c) => {
          if (c.id !== previousChapterId) return c
          const { endedAt: _e, recap: _r, ...open } = c
          return open
        }),
        updatedAt: now,
      }
    }
  }

  return {
    sourcePatch: { deletedAt: now, sceneRemoval: removal },
    scenePatches: patches,
    ...(storyPatch ? { storyPatch } : {}),
    openSceneId: reopen ? str(previous!.id) : str(children[0]?.id) || str(previous?.id) || str(live[0].id),
  }
}

/**
 * Plans putting a deleted scene back where it was, undoing `planSceneRemoval`. Refuses when the
 * story has moved on in a way that can't be undone cleanly: the scenes after it now continue from
 * somewhere else, or the scene that was opened again has been played on (`playedSince` is how
 * many messages it gained after the deletion) or ended again.
 */
export function planSceneRestore(source: Row, storyScenes: Row[], story: Row | undefined, playedSince: number, now: number): Omit<SceneRemovalPlan, 'openSceneId'> {
  const removal = source.sceneRemoval as SceneRemoval | undefined
  if (!removal) return { sourcePatch: { deletedAt: undefined, updatedAt: now }, scenePatches: {} }
  const moved = new StoryPlanError('The story has moved on since this scene was deleted, so it can\'t go back in its place.', 409)
  const live = storyScenes.filter((s) => !s.deletedAt && s.id !== source.id)
  const byId = (id: string) => live.find((s) => s.id === id)
  const previousId = removal.previousSceneId
  if (previousId && !byId(previousId)) throw moved
  for (const id of removal.relinked) {
    const s = byId(id)
    if (s && str(s.previousSceneId) !== (previousId ?? '')) throw moved
  }
  if (removal.reopened) {
    const s = byId(removal.reopened.id)
    if (!s || s.endedAt || playedSince > 0 || live.some((other) => str(other.previousSceneId) === removal.reopened!.id)) throw moved
  }

  const patches: Record<string, Row> = {}
  const patch = (id: string, change: Row) => { if (byId(id)) patches[id] = { ...patches[id], ...change } }
  for (const id of removal.relinked) patch(id, { previousSceneId: str(source.id) })
  // Open its place again by number, not by the recorded list: scenes may have been added since.
  const number = num(source.sceneNumber) ?? 1
  const chapterId = chapterIdOf(source as Pick<Chat, 'chapterId'>)
  const inChapter = num(source.chapterSceneNumber)
  for (const s of live) {
    if ((num(s.sceneNumber) ?? 0) >= number) patch(str(s.id), { sceneNumber: num(s.sceneNumber)! + 1 })
    if (inChapter !== undefined && chapterIdOf(s as Pick<Chat, 'chapterId'>) === chapterId && (num(s.chapterSceneNumber) ?? 0) >= inChapter) {
      patch(str(s.id), { chapterSceneNumber: num(s.chapterSceneNumber)! + 1 })
    }
  }
  // Everything after it again: the relinked scenes and whatever follows them.
  const after = removal.relinked.flatMap((id) => [byId(id), ...scenesAfter(id, live)]).filter((s): s is Row => !!s)
  for (const s of after) {
    const done = [...new Set([...strings(s.setEventsDone), ...removal.events])]
    const carried = [...new Set([...strings(s.carriedConsequences), ...removal.consequences])]
    patch(str(s.id), { setEventsDone: done.length ? done : undefined, carriedConsequences: carried.length ? carried : undefined })
  }
  if (removal.reopened) patch(removal.reopened.id, { endedAt: removal.reopened.endedAt, recap: removal.reopened.recap })

  let storyPatch: Row | undefined
  if (removal.chapter) {
    const chapters = ((story?.chapters as Chapter[] | undefined) ?? []).filter((c) => c.id !== removal.chapter!.removed.id).map((c) => {
      const reopened = removal.chapter!.reopened
      return reopened && c.id === reopened.id ? { ...c, endedAt: reopened.endedAt, ...(reopened.recap ? { recap: reopened.recap } : {}) } : c
    })
    storyPatch = { chapters: [...chapters, removal.chapter.removed].sort((a, b) => a.number - b.number), updatedAt: now }
  }
  return {
    sourcePatch: { deletedAt: undefined, sceneRemoval: undefined, updatedAt: now },
    scenePatches: patches,
    ...(storyPatch ? { storyPatch } : {}),
  }
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
