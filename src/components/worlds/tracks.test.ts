import { describe, expect, it } from 'vitest'
import { STARTER_PBTA_CAMPAIGN } from '@/lib/world/campaign'
import { changeTrackKind, newTrack, removeTrack, tracksProblem } from './tracks'

describe('world tracks', () => {
  it('needs unique, nonempty names', () => {
    expect(tracksProblem(STARTER_PBTA_CAMPAIGN.tracks!)).toBeUndefined()
    expect(tracksProblem([{ id: 'a', name: 'Supplies', kind: 'resource' }, { id: 'b', name: ' supplies ', kind: 'resource' }])).toMatch(/unique/)
    expect(tracksProblem([{ id: 'a', name: ' ', kind: 'condition' }])).toMatch(/nonempty/)
  })

  it('starts a new track with a free name and sensible settings', () => {
    expect(newTrack([{ id: 'a', name: 'Tracked 2', kind: 'resource' }], 'n')).toEqual({ id: 'n', name: 'Tracked 3', kind: 'resource', max: 3 })
    expect(newTrack([], 'c', 'clock')).toEqual({ id: 'c', name: 'Tracked 1', kind: 'clock', max: 4, perScene: true, gmOnly: true })
  })

  it('drops settings a new kind does not have', () => {
    expect(changeTrackKind({ id: 's', name: 'Supplies', kind: 'resource', max: 30, start: 2, gmOnly: true }, 'condition'))
      .toEqual({ id: 's', name: 'Supplies', kind: 'condition', gmOnly: true })
    expect(changeTrackKind({ id: 's', name: 'Supplies', kind: 'resource', max: 30 }, 'clock')).toEqual({ id: 's', name: 'Supplies', kind: 'clock', max: 20, perScene: true })
  })

  it('removes a track with every move effect that pointed at it', () => {
    const removed = removeTrack(STARTER_PBTA_CAMPAIGN, 'trouble')
    expect(removed.tracks?.map((t) => t.id)).toEqual(['hurt', 'supplies'])
    expect(removed.moves.find((m) => m.id === 'take-a-risk')).not.toHaveProperty('effects')
    const push = removed.moves.find((m) => m.id === 'push-through')!
    expect(push.effects).toEqual({ miss: [{ trackId: 'hurt', set: true }] })
    expect(push.choiceEffects?.map((c) => c.option)).toEqual(['hurt', 'spent'])
  })
})
