import type { Chat, StoredMessage, Story } from '@/lib/types'
import { MAIN_STORYLINE_ID } from '@/lib/types'
import { sceneChain, sceneLabel } from './recaps'
import { chapterIdOf, chapterLabel, chapterSceneLabel, chaptersOf, sceneNumberInChapter } from './chapters'

/**
 * The Stories library's view of chats: one entry per story rather than per scene. A chat without
 * `storyId` is a story of one scene, the chat itself.
 */

export interface StoryGroup {
  storyId: string
  title: string
  /** Oldest first, by `sceneNumber`. */
  scenes: Chat[]
  /** The scene the library opens: the most recently played scene that hasn't ended. */
  current: Chat
  sceneCount: number
  /** Where the current scene is: "Chapter 2 · Scene 1", or "Scene 3" for a story that never named or ended a chapter. */
  position: string
  storylineCount: number
  updatedAt: number
}

type SceneOrder = Pick<Chat, 'sceneNumber' | 'createdAt'>
const byScene = (a: SceneOrder, b: SceneOrder) => (a.sceneNumber ?? 1) - (b.sceneNumber ?? 1) || a.createdAt - b.createdAt

/** Which storyline a scene belongs to; unset reads as the main one. */
export function storylineOf(scene: Pick<Chat, 'storylineId'>): string {
  return scene.storylineId || MAIN_STORYLINE_ID
}

/** The most recently updated scene that hasn't ended; if every scene has ended, the latest one. */
export function currentSceneOf(scenes: Chat[]): Chat | undefined {
  const open = scenes.filter((s) => !s.endedAt)
  if (open.length) return open.reduce((best, s) => (s.updatedAt > best.updatedAt ? s : best))
  return latestSceneFor(scenes)
}

export function groupStories(chats: Chat[], stories: Story[]): StoryGroup[] {
  const storyById = new Map(stories.map((s) => [s.id, s]))
  const buckets = new Map<string, Chat[]>()
  for (const chat of chats) {
    const key = chat.storyId || chat.id
    const bucket = buckets.get(key)
    if (bucket) bucket.push(chat)
    else buckets.set(key, [chat])
  }
  const groups: StoryGroup[] = []
  for (const [storyId, bucket] of buckets) {
    const scenes = [...bucket].sort(byScene)
    const current = currentSceneOf(scenes)!
    const story = storyById.get(storyId)
    const updatedAt = Math.max(...scenes.map((s) => s.updatedAt), story?.updatedAt ?? 0)
    groups.push({
      storyId,
      title: story?.title?.trim() || current.title,
      scenes,
      current,
      sceneCount: scenes.length,
      position: story?.chapters?.length ? chapterSceneLabel(chaptersOf(story, scenes), current) : `Scene ${sceneNumberInChapter(current)}`,
      storylineCount: new Set(scenes.map(storylineOf)).size,
      updatedAt,
    })
  }
  return groups.sort((a, b) => b.updatedAt - a.updatedAt)
}

/** The scenes of the story `chat` belongs to, oldest first (just `chat` for a story of one scene). */
export function scenesOfStory(chats: Chat[], chat: Pick<Chat, 'id' | 'storyId'>): Chat[] {
  if (!chat.storyId) return chats.filter((c) => c.id === chat.id)
  return chats.filter((c) => c.storyId === chat.storyId).sort(byScene)
}

/** The highest-numbered scene, optionally within one storyline. */
export function latestSceneFor<T extends Pick<Chat, 'sceneNumber' | 'createdAt' | 'storylineId'>>(scenes: T[], storylineId?: string): T | undefined {
  const pool = storylineId ? scenes.filter((s) => storylineOf(s) === storylineId) : scenes
  return pool.reduce<T | undefined>((best, s) => (!best || byScene(s, best) > 0 ? s : best), undefined)
}

/** The scene that continues from `sceneId`, preferring one on the same storyline over a split-off one. */
export function nextSceneOf<T extends Pick<Chat, 'id' | 'previousSceneId' | 'sceneNumber' | 'createdAt' | 'storylineId'>>(scenes: T[], sceneId: string): T | undefined {
  const source = scenes.find((s) => s.id === sceneId)
  const followers = scenes.filter((s) => s.previousSceneId === sceneId && s.id !== sceneId).sort(byScene)
  if (!followers.length) return undefined
  const line = source ? storylineOf(source) : MAIN_STORYLINE_ID
  return followers.find((s) => storylineOf(s) === line) ?? followers[0]
}

