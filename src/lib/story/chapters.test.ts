import { describe, expect, it } from 'vitest'
import type { Chapter, Chat } from '@/lib/types'
import {
  FIRST_CHAPTER_ID,
  chapterBriefing,
  chapterIdOf,
  chapterLabel,
  chapterLine,
  chapterSceneLabel,
  chaptersOf,
  nextSceneNumberIn,
  sceneNumberInChapter,
  scenesOfChapter,
} from './chapters'

const scene = (id: string, n: number, extra: Partial<Chat> = {}) => ({ id, sceneNumber: n, createdAt: n * 10, ...extra }) as Chat

describe('stories from before chapters', () => {
  // Three scenes with no chapter fields at all, as every story made before chapters.
  const legacy = [scene('s1', 1), scene('s2', 2, { previousSceneId: 's1' }), scene('s3', 3, { previousSceneId: 's2' })]

  it('read as one first chapter holding every scene, in order', () => {
    const chapters = chaptersOf(undefined, legacy)
    expect(chapters).toEqual([{ id: FIRST_CHAPTER_ID, number: 1, startedAt: 10 }])
    expect(scenesOfChapter(legacy, FIRST_CHAPTER_ID).map((s) => s.id)).toEqual(['s1', 's2', 's3'])
    expect(chaptersOf({ chapters: [] }, legacy)).toHaveLength(1)
  })

  it('keep their scene numbers', () => {
    expect(legacy.map(sceneNumberInChapter)).toEqual([1, 2, 3])
    expect(chapterSceneLabel(chaptersOf(undefined, legacy), legacy[2])).toBe('Chapter 1 · Scene 3')
    expect(nextSceneNumberIn(legacy, FIRST_CHAPTER_ID)).toBe(4)
  })

  it('tell the GM nothing about chapters until one is named', () => {
    expect(chapterBriefing(chaptersOf(undefined, legacy), legacy[2])).toBe('')
  })
})

describe('chapters', () => {
  const chapters: Chapter[] = [
    { id: FIRST_CHAPTER_ID, number: 1, title: 'The Fog', startedAt: 1, endedAt: 50, recap: { text: 'The ferry sank.', openThreads: ['Who cut the rope?'], sceneIds: ['s1', 's2'], writtenAt: 50 } },
    { id: 'c2', number: 2, title: 'Low Tide', goal: 'Find the bell before the tide turns.', startedAt: 50 },
  ]
  const scenes = [
    scene('s1', 1), scene('s2', 2, { previousSceneId: 's1' }),
    scene('s3', 3, { chapterId: 'c2', chapterSceneNumber: 1, previousSceneId: 's2' }),
    scene('s4', 4, { chapterId: 'c2', chapterSceneNumber: 2, previousSceneId: 's3' }),
    // A parallel storyline that split off in chapter 2.
    scene('s5', 5, { chapterId: 'c2', chapterSceneNumber: 3, previousSceneId: 's3', storylineId: 'north' }),
  ]

  it('number scenes within their chapter', () => {
    expect(chapterIdOf(scenes[2])).toBe('c2')
    expect(scenesOfChapter(scenes, 'c2').map(sceneNumberInChapter)).toEqual([1, 2, 3])
    expect(chapterSceneLabel(chapters, scenes[3])).toBe('Chapter 2 · Scene 2')
    expect(chapterLabel(chapters[1])).toBe('Chapter 2 · Low Tide')
    expect(chapterLabel({ number: 3 })).toBe('Chapter 3')
    expect(nextSceneNumberIn(scenes, 'c2')).toBe(4)
  })

  it('follow one line of play within a chapter, not another branch\'s', () => {
    expect(chapterLine(scenes, scenes[3]).map((s) => s.id)).toEqual(['s3', 's4'])
    expect(chapterLine(scenes, scenes[4]).map((s) => s.id)).toEqual(['s3', 's5'])
    expect(chapterLine(scenes, scenes[1]).map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('never leave a scene without a chapter, even one the story lost', () => {
    const odd = [...scenes, scene('s6', 6, { chapterId: 'gone' })]
    expect(chaptersOf({ chapters }, odd).map((c) => [c.id, c.number])).toEqual([[FIRST_CHAPTER_ID, 1], ['c2', 2], ['gone', 3]])
  })

  it('brief the GM on the chapter, how the last one ended, and what it left open', () => {
    expect(chapterBriefing(chapters, scenes[3])).toBe([
      'Current chapter: Chapter 2 · Low Tide. Its goal: Find the bell before the tide turns.',
      'How Chapter 1 · The Fog ended: The ferry sank.',
      'Left open by the last chapter: Who cut the rope?',
    ].join('\n'))
  })
})
