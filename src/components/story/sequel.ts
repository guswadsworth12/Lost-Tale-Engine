import type { Chat, Story } from '@/lib/types'

/**
 * Stories `story` could continue from: others in the same world (world-less stories match each
 * other), leaving out any that already continue from `story`, which would make a loop. Newest first.
 */
export function sequelCandidates(stories: Story[], story: Pick<Story, 'id' | 'worldId'>): Story[] {
  const worldId = story.worldId || undefined
  return stories
    .filter((s) => s.id !== story.id && (s.worldId || undefined) === worldId && s.continuesFrom?.storyId !== story.id)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/** A story's last scene: the highest `sceneNumber`, the later one on a tie (parallel storylines). */
export function lastScene(scenes: Chat[]): Chat | undefined {
  let last: Chat | undefined
  for (const scene of scenes) {
    if (!last) { last = scene; continue }
    const a = scene.sceneNumber ?? 1
    const b = last.sceneNumber ?? 1
    if (a > b || (a === b && scene.createdAt > last.createdAt)) last = scene
  }
  return last
}
