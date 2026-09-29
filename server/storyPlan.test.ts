import { describe, expect, it } from 'vitest'
import { MAIN_STORYLINE_ID, planNextScene } from './storyPlan.ts'

const ids = () => {
  let n = 0
  return () => `id-${++n}`
}

const source = {
  id: 'scene-1',
  title: 'Homecoming',
  characterId: 'lead',
  participants: ['ally', 'rival'],
  playerCharacterId: 'hero',
  affection: 12,
  relationshipStats: { trust: 3 },
  giftCoins: 40,
  summary: 'A long rolling summary',
  summaryUpToTimestamp: 99,
  memoryScribedUpTo: 99,
  worldInfoState: { turn: 4 },
  rapport: { mood: 'warm' },
  scene: { turnPolicy: 'gm', location: 'Guildhall', presentCharacterIds: ['lead', 'ally', 'rival'], roundRobinIndex: 2 },
  carriedConsequences: ['The gate is sealed.'],
  setEventsDone: ['bind-one'],
  createdAt: 1,
  updatedAt: 2,
}
const recap = { text: 'They argued about the letter.', presentIds: ['lead', 'ally', 'rival', 'hero'], openThreads: ['Who sent it?', ''] }

describe('planNextScene', () => {
  it('turns a lone chat into scene 1 of a new story and opens scene 2', () => {
    const plan = planNextScene(source, [], undefined, { recap }, 1000, ids())
    expect(plan.storyIsNew).toBe(true)
    expect(plan.story).toMatchObject({ id: 'id-1', title: 'Homecoming' })
    expect(plan.sourcePatch).toMatchObject({
      endedAt: 1000,
      storyId: 'id-1',
      sceneNumber: 1,
      storylineId: MAIN_STORYLINE_ID,
      recap: { text: 'They argued about the letter.', openThreads: ['Who sent it?'], writtenAt: 1000 },
    })
    expect(plan.newChat).toMatchObject({ storyId: 'id-1', sceneNumber: 2, previousSceneId: 'scene-1', storylineId: MAIN_STORYLINE_ID })
  })

  it('carries the story state but not the transcript bookkeeping', () => {
    const { newChat } = planNextScene(source, [], undefined, { recap, consequences: ['The ally owes a favor.', 'The gate is sealed.'] }, 1000, ids())
    expect(newChat).toMatchObject({ affection: 12, relationshipStats: { trust: 3 }, giftCoins: 40, playerCharacterId: 'hero', participants: ['ally', 'rival'] })
    expect(newChat.carriedConsequences).toEqual(['The gate is sealed.', 'The ally owes a favor.'])
    expect(planNextScene(source, [], undefined, { recap, setEventsDone: ['bind-two', 'bind-one'] }, 1000, ids()).newChat.setEventsDone).toEqual(['bind-one', 'bind-two'])
    for (const gone of ['summary', 'summaryUpToTimestamp', 'worldInfoState', 'rapport', 'endedAt', 'recap', 'memoryScribedUpTo']) expect(newChat).not.toHaveProperty(gone)
    expect(newChat.createdAt).toBe(1000)
  })

  it('opens the next scene on the state the last one ended with, not the one it started with', () => {
    const started = { ...source, gameState: { supplies: 3 } }
    expect(planNextScene(started, [], undefined, { recap }, 1000, ids(), { supplies: 1, 'hurt@hero': true }).newChat.gameState).toEqual({ supplies: 1, 'hurt@hero': true })
    expect(planNextScene(started, [], undefined, { recap }, 1000, ids(), undefined).newChat.gameState).toBeUndefined()
  })

  it('sets up who is there and where, always keeping the lead and never the player', () => {
    const { newChat } = planNextScene(source, [], undefined, { recap, next: { presentIds: ['ally', 'hero'], location: 'The docks', title: '  Low tide  ' } }, 1000, ids())
    expect(newChat.scene).toMatchObject({ turnPolicy: 'gm', location: 'The docks', presentCharacterIds: ['lead', 'ally'], roundRobinIndex: 0 })
    expect(newChat.sceneTitle).toBe('Low tide')
  })

  it('numbers after the highest scene in an existing story and keeps its storyline', () => {
    const existing = { id: 'story-9', title: 'Saga', storylines: [], createdAt: 1, updatedAt: 1 }
    const later = { ...source, id: 'scene-5', storyId: 'story-9', sceneNumber: 5, storylineId: 'harbor' }
    const plan = planNextScene(later, [{ sceneNumber: 3 }, { sceneNumber: 7 }], existing, { recap }, 1000, ids())
    expect(plan.storyIsNew).toBe(false)
    expect(plan.sourcePatch).not.toHaveProperty('storyId')
    expect(plan.newChat).toMatchObject({ storyId: 'story-9', sceneNumber: 8, storylineId: 'harbor', title: 'Saga' })
  })

  it('splits off a named parallel storyline', () => {
    const plan = planNextScene(source, [], undefined, { recap, next: { newStorylineName: 'The archive' } }, 1000, ids())
    const lines = plan.story.storylines as { id: string; name: string }[]
    expect(lines).toEqual([{ id: 'id-2', name: 'The archive' }])
    expect(plan.newChat.storylineId).toBe('id-2')
  })
})
