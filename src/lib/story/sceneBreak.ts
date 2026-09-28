/**
 * When to suggest ending the current scene. Context pressure always wins: a scene that's nearly out
 * of room needs breaking whatever the story is doing. Otherwise a move or a time skip after a scene
 * has had some room to breathe is a natural seam.
 */

export const SCENE_CONTEXT_WARN = 0.7
export const SCENE_CONTEXT_URGENT = 0.85
/** A location change or time skip only suggests a break once the scene has at least this many messages. */
export const SCENE_MIN_MESSAGES_FOR_SEAM = 6

export interface SceneBreakHint {
  reason: string
  urgent: boolean
}

export function sceneBreakHint(s: {
  contextRatio: number
  messagesInScene: number
  locationChanged?: string
  timeSkipped?: boolean
}): SceneBreakHint | null {
  if (s.contextRatio >= SCENE_CONTEXT_URGENT) {
    return { reason: 'This scene is nearly out of room. End it to keep replies sharp.', urgent: true }
  }
  if (s.contextRatio >= SCENE_CONTEXT_WARN) {
    return { reason: "This scene is using most of the model's context.", urgent: false }
  }
  if (s.messagesInScene >= SCENE_MIN_MESSAGES_FOR_SEAM) {
    const place = s.locationChanged?.trim()
    if (place) return { reason: `The story moved to ${place}. A good point for a new scene.`, urgent: false }
    if (s.timeSkipped) return { reason: 'Time has moved on. A good point for a new scene.', urgent: false }
  }
  return null
}
