import { describe, expect, it } from 'vitest'
import { checkpointOf, planRewind, restoredChatPatch, type RewindInput } from './rewindPlan.ts'

const messages = [
  { id: 'm1', createdAt: 100 },
  { id: 'm2', createdAt: 200 },
  { id: 'm3', createdAt: 300 },
  { id: 'm4', createdAt: 400 },
]

const base = (over: Partial<RewindInput> = {}): RewindInput => ({
  chat: { id: 'c1', title: 'Night', gmNotes: 'secret', affection: 60, sceneFlags: ['kissed'], activeEvent: { id: 'date' }, scene: { turnPolicy: 'gm', timePhase: 'night' } },
  messages,
  messageId: 'm3',
  facts: [],
  events: [],
  objectives: [],
  othersPlayedSince: false,
  ...over,
})

describe('rewinding a scene to a message (#57)', () => {
  it('removes the message and everything after it, and records from those messages', () => {
    const plan = planRewind(base({
      facts: [{ id: 'f-old', sourceMessageId: 'm1', createdAt: 150 }, { id: 'f-new', sourceMessageId: 'm4', createdAt: 450 }, { id: 'f-unsourced', createdAt: 350 }],
      events: [{ id: 'e-old', sourceMessageId: 'm2', createdAt: 210 }, { id: 'e-new', sourceMessageId: 'm3', createdAt: 310 }],
    }))!
    expect(plan.removeMessageIds.sort()).toEqual(['m3', 'm4'])
    expect(plan.deleteFactIds.sort()).toEqual(['f-new', 'f-unsourced'])
    expect(plan.deleteEventIds).toEqual(['e-new'])
    expect(plan.summary).toMatchObject({ messages: 2, facts: 2, relationshipChanges: 1, stateRestored: false })
  })

  it('removes objectives made after the cut and reopens progress made after it', () => {
    const plan = planRewind(base({
      objectives: [
        { id: 'o-new', createdAt: 320, status: 'active', tasks: [] },
        { id: 'o-old', createdAt: 50, updatedAt: 410, status: 'completed', tasks: [
          { id: 't1', status: 'done', completedAt: 120 },
          { id: 't2', status: 'done', completedAt: 410 },
        ] },
        { id: 'o-untouched', createdAt: 50, updatedAt: 90, status: 'active', tasks: [{ id: 't3', status: 'pending' }] },
      ],
    }))!
    expect(plan.deleteObjectiveIds).toEqual(['o-new'])
    expect(plan.updateObjectives).toEqual([{ id: 'o-old', patch: { status: 'active', tasks: [{ id: 't1', status: 'done', completedAt: 120 }, { id: 't2', status: 'pending' }] } }])
  })

  it("puts the scene's turn state back from the checkpoint, keeping the scene's identity and the player's settings", () => {
    const checkpoint = checkpointOf({ id: 'c1', title: 'Old title', gmNotes: 'old notes', affection: 40, sceneFlags: [], scene: { turnPolicy: 'manual', timePhase: 'evening' } })
    expect(checkpoint.chat).toEqual({ affection: 40, sceneFlags: [], scene: { turnPolicy: 'manual', timePhase: 'evening' } })
    const plan = planRewind(base({ checkpoint }))!
    expect(plan.chatPatch).toEqual({
      affection: 40,
      sceneFlags: [],
      // A date started after the cut is gone; the turn policy stays the player's current choice.
      activeEvent: undefined,
      scene: { turnPolicy: 'gm', timePhase: 'evening' },
    })
    expect(plan.summary.stateRestored).toBe(true)
  })

  it('offers the world clock back only when it moved, and suggests it only when nothing else played since', () => {
    const checkpoint = checkpointOf({ id: 'c1' }, { id: 'w1', currentDay: 10, currentPhaseIndex: 2 })
    const moved = { id: 'w1', currentDay: 11, currentPhaseIndex: 0 }
    expect(planRewind(base({ checkpoint, world: moved }))!.clock).toEqual({ day: 10, phaseIndex: 2, suggested: true })
    expect(planRewind(base({ checkpoint, world: moved, othersPlayedSince: true }))!.clock).toEqual({ day: 10, phaseIndex: 2, suggested: false })
    expect(planRewind(base({ checkpoint, world: { id: 'w1', currentDay: 10, currentPhaseIndex: 2 } }))!.clock).toBeUndefined()
    expect(planRewind(base({ checkpoint, world: { id: 'other', currentDay: 99 } }))!.clock).toBeUndefined()
  })

  it("is undefined for a message that isn't in the scene, and clears a field the checkpoint didn't have", () => {
    expect(planRewind(base({ messageId: 'nope' }))).toBeUndefined()
    expect(restoredChatPatch({ id: 'c1', rapport: { level: 3 } }, {})).toEqual({ rapport: undefined })
  })
})
