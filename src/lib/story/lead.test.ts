import { describe, expect, it } from 'vitest'
import { LEAD_TRACK_KEYS, planLeadChange } from './lead'
import { getRelationshipTrack } from '@/lib/dating/stage'
import type { Chat } from '@/lib/types'

const scene = {
  characterId: 'orra',
  participants: ['mae', 'brisa', 'aurelia'],
  affection: 20,
  relationshipStats: { trust: 4 },
  mood: 'calm',
  participantRelationships: { brisa: { affection: 35, relationshipStats: { trust: 9 } }, mae: { affection: 10 } },
  scene: { turnPolicy: 'gm', presentCharacterIds: ['orra', 'mae', 'brisa', 'aurelia'], roundRobinIndex: 2 },
} as unknown as Chat

/** The chat as the server's merge leaves it: fields patched to undefined are gone. */
const merged = (patch: Partial<Chat>) => JSON.parse(JSON.stringify({ ...scene, ...patch })) as Chat

describe('changing the lead', () => {
  it('moves both relationships with their characters and takes the old lead out', () => {
    const after = merged(planLeadChange(scene, 'brisa', { keepPrevious: false }))
    expect(after.characterId).toBe('brisa')
    expect(getRelationshipTrack(after, 'brisa')).toMatchObject({ affection: 35, relationshipStats: { trust: 9 } })
    expect(after.mood).toBeUndefined()
    expect(getRelationshipTrack(after, 'orra')).toEqual({ affection: 20, relationshipStats: { trust: 4 }, mood: 'calm' })
    expect(getRelationshipTrack(after, 'mae')).toEqual({ affection: 10 })
    expect(after.participants).toEqual(['mae', 'aurelia'])
    expect(after.scene).toMatchObject({ presentCharacterIds: ['brisa', 'mae', 'aurelia'], roundRobinIndex: 0 })
  })

  it('can keep the old lead in the scene, and lead someone who had no track yet', () => {
    const after = merged(planLeadChange(scene, 'aurelia', { keepPrevious: true }))
    expect(after.participants).toEqual(['mae', 'brisa', 'orra'])
    expect(after.scene?.presentCharacterIds).toEqual(['aurelia', 'orra', 'mae', 'brisa'])
    expect(after.affection).toBeUndefined()
    expect(after.participantRelationships).toMatchObject({ orra: { affection: 20 }, brisa: { affection: 35 } })
  })

  it('changes nothing for the lead they already have', () => {
    expect(planLeadChange(scene, 'orra', { keepPrevious: false })).toEqual({})
  })

  it('moves every field the lead track has', () => {
    expect(Object.keys(getRelationshipTrack(scene, 'orra')).sort()).toEqual([...LEAD_TRACK_KEYS].sort())
  })
})
