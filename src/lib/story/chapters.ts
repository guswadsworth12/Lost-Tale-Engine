import type { Chapter, Chat, Story } from '@/lib/types'

/**
 * Chapters: the arcs a story's scenes are grouped into, between the story and its scenes.
 *
 * A story that never had chapters has one anyway: an implicit first chapter (`FIRST_CHAPTER_ID`)
 * that every scene without a `chapterId` belongs to. It's written down only when first renamed or
 * ended, so stories made before chapters play on unchanged, with nothing to migrate. Their scene
 * numbers stay right too: in a first chapter, the story's scene number is the chapter's.
 *
 * Only type imports here: the server loads this file with plain Node.
 */

export const FIRST_CHAPTER_ID = 'chapter-1'

type SceneLike = Pick<Chat, 'id' | 'createdAt'> & Partial<Pick<Chat, 'chapterId' | 'chapterSceneNumber' | 'sceneNumber' | 'previousSceneId'>>

export function chapterIdOf(scene: Pick<Chat, 'chapterId'>): string {
  return scene.chapterId || FIRST_CHAPTER_ID
}

/** A scene's number within its chapter. */
export function sceneNumberInChapter(scene: Partial<Pick<Chat, 'chapterSceneNumber' | 'sceneNumber'>>): number {
  return scene.chapterSceneNumber ?? scene.sceneNumber ?? 1
}

/**
 * The story's chapters, oldest first: the saved ones, the implicit first chapter when any scene
 * still belongs to it, and a stand-in for any chapter a scene names that the story has lost, so no
 * scene is ever left without one.
 */
export function chaptersOf(story: Pick<Story, 'chapters'> | undefined, scenes: readonly SceneLike[]): Chapter[] {
  const saved = [...(story?.chapters ?? [])]
  const known = new Set(saved.map((c) => c.id))
  const firstStarted = scenes.length ? Math.min(...scenes.map((s) => s.createdAt)) : 0
  const implicit = !known.has(FIRST_CHAPTER_ID) && (!saved.length || scenes.some((s) => chapterIdOf(s) === FIRST_CHAPTER_ID))
  const chapters = implicit ? [{ id: FIRST_CHAPTER_ID, number: 1, startedAt: firstStarted }, ...saved] : saved
  for (const scene of scenes) {
    const id = chapterIdOf(scene)
    if (chapters.some((c) => c.id === id)) continue
    chapters.push({ id, number: Math.max(0, ...chapters.map((c) => c.number)) + 1, startedAt: scene.createdAt })
  }
  return chapters.sort((a, b) => a.number - b.number || a.startedAt - b.startedAt)
}

export function chapterLabel(chapter: Pick<Chapter, 'number' | 'title'>): string {
  const title = chapter.title?.trim()
  return title ? `Chapter ${chapter.number} · ${title}` : `Chapter ${chapter.number}`
}

const byOrder = (a: SceneLike, b: SceneLike) => (a.sceneNumber ?? 1) - (b.sceneNumber ?? 1) || a.createdAt - b.createdAt

/** The chapter's scenes, oldest first. */
export function scenesOfChapter<T extends SceneLike>(scenes: readonly T[], chapterId: string): T[] {
  return scenes.filter((s) => chapterIdOf(s) === chapterId).sort(byOrder)
}

/** The chapter a scene is part of, from the story's chapters. */
export function chapterOfScene(chapters: readonly Chapter[], scene: Pick<Chat, 'chapterId'>): Chapter | undefined {
  return chapters.find((c) => c.id === chapterIdOf(scene))
}

/** "Chapter 2 · Scene 1", for where the player is. */
export function chapterSceneLabel(chapters: readonly Chapter[], scene: Pick<Chat, 'chapterId'> & Partial<Pick<Chat, 'chapterSceneNumber' | 'sceneNumber'>>): string {
  const chapter = chapterOfScene(chapters, scene)
  return `Chapter ${chapter?.number ?? 1} · Scene ${sceneNumberInChapter(scene)}`
}

/**
 * The scenes of the current scene's line of play within its chapter, oldest first, ending with the
 * scene itself: what a chapter recap written from this scene covers. Follows `previousSceneId`, so
 * another branch's scenes in the same chapter aren't counted.
 */
export function chapterLine<T extends SceneLike>(scenes: readonly T[], current: T): T[] {
  const byId = new Map(scenes.map((s) => [s.id, s]))
  const chapterId = chapterIdOf(current)
  const line: T[] = [current]
  const seen = new Set([current.id])
  let previous = current.previousSceneId
  while (previous && !seen.has(previous)) {
    const scene = byId.get(previous)
    if (!scene || chapterIdOf(scene) !== chapterId) break
    seen.add(previous)
    line.unshift(scene)
    previous = scene.previousSceneId
  }
  return line
}

/** The next scene's number within `chapterId`: one past the highest there, across every branch. */
export function nextSceneNumberIn(scenes: readonly SceneLike[], chapterId: string): number {
  return Math.max(0, ...scenes.filter((s) => chapterIdOf(s) === chapterId).map(sceneNumberInChapter)) + 1
}

/**
 * What the Game Master is told about the chapter a scene is in: its name and goal, what the
 * chapter before it ended on, and the threads that chapter left open.
 */
export function chapterBriefing(chapters: readonly Chapter[], scene: Pick<Chat, 'chapterId'>): string {
  const chapter = chapterOfScene(chapters, scene)
  if (!chapter) return ''
  // A story that has only ever had its implicit first chapter has nothing to say about chapters.
  if (chapters.length === 1 && !chapter.title?.trim() && !chapter.goal?.trim()) return ''
  const previous = chapters.filter((c) => c.number < chapter.number && c.recap).pop()
  const threads = previous?.recap?.openThreads?.filter((t) => t.trim()) ?? []
  return [
    `Current chapter: ${chapterLabel(chapter)}.${chapter.goal?.trim() ? ` Its goal: ${chapter.goal.trim()}` : ''}`,
    previous?.recap?.text.trim() ? `How ${chapterLabel(previous)} ended: ${previous.recap.text.trim()}` : '',
    threads.length ? `Left open by the last chapter: ${threads.join('; ')}` : '',
  ].filter(Boolean).join('\n')
}
