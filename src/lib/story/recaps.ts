import type { Chapter, Chat } from '@/lib/types'
import { estimateTokens } from '@/lib/tokenEstimate'
import { chapterIdOf, chapterLabel, sceneNumberInChapter } from './chapters'

/**
 * What earlier scenes a speaker gets told about. A scene's past is its chain of `previousSceneId`s,
 * so a scene split into a parallel storyline only knows what happened before the split. Within that
 * chain a character only hears recaps of scenes they were in; the narrator (Game Master) hears all.
 */

type SceneLike = Pick<Chat, 'id' | 'previousSceneId' | 'sceneNumber' | 'sceneTitle' | 'recap'> & Partial<Pick<Chat, 'chapterId' | 'chapterSceneNumber'>>

/** The scenes before `current`, oldest first. Stops at a missing link or a loop. */
export function sceneChain<T extends SceneLike>(scenes: T[], current: Pick<Chat, 'id' | 'previousSceneId'>): T[] {
  const byId = new Map(scenes.map((s) => [s.id, s]))
  const chain: T[] = []
  const seen = new Set<string>([current.id])
  let nextId = current.previousSceneId
  while (nextId && !seen.has(nextId)) {
    const scene = byId.get(nextId)
    if (!scene) break
    seen.add(nextId)
    chain.unshift(scene)
    nextId = scene.previousSceneId
  }
  return chain
}

/** A character agent sees scenes they were present for; the narrator sees every scene. */
export type RecapViewer = { characterId: string } | 'narrator'

export function recapsVisibleTo<T extends SceneLike>(chain: T[], viewer: RecapViewer): T[] {
  return chain.filter((s) => s.recap?.text?.trim() && (viewer === 'narrator' || s.recap.presentIds.includes(viewer.characterId)))
}

/** "Scene 2 · The cistern", numbered within its chapter (the story's number, in a first chapter). */
export function sceneLabel(scene: Pick<Chat, 'sceneNumber' | 'sceneTitle'> & Partial<Pick<Chat, 'chapterSceneNumber'>>): string {
  const number = `Scene ${sceneNumberInChapter(scene)}`
  return scene.sceneTitle?.trim() ? `${number} · ${scene.sceneTitle.trim()}` : number
}

/**
 * The "earlier scenes" block for one speaker, newest kept when the budget runs out. Open threads come
 * from the latest scene shown, since older ones are either resolved or restated.
 *
 * With `chapters`, scene lines name their chapter, and the narrator hears an ended chapter as its
 * recap instead of scene by scene, for the scenes that recap covers: a branch that played the
 * chapter differently keeps its own scene recaps. A character still hears only the scenes they were
 * in, one by one, since a chapter recap spans scenes they may have missed.
 * Empty when there is nothing this viewer may know.
 */
export function storyRecapBlock(
  chain: SceneLike[],
  viewer: RecapViewer,
  opts: { maxTokens: number; speakerName?: string; estimate?: (text: string) => number; chapters?: readonly Chapter[] },
): string {
  const chapters = opts.chapters ?? []
  const chapterOf = (s: SceneLike) => chapters.find((c) => c.id === chapterIdOf(s))
  const named = chapters.length > 1
  const sceneLine = (s: SceneLike) => {
    const where = s.recap!.location?.trim() ? ` (${s.recap!.location.trim()})` : ''
    const chapter = named ? chapterOf(s) : undefined
    return `${chapter ? `Chapter ${chapter.number}, ` : ''}${sceneLabel(s)}${where}: ${s.recap!.text.trim()}`
  }
  const items: { text: string; threads: string[] }[] = []
  const summarized = new Set<string>()
  for (const s of recapsVisibleTo(chain, viewer)) {
    const chapter = viewer === 'narrator' ? chapterOf(s) : undefined
    if (chapter?.endedAt && chapter.recap?.text.trim() && chapter.recap.sceneIds.includes(s.id)) {
      if (summarized.has(chapter.id)) continue
      summarized.add(chapter.id)
      items.push({ text: `${chapterLabel(chapter)} (the whole chapter): ${chapter.recap.text.trim()}`, threads: chapter.recap.openThreads ?? [] })
      continue
    }
    items.push({ text: sceneLine(s), threads: s.recap!.openThreads ?? [] })
  }
  if (!items.length) return ''
  const estimate = opts.estimate ?? estimateTokens
  const heading = viewer === 'narrator' || !opts.speakerName
    ? 'Earlier scenes in this story:'
    : `Earlier scenes in this story that ${opts.speakerName} was there for:`
  const threads = items[items.length - 1].threads.filter((t) => t.trim())
  const threadLine = threads.length ? `Still unresolved: ${threads.join('; ')}` : ''

  const kept: string[] = []
  let used = estimate([heading, threadLine].filter(Boolean).join('\n'))
  for (let i = items.length - 1; i >= 0; i--) {
    const cost = estimate(items[i].text)
    // Always keep the most recent one, even over budget: it's the handoff into this scene.
    if (kept.length && used + cost > opts.maxTokens) break
    kept.unshift(items[i].text)
    used += cost
  }
  const dropped = items.length - kept.length
  return [heading, dropped ? `(${dropped} earlier scene${dropped === 1 ? '' : 's'} not shown.)` : '', ...kept, threadLine]
    .filter(Boolean)
    .join('\n')
}
