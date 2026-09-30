import { describe, expect, it } from 'vitest'
import type { Chat } from '@/lib/types'
import { recapsVisibleTo, sceneChain, sceneLabel, storyRecapBlock } from './recaps'

const scene = (id: string, n: number, prev: string | undefined, text: string, presentIds: string[], extra: Partial<Chat> = {}) =>
  ({ id, sceneNumber: n, previousSceneId: prev, recap: { text, presentIds, writtenAt: n }, ...extra }) as Chat

// 1 → 2 → 3 on the main line, and 2 → 4 split off in parallel.
const s1 = scene('s1', 1, undefined, 'The guild met.', ['lead', 'ally'], { sceneTitle: 'The guildhall', recap: { text: 'The guild met.', presentIds: ['lead', 'ally'], location: 'Guildhall', writtenAt: 1 } })
const s2 = scene('s2', 2, 's1', 'The lead went alone to the docks.', ['lead'])
const s3 = scene('s3', 3, 's2', 'A letter arrived.', ['lead', 'ally'], { recap: { text: 'A letter arrived.', presentIds: ['lead', 'ally'], openThreads: ['Who sent it?'], writtenAt: 3 } })
const s4 = scene('s4', 4, 's2', 'The ally searched the archive.', ['ally'])
const all = [s1, s2, s3, s4]

describe('sceneChain', () => {
  it('follows previousSceneId back, oldest first', () => {
    expect(sceneChain(all, { id: 'next', previousSceneId: 's3' }).map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('gives a parallel storyline only the scenes before its split', () => {
    expect(sceneChain(all, { id: 'next', previousSceneId: 's4' }).map((s) => s.id)).toEqual(['s1', 's2', 's4'])
  })

  it('stops at a missing link or a loop', () => {
    expect(sceneChain([scene('a', 2, 'gone', 'x', [])], { id: 'b', previousSceneId: 'a' }).map((s) => s.id)).toEqual(['a'])
    const loopA = scene('a', 1, 'b', 'x', [])
    const loopB = scene('b', 2, 'a', 'y', [])
    expect(sceneChain([loopA, loopB], { id: 'c', previousSceneId: 'b' }).map((s) => s.id)).toEqual(['a', 'b'])
  })
})

describe('recapsVisibleTo', () => {
  const chain = sceneChain(all, { id: 'next', previousSceneId: 's3' })
  it('only shows a character the scenes they were in', () => {
    expect(recapsVisibleTo(chain, { characterId: 'ally' }).map((s) => s.id)).toEqual(['s1', 's3'])
    expect(recapsVisibleTo(chain, { characterId: 'stranger' })).toEqual([])
  })

  it('shows the narrator everything', () => {
    expect(recapsVisibleTo(chain, 'narrator').map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })
})

describe('storyRecapBlock', () => {
  const chain = sceneChain(all, { id: 'next', previousSceneId: 's3' })
  const words = (t: string) => t.split(/\s+/).filter(Boolean).length

  it("frames the block from the speaker's side and carries the latest open threads", () => {
    const text = storyRecapBlock(chain, { characterId: 'ally' }, { maxTokens: 500, speakerName: 'Ally' })
    expect(text).toContain('that Ally was there for')
    expect(text).toContain('Scene 1 · The guildhall (Guildhall): The guild met.')
    expect(text).toContain('Scene 3: A letter arrived.')
    expect(text).not.toContain('docks')
    expect(text).toContain('Still unresolved: Who sent it?')
  })

  it('drops the oldest scenes first and says so, but always keeps the latest', () => {
    const text = storyRecapBlock(chain, 'narrator', { maxTokens: 14, estimate: words })
    expect(text).toContain('A letter arrived.')
    expect(text).toMatch(/\(\d earlier scenes? not shown\.\)/)
    expect(text).not.toContain('The guild met.')
    const tiny = storyRecapBlock(chain, 'narrator', { maxTokens: 1, estimate: words })
    expect(tiny).toContain('A letter arrived.')
  })

  it('is empty when the viewer knows nothing', () => {
    expect(storyRecapBlock(chain, { characterId: 'stranger' }, { maxTokens: 500 })).toBe('')
    expect(storyRecapBlock([], 'narrator', { maxTokens: 500 })).toBe('')
  })
})

describe('storyRecapBlock with chapters', () => {
  const r = (text: string, presentIds: string[] = ['bea'], openThreads?: string[]) => ({ text, presentIds, writtenAt: 1, ...(openThreads ? { openThreads } : {}) })
  const chapters = [
    { id: 'chapter-1', number: 1, title: 'The Fog', startedAt: 1, endedAt: 3, recap: { text: 'They crossed the coast and lost the ferry.', openThreads: ['Where is the ferry?'], sceneIds: ['s1', 's2'], writtenAt: 3 } },
    { id: 'c2', number: 2, title: 'Low Tide', startedAt: 3 },
  ]
  const s1 = { id: 's1', sceneNumber: 1, recap: r('They met at the dock.') }
  const s2 = { id: 's2', sceneNumber: 2, previousSceneId: 's1', recap: r('The ferry never came.', ['cole']) }
  const s3 = { id: 's3', sceneNumber: 3, chapterId: 'c2', chapterSceneNumber: 1, previousSceneId: 's2', recap: r('They searched the flats.', ['bea'], ['The bell rang once.']) }

  it('gives the narrator an ended chapter as its recap, and the current chapter scene by scene', () => {
    const block = storyRecapBlock([s1, s2, s3], 'narrator', { maxTokens: 1000, chapters })
    expect(block).toBe([
      'Earlier scenes in this story:',
      'Chapter 1 · The Fog (the whole chapter): They crossed the coast and lost the ferry.',
      'Chapter 2, Scene 1: They searched the flats.',
      'Still unresolved: The bell rang once.',
    ].join('\n'))
  })

  it('keeps scene recaps for a branch the chapter recap did not cover', () => {
    const other = { id: 's2b', sceneNumber: 2, previousSceneId: 's1', recap: r('They took the cliff road instead.') }
    const block = storyRecapBlock([s1, other], 'narrator', { maxTokens: 1000, chapters })
    expect(block).toContain('Chapter 1 · The Fog (the whole chapter)')
    expect(block).toContain('Chapter 1, Scene 2: They took the cliff road instead.')
  })

  it('tells a character only the scenes they were in, labelled by chapter, never the chapter recap', () => {
    const block = storyRecapBlock([s1, s2, s3], { characterId: 'bea' }, { maxTokens: 1000, chapters, speakerName: 'Bea' })
    expect(block).toContain('Chapter 1, Scene 1: They met at the dock.')
    expect(block).toContain('Chapter 2, Scene 1: They searched the flats.')
    expect(block).not.toContain('ferry')
  })

  it('reads the same as before for a story without chapters', () => {
    expect(storyRecapBlock([s1], 'narrator', { maxTokens: 1000 })).toBe(storyRecapBlock([s1], 'narrator', { maxTokens: 1000, chapters: [{ id: 'chapter-1', number: 1, startedAt: 1 }] }))
    expect(sceneLabel({ sceneNumber: 5, chapterSceneNumber: 2, sceneTitle: 'The flats' })).toBe('Scene 2 · The flats')
    expect(sceneLabel({ sceneNumber: 5 })).toBe('Scene 5')
  })
})
