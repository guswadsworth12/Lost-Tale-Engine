import type { Chat, RelationshipTrack } from '@/lib/types'

/**
 * A scene's lead (`Chat.characterId`): the character always in the scene, whose relationship track
 * lives in `Chat`'s own top-level fields rather than in `participantRelationships`. Changing the
 * lead moves both tracks so neither character loses anything.
 *
 * Only type imports here: the server loads this file with plain Node.
 */

/** Every field of the lead's relationship track, as `Chat` holds it at the top level. */
export const LEAD_TRACK_KEYS = [
  'affection', 'relationshipStats', 'relationshipStage', 'commitmentStatus', 'commitmentStartedDay',
  'relationshipWarning', 'breakupCount', 'unlockedGalleryIds', 'giftsGiven', 'mood', 'currentNeed',
  'characterIntent', 'momentum', 'plans', 'firstIntimateSceneAt', 'afterglow', 'initiativeBalance',
  'recentRebuff', 'intimacyScene', 'giftLog', 'intimacySceneShapeLog', 'discoveredRegions',
  'beliefsAboutUser', 'expectationsOfUser', 'currentFear', 'currentDesire', 'reciprocityCue',
] as const satisfies readonly (keyof RelationshipTrack)[]

// A field added to `RelationshipTrack` without being listed above fails to compile here.
type Unlisted = Exclude<keyof RelationshipTrack, (typeof LEAD_TRACK_KEYS)[number]>
const everyTrackFieldListed: [Unlisted] extends [never] ? true : Unlisted = true
void everyTrackFieldListed

type LeadHost = Pick<Chat, 'characterId' | 'participants' | 'participantRelationships' | 'scene' | (typeof LEAD_TRACK_KEYS)[number]>

/** The lead's relationship track as `Chat` holds it, only the fields that are set. */
export function leadTrack(chat: Partial<LeadHost>): RelationshipTrack {
  const track: Record<string, unknown> = {}
  for (const key of LEAD_TRACK_KEYS) if (chat[key] !== undefined) track[key] = chat[key]
  return track as RelationshipTrack
}

/**
 * The patch that makes `newLeadId` this scene's lead. The old lead's track moves into
 * `participantRelationships` and the new lead's moves up into the top-level fields (any it doesn't
 * have are cleared, so nothing of the old lead's is left behind). With `keepPrevious` the old lead
 * stays in the scene as a participant; without it, they leave it. The new lead is always present.
 *
 * Fields set to `undefined` are meant to be cleared: the server's merge drops them.
 */
export function planLeadChange(chat: LeadHost, newLeadId: string, opts: { keepPrevious: boolean }): Partial<Chat> {
  const oldLeadId = chat.characterId
  if (!newLeadId || newLeadId === oldLeadId) return {}
  const { [newLeadId]: incoming, ...others } = chat.participantRelationships ?? {}
  const outgoing = leadTrack(chat)
  const relationships = { ...others, ...(oldLeadId && Object.keys(outgoing).length ? { [oldLeadId]: outgoing } : {}) }

  const patch: Record<string, unknown> = { characterId: newLeadId }
  for (const key of LEAD_TRACK_KEYS) patch[key] = incoming?.[key]
  patch.participantRelationships = Object.keys(relationships).length ? relationships : undefined

  const participants = (chat.participants ?? []).filter((id) => id !== newLeadId && id !== oldLeadId)
  if (opts.keepPrevious && oldLeadId) participants.push(oldLeadId)
  patch.participants = participants.length ? participants : undefined

  if (chat.scene) {
    const present = chat.scene.presentCharacterIds
    patch.scene = {
      ...chat.scene,
      roundRobinIndex: 0,
      ...(present ? { presentCharacterIds: [newLeadId, ...present.filter((id) => id !== newLeadId && (opts.keepPrevious || id !== oldLeadId))] } : {}),
    }
  }
  return patch as Partial<Chat>
}
