/**
 * Where a scene is right now, derived from the branch instead of a single stored field.
 *
 * `Chat.scene.location` used to be the only record, and the only thing that moved it was a reply's
 * background tag. A place with no background art (a balcony terrace, say) could never be recorded:
 * every reply tagged the closest art, the stale label went back into the prompt, and the next reply
 * tagged it again. It also couldn't follow a rewind or a fork, because it lived on the chat.
 *
 * Now `Chat.scene` is only the opening setting. Moves are events on messages, replayed in order:
 * - the Game Master declaring that the fiction moved (`StoredMessage.gm.setting`),
 * - the player editing location/atmosphere in the Scene panel (`StoredMessage.sceneSetting`),
 * - a reply's background tag *changing* from the previous tagged reply. A tag that merely repeats
 *   the last art (because nothing closer exists) is not a move, so it never overrides a declared place.
 * Rewinding deletes the events after the cut, and forking copies the ones before it.
 */

export interface SceneSettingEvent {
  /** Where the scene now is. `null` clears it; omitted leaves it unchanged. */
  location?: string | null
  /** The feel of the place. `null` clears it; omitted after a location change clears it too, since it described the old place. */
  atmosphere?: string | null
}

export interface SceneSetting {
  location?: string
  atmosphere?: string
  source: 'chat' | 'tag' | 'gm' | 'player'
}

interface SettingMessage {
  role: string
  failed?: boolean
  scene?: { background?: string }
  swipeScenes?: ({ background?: string } | undefined)[]
  activeSwipe?: number
  gm?: { setting?: SceneSettingEvent }
  sceneSetting?: SceneSettingEvent
}

const clean = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

function apply(current: SceneSetting, event: SceneSettingEvent, source: SceneSetting['source']): SceneSetting {
  const next = { ...current, source }
  if ('location' in event) {
    const moved = clean(event.location) !== current.location
    next.location = clean(event.location)
    // A new place invalidates the old place's atmosphere unless the event says what the new one is.
    if (!('atmosphere' in event) && moved) next.atmosphere = undefined
  }
  if ('atmosphere' in event) next.atmosphere = clean(event.atmosphere)
  return next
}

export function sceneSettingFrom(
  messages: readonly SettingMessage[],
  chatScene: { location?: string | null; atmosphere?: string | null } | null | undefined,
  labelFor: (backgroundId: string) => string,
): SceneSetting {
  let setting: SceneSetting = { location: clean(chatScene?.location), atmosphere: clean(chatScene?.atmosphere), source: 'chat' }
  let lastTag: string | undefined
  for (const m of messages) {
    const tag = m.role === 'char' && !m.failed ? (m.swipeScenes?.[m.activeSwipe ?? 0] ?? m.scene)?.background : undefined
    if (tag) {
      if (lastTag !== undefined && tag !== lastTag) setting = apply(setting, { location: labelFor(tag) }, 'tag')
      lastTag = tag
    }
    if (m.gm?.setting) setting = apply(setting, m.gm.setting, 'gm')
    if (m.sceneSetting) setting = apply(setting, m.sceneSetting, 'player')
  }
  return setting
}
