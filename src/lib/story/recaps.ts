import type { Chat } from '@/lib/types'
import { estimateTokens } from '@/lib/tokenEstimate'

/**
 * What earlier scenes a speaker gets told about. A scene's past is its chain of `previousSceneId`s,
 * so a scene split into a parallel storyline only knows what happened before the split. Within that
 * chain a character only hears recaps of scenes they were in; the narrator (Game Master) hears all.
 */

type SceneLike = Pick<Chat, 'id' | 'previousSceneId' | 'sceneNumber' | 'sceneTitle' | 'recap'>

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

export function sceneLabel(scene: Pick<Chat, 'sceneNumber' | 'sceneTitle'>): string {
  const number = `Scene ${scene.sceneNumber ?? 1}`
  return scene.sceneTitle?.trim() ? `${number} · ${scene.sceneTitle.trim()}` : number
}

/**
 * The "earlier scenes" block for one speaker, newest scenes kept when the budget runs out. Open
 * threads come from the latest visible scene only, since older ones are either resolved or restated.
 * Empty when there is nothing this viewer may know.
 */
export function storyRecapBlock(
  chain: SceneLike[],
  viewer: RecapViewer,
  opts: { maxTokens: number; speakerName?: string; estimate?: (text: string) => number },
): string {
  const visible = recapsVisibleTo(chain, viewer)
  if (!visible.length) return ''
  const estimate = opts.estimate ?? estimateTokens
  const heading = viewer === 'narrator' || !opts.speakerName
    ? 'Earlier scenes in this story:'
    : `Earlier scenes in this story that ${opts.speakerName} was there for:`
  const line = (s: SceneLike) => {
    const where = s.recap!.location?.trim() ? ` (${s.recap!.location.trim()})` : ''
    return `${sceneLabel(s)}${where}: ${s.recap!.text.trim()}`
  }
  const latest = visible[visible.length - 1]
  const threads = latest.recap!.openThreads?.filter((t) => t.trim()) ?? []
  const threadLine = threads.length ? `Still unresolved: ${threads.join('; ')}` : ''

  const kept: string[] = []
  let used = estimate([heading, threadLine].filter(Boolean).join('\n'))
  for (let i = visible.length - 1; i >= 0; i--) {
    const text = line(visible[i])
    const cost = estimate(text)
    // Always keep the most recent scene, even over budget: it's the handoff into this one.
    if (kept.length && used + cost > opts.maxTokens) break
    kept.unshift(text)
    used += cost
  }
  const dropped = visible.length - kept.length
  return [heading, dropped ? `(${dropped} earlier scene${dropped === 1 ? '' : 's'} not shown.)` : '', ...kept, threadLine]
    .filter(Boolean)
    .join('\n')
}
