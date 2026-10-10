// What rewinding a scene to a message undoes (#57). Pure, so the route (`rewind.ts`) only fetches and
// applies. A rewind removes the message and everything after it, and takes the scene back to how it
// stood just before that message: the turn-by-turn state on the chat comes from the checkpoint taken
// when the message was saved, and the scene's facts, relationship history and objective progress from
// those messages go too. Memories are retracted per message by the route (`retractMessageMemories`).

type Row = Record<string, unknown>

/**
 * Chat fields a rewind never touches: what the scene is, and the settings the player sets outside
 * turns (notes, set events, layout, assist options). Everything else changes turn by turn
 * (relationships, gifts, scene state, tracked game state, the rolling summary, who knows whom) and
 * comes back from the checkpoint.
 */
export const KEPT_CHAT_FIELDS = new Set([
  'id', 'characterId', 'playerCharacterId', 'personaId', 'title', 'createdAt', 'updatedAt',
  'storyId', 'sceneNumber', 'sceneTitle', 'storylineId', 'chapterId', 'chapterSceneNumber', 'previousSceneId',
  'endedAt', 'recap', 'parentChatId', 'forkedFromMessageId', 'mode', 'pinned', 'deletedAt',
  'lastOutreachCheckedAt', 'hasUnreadOutreach', 'ownerUserId', 'visibility',
  'authorNote', 'gmNotes', 'setEvents', 'gmPlayed', 'assistOverrides', 'carriedConsequences', 'consequenceAudience', 'stage',
  'memoryScribedUpTo',
])

export interface WorldClock {
  worldId: string
  day: number
  phaseIndex: number
}

/** Saved with each message: the chat's turn-by-turn state, and the world clock, just before it. */
export interface Checkpoint {
  chat: Row
  clock?: WorldClock
}

/** The part of a chat a checkpoint keeps. */
export function checkpointOf(chat: Row, world?: { id: string; currentDay?: number; currentPhaseIndex?: number }): Checkpoint {
  const state = Object.fromEntries(Object.entries(chat).filter(([key]) => !KEPT_CHAT_FIELDS.has(key)))
  return {
    chat: structuredClone(state),
    ...(world ? { clock: { worldId: world.id, day: world.currentDay ?? 0, phaseIndex: world.currentPhaseIndex ?? 0 } } : {}),
  }
}

/** The update that puts `current`'s turn state back as `checkpoint` holds it. A field added since is cleared. */
export function restoredChatPatch(current: Row, checkpoint: Row): Row {
  const patch: Row = {}
  for (const key of Object.keys(current)) {
    if (!KEPT_CHAT_FIELDS.has(key) && !(key in checkpoint)) patch[key] = undefined
  }
  for (const [key, value] of Object.entries(checkpoint)) {
    if (!KEPT_CHAT_FIELDS.has(key)) patch[key] = value
  }
  // Who takes turns is the player's choice, not something a turn changed.
  const scene = patch.scene as Row | undefined
  const turnPolicy = (current.scene as Row | undefined)?.turnPolicy
  if (scene && typeof scene === 'object' && turnPolicy !== undefined) patch.scene = { ...scene, turnPolicy }
  return patch
}

export interface RewindInput {
  chat: Row
  /** The scene's messages, any order. */
  messages: Row[]
  messageId: string
  /** The checkpoint saved with `messageId`. Messages saved before checkpoints existed have none. */
  checkpoint?: Checkpoint
  facts: Row[]
  events: Row[]
  objectives: Row[]
  world?: { id: string; currentDay?: number; currentPhaseIndex?: number }
  /** Another scene in this world has messages after the cut: its story went on, so the clock isn't wound back unasked. */
  othersPlayedSince: boolean
}

export interface RewindSummary {
  messages: number
  facts: number
  relationshipChanges: number
  objectivesRemoved: number
  objectivesReopened: number
  /** The scene's turn-by-turn state (relationships, gifts, scene, tracked state) comes back too. */
  stateRestored: boolean
}

export interface RewindPlan {
  cutAt: number
  removeMessageIds: string[]
  deleteFactIds: string[]
  deleteEventIds: string[]
  deleteObjectiveIds: string[]
  updateObjectives: { id: string; patch: Row }[]
  /** Unset when there's no checkpoint for the message. */
  chatPatch?: Row
  /** Where the world clock stood before this message, when it has moved since. `suggested`: nothing else in the world played since. */
  clock?: { day: number; phaseIndex: number; suggested: boolean }
  summary: RewindSummary
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** What rewinding `chat` to `messageId` removes and restores. Undefined when the message isn't in the scene. */
export function planRewind(input: RewindInput): RewindPlan | undefined {
  const ordered = [...input.messages].sort((a, b) => num(a.createdAt) - num(b.createdAt))
  const at = ordered.findIndex((m) => m.id === input.messageId)
  if (at < 0) return undefined
  const cutAt = num(ordered[at].createdAt)
  // The message and everything after it, in the order the scene shows them.
  const removedIds = new Set(ordered.slice(at).map((m) => String(m.id)))
  // A record from a removed message goes; one without a source goes when it was made at or after the cut.
  const fromRemoved = (r: Row) => (typeof r.sourceMessageId === 'string' && r.sourceMessageId ? removedIds.has(r.sourceMessageId) : num(r.createdAt) >= cutAt)

  const deleteFactIds = input.facts.filter(fromRemoved).map((f) => String(f.id))
  const deleteEventIds = input.events.filter(fromRemoved).map((e) => String(e.id))

  const deleteObjectiveIds: string[] = []
  const updateObjectives: { id: string; patch: Row }[] = []
  for (const o of input.objectives) {
    if (num(o.createdAt) >= cutAt) {
      deleteObjectiveIds.push(String(o.id))
      continue
    }
    const tasks = Array.isArray(o.tasks) ? (o.tasks as Row[]) : []
    let changed = false
    const reopened = tasks.map((t) => {
      if (t.status !== 'done' || t.completedAt === undefined || num(t.completedAt) < cutAt) return t
      changed = true
      const { completedAt: _done, ...rest } = t
      return { ...rest, status: 'pending' }
    })
    const reactivate = o.status !== 'active' && num(o.updatedAt) >= cutAt
    if (changed || reactivate) updateObjectives.push({ id: String(o.id), patch: { tasks: reopened, ...(reactivate ? { status: 'active' } : {}) } })
  }

  const chatPatch = input.checkpoint ? restoredChatPatch(input.chat, input.checkpoint.chat) : undefined
  const before = input.checkpoint?.clock
  const clock = before && input.world && before.worldId === input.world.id
    && (num(input.world.currentDay) !== before.day || num(input.world.currentPhaseIndex) !== before.phaseIndex)
    ? { day: before.day, phaseIndex: before.phaseIndex, suggested: !input.othersPlayedSince }
    : undefined

  return {
    cutAt,
    removeMessageIds: [...removedIds],
    deleteFactIds,
    deleteEventIds,
    deleteObjectiveIds,
    updateObjectives,
    chatPatch,
    clock,
    summary: {
      messages: removedIds.size,
      facts: deleteFactIds.length,
      relationshipChanges: deleteEventIds.length,
      objectivesRemoved: deleteObjectiveIds.length,
      objectivesReopened: updateObjectives.length,
      stateRestored: !!chatPatch,
    },
  }
}
