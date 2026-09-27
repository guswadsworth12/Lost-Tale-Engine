/**
 * The player's in-chat scenery choice, and how it interacts with model scene tags.
 *
 * The rule: a background the player picks is **pinned**. While pinned, the stage shows it no matter
 * what `<<scene: background=…>>` tag a reply carries — the tags are still stored on their messages,
 * so choosing "Follow the story" later shows the latest tagged place again. The day/night variant is
 * a separate control: `auto` follows the world clock, `day`/`night` force that art whether the
 * background is pinned or story-driven.
 *
 * A choice is recorded on the latest message of the branch at the moment it's made
 * (`StoredMessage.scenery`), or on `Chat.scene.scenery` if the chat has no messages yet. The current
 * scenery is the most recent choice walking back through the branch, so a fork inherits it and a
 * rewind past the message it was recorded on restores whatever was chosen before.
 */

import type { WorldCard } from '@/lib/types'
import { backgroundLabel } from '@/lib/vn/backgrounds'

export type SceneryVariant = 'auto' | 'day' | 'night'

export interface SceneryChoice {
  /** Pinned background id, or null to follow the story's scene tags. */
  backgroundId: string | null
  variant: SceneryVariant
  setAt: number
}

export function currentScenery(
  messages: readonly { scenery?: SceneryChoice }[],
  chatScene?: { scenery?: SceneryChoice | null } | null,
): SceneryChoice | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const s = messages[i].scenery
    if (s) return s
  }
  return chatScene?.scenery ?? undefined
}

/** Whether night art should show: a forced variant wins, `auto` defers to the world clock. */
export function sceneryIsNight(choice: SceneryChoice | undefined, clockIsNight: boolean): boolean {
  if (choice?.variant === 'night') return true
  if (choice?.variant === 'day') return false
  return clockIsNight
}

/** The line the GM and character agents are given about where the scene stands. */
export function describeScenery(
  choice: SceneryChoice | undefined,
  shownBackgroundId: string | undefined,
  world: WorldCard | undefined,
  night: boolean,
): string {
  const place = shownBackgroundId ? backgroundLabel(shownBackgroundId, world) : 'no specific location'
  const light = night ? 'night' : 'day'
  if (choice?.backgroundId) {
    return `${place} (${light}) — pinned by the player; stay in this location unless the player moves the scene`
  }
  return `${place} (${light}) — follows the story's scene tags`
}

/** One-shot steer for character replies while a background is pinned, so they don't narrate a move the stage won't show. */
export function pinnedSceneryGuidance(choice: SceneryChoice | undefined, world: WorldCard | undefined): string {
  if (!choice?.backgroundId) return ''
  return `The scene is set in ${backgroundLabel(choice.backgroundId, world)}, chosen by the player. Keep the action there and keep any scene background tag on "${choice.backgroundId}".`
}
