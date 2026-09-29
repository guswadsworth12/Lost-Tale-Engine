import type { CampaignConfig } from '@/lib/world/campaign'
import { MAX_TRACKS, type CampaignTrack, type TrackEffect, type TrackKind } from '@/lib/world/gameState'

/** Why the tracks can't be saved as written, or undefined when they can. Names are unique ignoring case, as on the server. */
export function tracksProblem(tracks: readonly CampaignTrack[]): string | undefined {
  if (tracks.length > MAX_TRACKS) return `A world can track at most ${MAX_TRACKS} things.`
  const names = tracks.map((track) => track.name.trim().toLowerCase())
  if (!names.every(Boolean) || new Set(names).size !== names.length) return 'Give each tracked thing a unique, nonempty name before saving.'
  return undefined
}

/** A fresh track of `kind` with a name that doesn't collide. */
export function newTrack(tracks: readonly CampaignTrack[], id: string, kind: TrackKind = 'resource'): CampaignTrack {
  const taken = new Set(tracks.map((track) => track.name.trim().toLowerCase()))
  let number = tracks.length + 1
  while (taken.has(`tracked ${number}`)) number++
  return { id, name: `Tracked ${number}`, kind, ...(kind === 'resource' ? { max: 3 } : kind === 'clock' ? { max: 4, perScene: true, gmOnly: true } : {}) }
}

/** A track changed to another kind keeps only the settings that kind has. */
export function changeTrackKind(track: CampaignTrack, kind: TrackKind): CampaignTrack {
  const { max: _max, start: _start, perScene: _perScene, ...rest } = track
  return { ...rest, kind, ...(kind === 'resource' ? { max: track.max ?? 3 } : kind === 'clock' ? { max: Math.min(track.max ?? 4, 20), perScene: true } : {}) }
}

const without = (effects: TrackEffect[] | undefined, trackId: string) => {
  const kept = (effects ?? []).filter((effect) => effect.trackId !== trackId)
  return kept.length ? kept : undefined
}

/** Removes a track and every move effect that pointed at it, so none is left changing nothing. */
export function removeTrack(campaign: CampaignConfig, trackId: string): CampaignConfig {
  return {
    ...campaign,
    tracks: (campaign.tracks ?? []).filter((track) => track.id !== trackId),
    moves: campaign.moves.map((move) => {
      const { effects, choiceEffects, ...rest } = move
      const tiers = Object.fromEntries((['strong', 'mixed', 'miss'] as const)
        .map((tier) => [tier, without(effects?.[tier], trackId)] as const)
        .filter(([, list]) => !!list))
      const choices = (choiceEffects ?? [])
        .map((entry) => ({ ...entry, effects: without(entry.effects, trackId) ?? [] }))
        .filter((entry) => entry.effects.length)
      return { ...rest, ...(Object.keys(tiers).length ? { effects: tiers } : {}), ...(choices.length ? { choiceEffects: choices } : {}) }
    }),
  }
}