export interface StoryLane {
  storylineId: string
  name: string
  /** Oldest first. */
  scenes: Chat[]
  /** The scene on another storyline this lane continues from, when it split off. */
  splitFrom?: Chat
}

/** Scenes grouped by storyline: the main line first, then `story.storylines` in order, then any unnamed ones. */
export function storyLanes(story: Pick<Story, 'storylines'> | undefined, scenes: Chat[]): StoryLane[] {
  const sorted = [...scenes].sort(byScene)
  const byId = new Map(sorted.map((s) => [s.id, s]))
  const order = [MAIN_STORYLINE_ID, ...(story?.storylines ?? []).map((l) => l.id).filter((id) => id !== MAIN_STORYLINE_ID)]
  for (const s of sorted) if (!order.includes(storylineOf(s))) order.push(storylineOf(s))
  const lanes: StoryLane[] = []
  for (const id of order) {
    const laneScenes = sorted.filter((s) => storylineOf(s) === id)
    if (!laneScenes.length) continue
    const parent = laneScenes[0].previousSceneId ? byId.get(laneScenes[0].previousSceneId) : undefined
    lanes.push({
      storylineId: id,
      name: id === MAIN_STORYLINE_ID ? 'Main story' : story?.storylines?.find((l) => l.id === id)?.name?.trim() || 'Side storyline',
      scenes: laneScenes,
      splitFrom: parent && storylineOf(parent) !== id ? parent : undefined,
    })
  }
  return lanes
}

/** Where a scene is (or ended): its recap's location, else its live scene location. */
export function sceneLocation(scene: Pick<Chat, 'recap' | 'scene'>): string | undefined {
  return scene.recap?.location?.trim() || scene.scene?.location?.trim() || undefined
}

/** The scenes a reader covers to reach `fromSceneId`: its chain of earlier scenes, then the scene itself. */
export function transcriptScenes(scenes: Chat[], fromSceneId: string | undefined): Chat[] {
  const current = scenes.find((s) => s.id === fromSceneId) ?? latestSceneFor(scenes)
  return current ? [...sceneChain(scenes, current), current] : []
}

/** The message text as shown: the active swipe when it has alternates. Empty for a failed turn. */
export function messageDisplayText(m: Pick<StoredMessage, 'text' | 'swipes' | 'activeSwipe' | 'failed'>): string {
  if (m.failed) return ''
  return (m.swipes?.length ? m.swipes[m.activeSwipe ?? 0] ?? m.text : m.text)?.trim() ?? ''
}

/** A plain-text copy of a read-through, scene by scene, with a heading where each chapter starts when `story` has chapters. */
export function transcriptAsText(title: string, parts: { scene: Chat; messages: Pick<StoredMessage, 'name' | 'text' | 'swipes' | 'activeSwipe' | 'failed'>[] }[], story?: Pick<Story, 'chapters'>): string {
  const chapters = story?.chapters?.length ? chaptersOf(story, parts.map((p) => p.scene)) : []
  let lastChapter = ''
  const blocks = parts.map(({ scene, messages }) => {
    const chapter = chapters.find((c) => c.id === chapterIdOf(scene))
    const chapterHeading = chapter && chapter.id !== lastChapter ? `# ${chapterLabel(chapter)}${chapter.goal?.trim() ? `\n\nGoal: ${chapter.goal.trim()}` : ''}\n\n` : ''
    if (chapter) lastChapter = chapter.id
    const where = sceneLocation(scene)
    const heading = where ? `${sceneLabel(scene)} · ${where}` : sceneLabel(scene)
    const lines = messages.map((m) => ({ name: m.name, text: messageDisplayText(m) })).filter((m) => m.text).map((m) => `${m.name}: ${m.text}`)
    return chapterHeading + [`## ${heading}`, scene.recap?.text?.trim() ? `Recap: ${scene.recap.text.trim()}` : '', ...lines].filter(Boolean).join('\n\n')
  })
  return [`# ${title}`, ...blocks].join('\n\n')
}
