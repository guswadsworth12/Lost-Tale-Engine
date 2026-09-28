import { describe, expect, it } from 'vitest'
import type { Chat } from '@/lib/types'
import { recapsVisibleTo, sceneChain, storyRecapBlock } from './recaps'

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
