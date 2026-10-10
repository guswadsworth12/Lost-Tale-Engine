import { describe, expect, it } from 'vitest'
import { MAIN_STORYLINE_ID, StoryPlanError, planChapterEdit, planNextScene, planSceneRemoval, planSceneRestore } from './storyPlan.ts'

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

  it('carries who saw each consequence, merged with what came before, and only for consequences still carried', () => {
    const before = { ...source, consequenceAudience: { 'The gate is sealed.': ['lead'], 'Forgotten.': ['ally'] } }
    const { newChat } = planNextScene(before, [], undefined, { recap, consequences: ['The ally owes a favor.', 'The gate is sealed.'], consequenceAudience: { 'The ally owes a favor.': ['ally', 'hero'], 'The gate is sealed.': ['rival'], 'Not carried.': ['x'] } }, 1000, ids())
    expect(newChat.consequenceAudience).toEqual({ 'The gate is sealed.': ['lead', 'rival'], 'The ally owes a favor.': ['ally', 'hero'] })
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

describe('chapters', () => {
  const chapterRecap = { text: 'The letter was a forgery.', openThreads: ['Who forged it?', ' '] }

  it('keeps a scene in its chapter, numbered after the chapter\'s highest scene', () => {
    const second = { ...source, id: 'scene-2', storyId: 'story-1', sceneNumber: 2, previousSceneId: 'scene-1' }
    const { newChat, story } = planNextScene(second, [{ ...source, storyId: 'story-1', sceneNumber: 1 }], { id: 'story-1', title: 'Homecoming' }, { recap }, 1000, ids())
    expect(newChat).toMatchObject({ chapterId: 'chapter-1', chapterSceneNumber: 3, sceneNumber: 3 })
    // Nothing is written down about chapters until one is named or ended.
    expect(story).not.toHaveProperty('chapters')
  })

  it('ends a chapter with its recap and opens the next scene as the first of a new one', () => {
    const second = { ...source, id: 'scene-2', storyId: 'story-1', sceneNumber: 2, previousSceneId: 'scene-1' }
    const first = { ...source, storyId: 'story-1', sceneNumber: 1, endedAt: 500, recap: { text: 'They met.', presentIds: [], writtenAt: 500 } }
    const plan = planNextScene(second, [first], { id: 'story-1', title: 'Homecoming' },
      { recap, chapter: { recap: chapterRecap, next: { title: ' Low Tide ', goal: 'Find the forger.' } } }, 1000, ids())
    expect(plan.story.chapters).toEqual([
      { id: 'chapter-1', number: 1, startedAt: 1, endedAt: 1000, recap: { text: 'The letter was a forgery.', openThreads: ['Who forged it?'], sceneIds: ['scene-1', 'scene-2'], writtenAt: 1000 } },
      { id: 'id-1', number: 2, title: 'Low Tide', goal: 'Find the forger.', startedAt: 1000 },
    ])
    expect(plan.newChat).toMatchObject({ chapterId: 'id-1', chapterSceneNumber: 1, sceneNumber: 3, previousSceneId: 'scene-2' })
    // The ending scene gets its own recap as always; no earlier scene is touched.
    expect(Object.keys(plan.sourcePatch).sort()).toEqual(['endedAt', 'recap'])
    expect(first).not.toHaveProperty('chapterId')
  })

  it('turns a lone chat into chapter 1 of a new story when its chapter ends', () => {
    const plan = planNextScene(source, [], undefined, { recap, chapter: { recap: chapterRecap } }, 1000, ids())
    expect(plan.story.chapters).toMatchObject([{ id: 'chapter-1', endedAt: 1000, recap: { sceneIds: ['scene-1'] } }, { id: 'id-2', number: 2 }])
    expect(plan.newChat).toMatchObject({ storyId: 'id-1', chapterId: 'id-2', chapterSceneNumber: 1 })
  })

  it('refuses to end a chapter twice, or without a recap', () => {
    const story = { id: 'story-1', chapters: [{ id: 'chapter-1', number: 1, startedAt: 1, endedAt: 5, recap: { text: 'x', sceneIds: [], writtenAt: 5 } }] }
    // A fork of a scene from a chapter that already ended plays on in it, but can't end it again.
    const fork = { ...source, id: 'fork-1', storyId: 'story-1', chapterId: 'chapter-1' }
    expect(() => planNextScene(fork, [], story, { recap, chapter: { recap: chapterRecap } }, 1000, ids())).toThrow(StoryPlanError)
    expect(planNextScene(fork, [], story, { recap }, 1000, ids()).newChat.chapterId).toBe('chapter-1')
    expect(() => planNextScene(source, [], undefined, { recap, chapter: { recap: { text: ' ' } } }, 1000, ids())).toThrow(/recap is required/)
  })

  it('counts only this line of play in the chapter recap, not a parallel branch', () => {
    const s1 = { ...source, storyId: 'story-1', sceneNumber: 1 }
    const main = { ...source, id: 's-main', storyId: 'story-1', sceneNumber: 2, previousSceneId: 'scene-1' }
    const north = { ...source, id: 's-north', storyId: 'story-1', sceneNumber: 3, previousSceneId: 'scene-1', storylineId: 'north' }
    const plan = planNextScene(north, [s1, main], { id: 'story-1' }, { recap, chapter: { recap: chapterRecap } }, 1000, ids())
    expect((plan.story.chapters as { recap?: { sceneIds: string[] } }[])[0].recap?.sceneIds).toEqual(['scene-1', 's-north'])
  })
})

describe('planChapterEdit', () => {
  it('names the first chapter of a lone chat, making it scene 1 of a new story', () => {
    const plan = planChapterEdit(source, [], undefined, { title: 'The Fog', goal: 'Get home.' }, 1000, ids())
    expect(plan.storyIsNew).toBe(true)
    expect(plan.story).toMatchObject({ id: 'id-1', title: 'Homecoming', chapters: [{ id: 'chapter-1', number: 1, title: 'The Fog', goal: 'Get home.' }] })
    expect(plan.sourcePatch).toEqual({ storyId: 'id-1', sceneNumber: 1, storylineId: 'main', chapterId: 'chapter-1' })
  })

  it('edits any chapter of the story, and corrects a recap only once the chapter has ended', () => {
    const story = { id: 'story-1', chapters: [
      { id: 'chapter-1', number: 1, startedAt: 1, endedAt: 5, recap: { text: 'Old', sceneIds: ['scene-1'], writtenAt: 5 } },
      { id: 'c2', number: 2, title: 'Low Tide', startedAt: 5 },
    ] }
    const inTwo = { ...source, id: 's2', storyId: 'story-1', chapterId: 'c2' }
    const fixed = planChapterEdit(inTwo, [], story, { chapterId: 'chapter-1', recap: { text: 'New', openThreads: ['A'] } }, 1000, ids())
    expect((fixed.story.chapters as { recap?: unknown }[])[0].recap).toEqual({ text: 'New', openThreads: ['A'], sceneIds: ['scene-1'], writtenAt: 5 })
    expect(fixed.sourcePatch).toEqual({})
    expect(story.chapters[0].recap?.text).toBe('Old')
    const cleared = planChapterEdit(inTwo, [], story, { title: '' }, 1000, ids())
    expect((cleared.story.chapters as Record<string, unknown>[])[1]).not.toHaveProperty('title')
    expect(() => planChapterEdit(inTwo, [], story, { recap: { text: 'x' } }, 1000, ids())).toThrow(/when it ends/)
    expect(() => planChapterEdit(inTwo, [], story, { chapterId: 'nope', title: 'x' }, 1000, ids())).toThrow(/not part of this story/)
  })
})

describe('planNextScene with a new lead', () => {
  it('opens the next scene with the new lead, who takes over the lead\'s place and track', () => {
    const plan = planNextScene({ ...source, participantRelationships: { ally: { affection: 30 } } }, [], undefined,
      { recap, next: { presentIds: ['ally', 'rival'], leadId: 'ally' } }, 1000, ids())
    expect(plan.newChat).toMatchObject({ characterId: 'ally', affection: 30, participants: ['rival'], participantRelationships: { lead: { affection: 12, relationshipStats: { trust: 3 } } } })
    expect((plan.newChat.scene as { presentCharacterIds: string[] }).presentCharacterIds).toEqual(['ally', 'rival'])
    expect(plan.sourcePatch).not.toHaveProperty('characterId')
  })

  it('keeps the old lead along when they are picked to be there', () => {
    const plan = planNextScene(source, [], undefined, { recap, next: { presentIds: ['ally', 'lead'], leadId: 'ally' } }, 1000, ids())
    expect(plan.newChat).toMatchObject({ characterId: 'ally', participants: ['rival', 'lead'] })
  })

  it('refuses the played card as the lead', () => {
    expect(() => planNextScene(source, [], undefined, { recap, next: { leadId: 'hero' } }, 1000, ids())).toThrow(StoryPlanError)
  })
})

describe('deleting one scene', () => {
  const s1 = { id: 's1', storyId: 'st', sceneNumber: 1, chapterId: 'chapter-1', chapterSceneNumber: 1, endedAt: 10, recap: { text: 'One.' } }
  const s2 = { id: 's2', storyId: 'st', sceneNumber: 2, chapterId: 'chapter-1', chapterSceneNumber: 2, previousSceneId: 's1', endedAt: 20, recap: { text: 'Two.' } }
  const s3 = { id: 's3', storyId: 'st', sceneNumber: 3, chapterId: 'chapter-1', chapterSceneNumber: 3, previousSceneId: 's2', setEventsDone: ['bind-emily'], carriedConsequences: ['Rend is strained.', 'The gate is sealed.'] }
  const scenes = [s1, s2, s3]
  const s2Messages = [{ gm: { adjudication: { setEventId: 'bind-emily' }, proposals: [{ scope: 'branch', status: 'confirmed', text: 'Rend is strained.' }] } }]
  /** The scenes as the server leaves them after a plan: patches merged, cleared fields gone. */
  const apply = (all: Record<string, unknown>[], plan: { scenePatches: Record<string, Record<string, unknown>> }, id: string, sourcePatch: Record<string, unknown>) =>
    all.map((s) => JSON.parse(JSON.stringify({ ...s, ...(plan.scenePatches[s.id as string] ?? {}), ...(s.id === id ? sourcePatch : {}) })))

  it('takes a deleted scene\'s consequence audience off later scenes and puts it back on restore', () => {
    const s3Heard = { ...s3, consequenceAudience: { 'Rend is strained.': ['lead'], 'The gate is sealed.': ['ally'] } }
    const all = [s1, s2, s3Heard]
    const plan = planSceneRemoval(s2, all, undefined, s2Messages, 500)
    expect(plan.scenePatches.s3.consequenceAudience).toEqual({ 'The gate is sealed.': ['ally'] })
    const after = apply(all, plan, 's2', plan.sourcePatch)
    const back = planSceneRestore(after.find((s) => s.id === 's2'), after, undefined, 0, 600)
    expect(back.scenePatches.s3.consequenceAudience).toEqual({ 'The gate is sealed.': ['ally'], 'Rend is strained.': ['lead'] })
  })

  it('closes the gap around a middle scene and takes back what happened only in it', () => {
    const plan = planSceneRemoval(s2, scenes, undefined, s2Messages, 500)
    expect(plan.scenePatches.s3).toEqual({ previousSceneId: 's1', sceneNumber: 2, chapterSceneNumber: 2, setEventsDone: undefined, carriedConsequences: ['The gate is sealed.'] })
    expect(plan.scenePatches.s1).toBeUndefined()
    expect(plan.openSceneId).toBe('s3')
    expect(plan.sourcePatch).toMatchObject({ deletedAt: 500, sceneRemoval: { previousSceneId: 's1', relinked: ['s3'], events: ['bind-emily'], consequences: ['Rend is strained.'] } })

    // Restoring puts it all back.
    const after = apply(scenes, plan, 's2', plan.sourcePatch)
    const back = planSceneRestore(after.find((s) => s.id === 's2'), after, undefined, 0, 600)
    expect(back.scenePatches.s3).toEqual({ previousSceneId: 's2', sceneNumber: 3, chapterSceneNumber: 3, setEventsDone: ['bind-emily'], carriedConsequences: ['The gate is sealed.', 'Rend is strained.'] })
    expect(back.sourcePatch).toEqual({ deletedAt: undefined, sceneRemoval: undefined, updatedAt: 600 })
  })

  it('opens the scene before again when the story stood at the deleted one, and its chapter goes with it', () => {
    const chapters = [{ id: 'chapter-1', number: 1, endedAt: 15, recap: { text: 'The first chapter.', sceneIds: ['s1', 's2'], writtenAt: 15 } }, { id: 'chapter-2', number: 2, startedAt: 20 }]
    const tip = { ...s3, chapterId: 'chapter-2', chapterSceneNumber: 1 }
    const plan = planSceneRemoval(tip, [s1, s2, tip], { id: 'st', chapters }, [], 500)
    expect(plan.openSceneId).toBe('s2')
    expect(plan.scenePatches.s2).toEqual({ endedAt: undefined, recap: undefined })
    expect(plan.storyPatch?.chapters).toEqual([{ id: 'chapter-1', number: 1 }])

    const after = apply([s1, s2, tip], plan, 's3', plan.sourcePatch)
    const story = { id: 'st', chapters: plan.storyPatch!.chapters }
    // Played on since: it can't go back in its place.
    expect(() => planSceneRestore(after.find((s) => s.id === 's3'), after, story, 1, 600)).toThrow(/moved on/)
    const back = planSceneRestore(after.find((s) => s.id === 's3'), after, story, 0, 600)
    expect(back.scenePatches.s2).toEqual({ endedAt: 20, recap: { text: 'Two.' } })
    expect(back.storyPatch?.chapters).toEqual(chapters)
  })

  it('refuses to delete a story\'s only scene, or a chat outside a story', () => {
    expect(() => planSceneRemoval(s1, [s1], undefined, [], 500)).toThrow(/only scene/)
    expect(() => planSceneRemoval({ id: 'lone' }, [], undefined, [], 500)).toThrow(/not a scene/)
  })
})
