/**
 * Planning half of stories made of scenes (`stories.ts` has the routes). Kept free of any database
 * import so it can be tested without opening one.
 */

type Row = Record<string, unknown>

export const MAIN_STORYLINE_ID = 'main'

export interface NextSceneRequest {
  recap: { text: string; presentIds: string[]; openThreads?: string[]; location?: string }
  /** Confirmed consequences from the ending scene's GM turns, to keep in force afterwards. */
  consequences?: string[]
  next?: {
    title?: string
    location?: string | null
    atmosphere?: string | null
    /** Who is in the next scene. The lead is always included. */
    presentIds?: string[]
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

/**
 * Plans ending `source` and opening the scene after it. Pure, so it can be tested without a
 * database. Carried over: the relationship track, gifts, inventory, gallery unlocks, flags, assist
 * settings, the player, and confirmed consequences. Left behind: the transcript, the rolling
 * summary (the recap replaces it), and per-scene bookkeeping (World Info timers, a live date read).
 */
export function planNextScene(
  source: Row,
  storyScenes: Row[],
  existingStory: Row | undefined,
  body: NextSceneRequest,
  now: number,
  id: () => string,
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
    forkedFromMessageId: _ff, sceneTitle: _st, lastOutreachCheckedAt: _lo, ...rest
  } = source
  const lead = str(source.characterId)
  const player = str(source.playerCharacterId)
  const participants = strings(source.participants)
  const present = body.next?.presentIds ? [...new Set([lead, ...strings(body.next.presentIds)])].filter((p) => p !== player) : undefined
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
  const newChat: Row = {
    ...rest,
    id: id(),
    title: str(story.title),
    storyId,
    sceneNumber: highest + 1,
    sceneTitle: str(body.next?.title).trim().slice(0, 120) || undefined,
    storylineId,
    previousSceneId: str(source.id),
    participants: participants.length ? participants : undefined,
    scene: nextScene,
    carriedConsequences: carried.length ? carried : undefined,
    createdAt: now,
    updatedAt: now,
  }
  return { story, storyIsNew, sourcePatch, newChat }
}
