import { describe, expect, it } from 'vitest'
import type { CharacterMemory } from '../src/lib/types.ts'
import {
  forkTellings,
  memoryAsSeenFrom,
  nextWatermark,
  MEMORY_TEXT_MAX,
  computeKnownBy,
  consolidateFor,
  forkMemories,
  normalizeMemoryInput,
  normalizeMemoryPatch,
  presenceOf,
  retractMessage,
  sceneChainIds,
  shareMemory,
  type ChatLike,
  type StoryLike,
} from './memoryPlan.ts'

const NOW = 5000

function lookup<T>(rows: Record<string, T>) {
  return (id: string) => rows[id]
}

function mem(over: Partial<CharacterMemory> & { id: string }): CharacterMemory {
  return {
    chatId: 'scene-1',
    text: 'Ash broke the ward on the east gate.',
    kind: 'event',
    witnesses: ['ash', 'bea'],
    knownBy: ['ash', 'bea'],
    importance: 0.5,
    active: true,
    origin: 'scribe',
    createdAt: 100,
    ...over,
  }
}

const ids = () => {
  let n = 0
  return () => `new-${++n}`
}

describe('sceneChainIds', () => {
  const chats: Record<string, ChatLike> = {
    's1': { storyId: 'story-a' },
    's2': { storyId: 'story-a', previousSceneId: 's1' },
    's3': { storyId: 'story-a', previousSceneId: 's2' },
    // A parallel storyline split off after s1.
    's3b': { storyId: 'story-a', previousSceneId: 's1' },
    // A sequel story whose first scene follows on from s2.
    'b1': { storyId: 'story-b' },
    'b2': { storyId: 'story-b', previousSceneId: 'b1' },
    // An unrelated story.
    'c1': { storyId: 'story-c' },
    'lone': {},
  }
  const stories: Record<string, StoryLike> = {
    'story-a': {},
    'story-b': { continuesFrom: { storyId: 'story-a', sceneId: 's2' } },
    'story-c': {},
  }
  const chain = (id: string) => sceneChainIds(id, lookup(chats), lookup(stories))

  it('walks previousSceneId back to the first scene, current first', () => {
    expect(chain('s3')).toEqual(['s3', 's2', 's1'])
    expect(chain('s1')).toEqual(['s1'])
  })

  it('keeps parallel storylines apart after the split', () => {
    expect(chain('s3b')).toEqual(['s3b', 's1'])
  })

  it("continues into a sequel's continuesFrom scene, and stops there", () => {
    expect(chain('b2')).toEqual(['b2', 'b1', 's2', 's1'])
  })

  it('never crosses into an unrelated story', () => {
    expect(chain('c1')).toEqual(['c1'])
    expect(chain('lone')).toEqual(['lone'])
  })

  it('returns nothing for a missing chat and stops at a missing ancestor', () => {
    expect(chain('nope')).toEqual([])
    const withGap: Record<string, ChatLike> = { x2: { previousSceneId: 'gone' } }
    expect(sceneChainIds('x2', lookup(withGap), lookup(stories))).toEqual(['x2'])
  })

  it("falls back to the story's continuesFrom when the previous scene is gone", () => {
    const withGap: Record<string, ChatLike> = { ...chats, b3: { storyId: 'story-b', previousSceneId: 'purged' } }
    expect(sceneChainIds('b3', lookup(withGap), lookup(stories))).toEqual(['b3', 's2', 's1'])
  })

  it('cuts a previousSceneId cycle', () => {
    const loop: Record<string, ChatLike> = { p: { previousSceneId: 'q' }, q: { previousSceneId: 'p' } }
    expect(sceneChainIds('p', lookup(loop), lookup(stories))).toEqual(['p', 'q'])
  })

  it('cuts a continuesFrom cycle between two stories', () => {
    const loopChats: Record<string, ChatLike> = { a1: { storyId: 'A' }, b1: { storyId: 'B' } }
    const loopStories: Record<string, StoryLike> = {
      A: { continuesFrom: { storyId: 'B', sceneId: 'b1' } },
      B: { continuesFrom: { storyId: 'A', sceneId: 'a1' } },
    }
    expect(sceneChainIds('a1', lookup(loopChats), lookup(loopStories))).toEqual(['a1', 'b1'])
  })

  it('ignores a malformed continuesFrom', () => {
    const odd: Record<string, StoryLike> = { 'story-b': { continuesFrom: 'story-a' } }
    expect(sceneChainIds('b1', lookup(chats), lookup(odd))).toEqual(['b1'])
  })
})

describe('normalizeMemoryInput', () => {
  const base = { chatId: 'scene-1', text: '  Bea promised to return the lamp.  ', witnesses: ['bea', 'ash'] }

  it('fills defaults, trims, and computes knownBy', () => {
    const m = normalizeMemoryInput(base, NOW)
    expect(m).toEqual({
      chatId: 'scene-1',
      text: 'Bea promised to return the lamp.',
      kind: 'event',
      witnesses: ['bea', 'ash'],
      knownBy: ['bea', 'ash'],
      importance: 0.5,
      active: true,
      origin: 'manual',
      createdAt: NOW,
    })
  })

  it('rejects missing text, overlong text, no witnesses, no chatId, bad kind and bad origin', () => {
    expect(normalizeMemoryInput({ ...base, text: '   ' }, NOW)).toHaveProperty('error')
    expect(normalizeMemoryInput({ ...base, text: 'x'.repeat(MEMORY_TEXT_MAX + 1) }, NOW)).toHaveProperty('error')
    expect(normalizeMemoryInput({ ...base, text: 'x'.repeat(MEMORY_TEXT_MAX) }, NOW)).not.toHaveProperty('error')
    expect(normalizeMemoryInput({ ...base, witnesses: ['', '  ', 3] }, NOW)).toHaveProperty('error')
    expect(normalizeMemoryInput({ ...base, chatId: '' }, NOW)).toHaveProperty('error')
    expect(normalizeMemoryInput({ ...base, kind: 'dream' }, NOW)).toHaveProperty('error')
    expect(normalizeMemoryInput({ ...base, origin: 'import' }, NOW)).toHaveProperty('error')
    expect(normalizeMemoryInput(null, NOW)).toHaveProperty('error')
    expect(normalizeMemoryInput([base], NOW)).toHaveProperty('error')
  })

  it('dedupes ids, clamps numbers, keeps only known feelings, and strips unknown fields', () => {
    const m = normalizeMemoryInput(
      {
        ...base,
        kind: 'promise',
        witnesses: ['bea', 'bea', ' ash '],
        about: ['cole', 'cole', ''],
        importance: 7,
        feelings: { bea: 3, ash: -0.25, cole: 1, dan: 'x' },
        toldVia: [{ to: ['cole', 'cole'], by: 'bea', messageId: 'm9', at: 42 }, { to: [] }],
        unresolved: true,
        pinned: 'yes',
        origin: 'scribe',
        sourceMessageId: 'm1',
        storyId: 'story-a',
        id: 'client-id',
        knownBy: ['everyone'],
        active: false,
        secretField: 1,
      },
      NOW,
    )
    expect(m).toEqual({
      chatId: 'scene-1',
      text: 'Bea promised to return the lamp.',
      kind: 'promise',
      witnesses: ['bea', 'ash'],
      toldVia: [{ to: ['cole'], by: 'bea', messageId: 'm9', at: 42 }],
      knownBy: ['bea', 'ash', 'cole'],
      about: ['cole'],
      importance: 1,
      feelings: { bea: 1, ash: -0.25, cole: 1 },
      unresolved: true,
      active: true,
      origin: 'scribe',
      sourceMessageId: 'm1',
      storyId: 'story-a',
      createdAt: NOW,
    })
  })

  it('clamps importance below zero and keeps a given createdAt', () => {
    const m = normalizeMemoryInput({ ...base, importance: -2, createdAt: 77 }, NOW)
    expect(m).toMatchObject({ importance: 0, createdAt: 77 })
  })

  it('keeps how it is known, the ruling, and the canon link', () => {
    const m = normalizeMemoryInput({ ...base, certainty: 'claim', verdict: 'false', canonFactId: ' fact-1 ' }, NOW)
    expect(m).toMatchObject({ certainty: 'claim', verdict: 'false', canonFactId: 'fact-1' })
  })

  it('leaves certainty unset (read as firsthand) when missing or null', () => {
    for (const extra of [{}, { certainty: null, verdict: null, canonFactId: null }]) {
      const m = normalizeMemoryInput({ ...base, ...extra }, NOW)
      expect(m).not.toHaveProperty('error')
      expect(m).not.toHaveProperty('certainty')
      expect(m).not.toHaveProperty('verdict')
      expect(m).not.toHaveProperty('canonFactId')
    }
  })

  it('rejects an unknown certainty or verdict', () => {
    expect(normalizeMemoryInput({ ...base, certainty: 'rumor' }, NOW)).toHaveProperty('error')
    expect(normalizeMemoryInput({ ...base, verdict: true }, NOW)).toHaveProperty('error')
    expect(normalizeMemoryInput({ ...base, canonFactId: 7 }, NOW)).toHaveProperty('error')
  })
})

describe('normalizeMemoryPatch', () => {
  const existing = { knownBy: ['ash', 'bea'] }

  it('takes editable fields and stamps updatedAt', () => {
    const p = normalizeMemoryPatch(
      {
        text: ' Ash lied about the ward. ',
        kind: 'secret',
        about: ['bea', 'bea'],
        importance: 1.5,
        feelings: { ash: -2, cole: 1 },
        unresolved: false,
        pinned: true,
        active: false,
        retiredReason: '  Contradicted later.  ',
        consolidatedFor: ['ash', 'ash', 'cole'],
      },
      existing,
      NOW,
    )
    expect(p).toEqual({
      text: 'Ash lied about the ward.',
      kind: 'secret',
      about: ['bea'],
      importance: 1,
      feelings: { ash: -1 },
      unresolved: false,
      pinned: true,
      active: false,
      retiredReason: 'Contradicted later.',
      consolidatedFor: ['ash'],
      updatedAt: NOW,
    })
  })

  it('ignores who-knows fields and where the memory lives', () => {
    const p = normalizeMemoryPatch({ witnesses: ['cole'], knownBy: ['cole'], toldVia: [], chatId: 'x', sourceMessageId: 'm' }, existing, NOW)
    expect(p).toEqual({ updatedAt: NOW })
  })

  it('clears with null', () => {
    const p = normalizeMemoryPatch({ retiredReason: null, about: null, feelings: null, consolidatedFor: null }, existing, NOW)
    expect(p).toEqual({ retiredReason: undefined, about: undefined, feelings: undefined, consolidatedFor: undefined, updatedAt: NOW })
  })

  it('rejects bad values', () => {
    expect(normalizeMemoryPatch({ text: '' }, existing, NOW)).toHaveProperty('error')
    expect(normalizeMemoryPatch({ text: 'x'.repeat(MEMORY_TEXT_MAX + 1) }, existing, NOW)).toHaveProperty('error')
    expect(normalizeMemoryPatch({ kind: 'dream' }, existing, NOW)).toHaveProperty('error')
    expect(normalizeMemoryPatch({ importance: 'high' }, existing, NOW)).toHaveProperty('error')
    expect(normalizeMemoryPatch({ pinned: 'true' }, existing, NOW)).toHaveProperty('error')
    expect(normalizeMemoryPatch('text', existing, NOW)).toHaveProperty('error')
    expect(normalizeMemoryPatch({ certainty: 'hearsay' }, existing, NOW)).toHaveProperty('error')
    expect(normalizeMemoryPatch({ verdict: 'maybe' }, existing, NOW)).toHaveProperty('error')
    expect(normalizeMemoryPatch({ canonFactId: {} }, existing, NOW)).toHaveProperty('error')
  })

  it('records a ruling and a promotion to canon', () => {
    expect(normalizeMemoryPatch({ certainty: 'belief', verdict: 'true', canonFactId: 'fact-1' }, existing, NOW))
      .toEqual({ certainty: 'belief', verdict: 'true', canonFactId: 'fact-1', updatedAt: NOW })
  })

  it('clears a ruling with null, and leaves it alone when not mentioned', () => {
    expect(normalizeMemoryPatch({ verdict: null, canonFactId: null }, existing, NOW))
      .toEqual({ verdict: undefined, canonFactId: undefined, updatedAt: NOW })
    expect(normalizeMemoryPatch({ text: 'Bea said the bridge is out.' }, existing, NOW)).not.toHaveProperty('verdict')
  })
})

describe('shareMemory', () => {
  it('adds a telling for the ids who did not know, and recomputes knownBy', () => {
    const m = mem({ id: 'a' })
    const shared = shareMemory(m, { to: ['bea', 'cole', 'cole', ''], by: 'ash', messageId: 'm5' }, NOW)
    expect(shared.toldVia).toEqual([{ to: ['cole'], by: 'ash', messageId: 'm5', at: NOW }])
    expect(shared.knownBy).toEqual(['ash', 'bea', 'cole'])
    expect(shared.updatedAt).toBe(NOW)
    expect(m.knownBy).toEqual(['ash', 'bea'])
  })

  it('is a no-op (same reference) when everyone already knows', () => {
    const m = mem({ id: 'a', toldVia: [{ to: ['cole'], at: 1 }], knownBy: ['ash', 'bea', 'cole'] })
    expect(shareMemory(m, { to: ['cole', 'ash'] }, NOW)).toBe(m)
    expect(shareMemory(m, { to: [] }, NOW)).toBe(m)
  })

  it('appends to earlier tellings', () => {
    const m = mem({ id: 'a', toldVia: [{ to: ['cole'], at: 1 }], knownBy: ['ash', 'bea', 'cole'] })
    const shared = shareMemory(m, { to: ['dee'] }, NOW)
    expect(shared.toldVia).toEqual([{ to: ['cole'], at: 1 }, { to: ['dee'], at: NOW }])
    expect(shared.knownBy).toEqual(['ash', 'bea', 'cole', 'dee'])
  })
})

describe('computeKnownBy', () => {
  it('is witnesses then told ids, without repeats', () => {
    expect(computeKnownBy(['ash'], [{ to: ['bea', 'ash'], at: 1 }, { to: ['cole', 'bea'], at: 2 }])).toEqual(['ash', 'bea', 'cole'])
    expect(computeKnownBy(['ash'], undefined)).toEqual(['ash'])
  })
})

describe('retractMessage', () => {
  it('removes memories from the message and undoes tellings in it', () => {
    const memories = [
      mem({ id: 'from-it', sourceMessageId: 'm1' }),
      mem({ id: 'other', sourceMessageId: 'm2' }),
      mem({
        id: 'told',
        sourceMessageId: 'm0',
        toldVia: [{ to: ['cole'], by: 'ash', messageId: 'm1', at: 1 }, { to: ['dee'], messageId: 'm3', at: 2 }],
        knownBy: ['ash', 'bea', 'cole', 'dee'],
        feelings: { ash: 0.5, cole: -0.5 },
        consolidatedFor: ['cole', 'bea'],
      }),
      mem({ id: 'told-only-there', toldVia: [{ to: ['cole'], messageId: 'm1', at: 1 }], knownBy: ['ash', 'bea', 'cole'] }),
    ]
    const plan = retractMessage(memories, 'm1')
    expect(plan.remove).toEqual(['from-it'])
    expect(plan.update).toEqual([
      {
        id: 'told',
        patch: {
          toldVia: [{ to: ['dee'], messageId: 'm3', at: 2 }],
          knownBy: ['ash', 'bea', 'dee'],
          feelings: { ash: 0.5 },
          consolidatedFor: ['bea'],
        },
      },
      { id: 'told-only-there', patch: { toldVia: undefined, knownBy: ['ash', 'bea'], feelings: undefined, consolidatedFor: undefined } },
    ])
  })

  it('does nothing for an unrelated or empty message id', () => {
    const memories = [mem({ id: 'a', sourceMessageId: 'm1' })]
    expect(retractMessage(memories, 'm9')).toEqual({ remove: [], update: [] })
    expect(retractMessage(memories, '')).toEqual({ remove: [], update: [] })
  })
})

describe('forkMemories', () => {
  const idMap = new Map([
    ['m1', 'f1'],
    ['m2', 'f2'],
  ])

  it('keeps memories from copied messages, remapped, with new ids in the new chat', () => {
    const rows = forkMemories(
      [mem({ id: 'a', sourceMessageId: 'm1', createdAt: 900 }), mem({ id: 'b', sourceMessageId: 'm3', createdAt: 150 })],
      idMap,
      200,
      'fork',
      ids(),
    )
    expect(rows).toEqual([mem({ id: 'new-1', chatId: 'fork', sourceMessageId: 'f1', createdAt: 900 })])
  })

  it('carries a rumor learned before the fork point with its ruling, and not one heard later on the other branch', () => {
    const rows = forkMemories(
      [
        mem({ id: 'early', sourceMessageId: 'm1', certainty: 'claim', verdict: 'false', text: 'Cole said the bridge is out.' }),
        mem({ id: 'later', sourceMessageId: 'm3', certainty: 'claim', text: 'Bea said the mayor fled.' }),
      ],
      idMap,
      200,
      'fork',
      ids(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ chatId: 'fork', certainty: 'claim', verdict: 'false', text: 'Cole said the bridge is out.' })
  })

  it('keeps sourceless memories by the cutoff (all when there is none)', () => {
    const src = [mem({ id: 'early', createdAt: 150 }), mem({ id: 'late', createdAt: 250 })]
    expect(forkMemories(src, idMap, 200, 'fork', ids()).map((r) => r.createdAt)).toEqual([150])
    expect(forkMemories(src, idMap, undefined, 'fork', ids())).toHaveLength(2)
  })

  it('remaps tellings in copied messages and drops the rest, pruning knownBy, feelings and consolidatedFor', () => {
    const [row] = forkMemories(
      [
        mem({
          id: 'a',
          sourceMessageId: 'm1',
          toldVia: [
            { to: ['cole'], by: 'ash', messageId: 'm2', at: 150 },
            { to: ['dee'], messageId: 'm7', at: 160 },
            { to: ['eve'], at: 150 },
            { to: ['fay'], at: 300 },
          ],
          knownBy: ['ash', 'bea', 'cole', 'dee', 'eve', 'fay'],
          feelings: { cole: 0.2, dee: -0.3 },
          consolidatedFor: ['dee', 'ash'],
        }),
      ],
      idMap,
      200,
      'fork',
      ids(),
    )
    expect(row.toldVia).toEqual([
      { to: ['cole'], by: 'ash', messageId: 'f2', at: 150 },
      { to: ['eve'], at: 150 },
    ])
    expect(row.knownBy).toEqual(['ash', 'bea', 'cole', 'eve'])
    expect(row.feelings).toEqual({ cole: 0.2 })
    expect(row.consolidatedFor).toEqual(['ash'])
    expect(row.id).toBe('new-1')
  })

  it('omits empty toldVia/feelings rather than keeping empty values', () => {
    const [row] = forkMemories(
      [mem({ id: 'a', sourceMessageId: 'm1', toldVia: [{ to: ['dee'], messageId: 'm7', at: 1 }], knownBy: ['ash', 'bea', 'dee'], feelings: { dee: 1 } })],
      idMap,
      200,
      'fork',
      ids(),
    )
    expect(row).not.toHaveProperty('toldVia')
    expect(row).not.toHaveProperty('feelings')
    expect(row.knownBy).toEqual(['ash', 'bea'])
  })
})

describe('consolidateFor', () => {
  it('adds a knower once, and skips anyone who does not know it', () => {
    const m = mem({ id: 'a' })
    expect(consolidateFor(m, 'ash', NOW)).toEqual({ consolidatedFor: ['ash'], updatedAt: NOW })
    expect(consolidateFor({ ...m, consolidatedFor: ['ash'] }, 'bea', NOW)).toEqual({ consolidatedFor: ['ash', 'bea'], updatedAt: NOW })
    expect(consolidateFor({ ...m, consolidatedFor: ['ash'] }, 'ash', NOW)).toBeNull()
    expect(consolidateFor(m, 'cole', NOW)).toBeNull()
    expect(consolidateFor(m, '', NOW)).toBeNull()
  })
})

describe('presenceOf', () => {
  it("uses the scene's present cast plus the player", () => {
    expect(presenceOf({ characterId: 'ash', participants: ['bea'], playerCharacterId: 'cole', scene: { presentCharacterIds: ['bea', 'dee', 'bea'] } }))
      .toEqual(['bea', 'dee', 'cole'])
  })

  it('falls back to the lead and participants without a present cast', () => {
    expect(presenceOf({ characterId: 'ash', participants: ['bea', 'ash'], playerCharacterId: 'cole', scene: { turnPolicy: 'manual' } }))
      .toEqual(['ash', 'bea', 'cole'])
    expect(presenceOf({ characterId: 'ash' })).toEqual(['ash'])
  })

  it('keeps an empty present cast empty apart from the player', () => {
    expect(presenceOf({ characterId: 'ash', playerCharacterId: 'cole', scene: { presentCharacterIds: [] } })).toEqual(['cole'])
    expect(presenceOf({ characterId: 'ash', scene: { presentCharacterIds: [] } })).toEqual([])
  })
})

describe('tellings scoped by scene', () => {
  const base = {
    id: 'm1', chatId: 's1', text: 'Ash hid the key.', kind: 'secret' as const, witnesses: ['ash'], knownBy: ['ash', 'bea', 'cole'],
    importance: 0.8, active: true, origin: 'scribe' as const, createdAt: 1,
    toldVia: [{ to: ['bea'], chatId: 's2', at: 2 }, { to: ['cole'], at: 3 }],
  }

  it('drops tellings from scenes outside the chain, keeps scene-less ones', () => {
    const seen = memoryAsSeenFrom(base, new Set(['s3', 's1']))
    expect(seen.knownBy).toEqual(['ash', 'cole'])
    expect(seen.toldVia).toEqual([{ to: ['cole'], at: 3 }])
  })

  it('leaves a memory untouched when every telling is in view', () => {
    expect(memoryAsSeenFrom(base, new Set(['s2', 's1']))).toBe(base)
  })

  it('records a forked chat\'s tellings of earlier memories for the fork', () => {
    const told = { ...base, toldVia: [{ to: ['bea'], chatId: 's2', messageId: 'old', at: 2 }, { to: ['cole'], chatId: 's2', messageId: 'gone', at: 3 }] }
    const out = forkTellings([told], 's2', new Map([['old', 'new']]), 's2f')
    expect(out).toEqual([{ id: 'm1', toldVia: [...told.toldVia, { to: ['bea'], chatId: 's2f', messageId: 'new', at: 2 }] }])
  })
})

describe('nextWatermark', () => {
  it('advances when nothing moved it meanwhile', () => {
    expect(nextWatermark(10, 20, 10)).toBe(20)
    expect(nextWatermark(undefined, 20, null)).toBe(20)
  })
  it('keeps a rollback made during the run', () => {
    expect(nextWatermark(5, 20, 10)).toBe(5)
  })
  it('accepts old callers that do not say what they read', () => {
    expect(nextWatermark(5, 20, undefined)).toBe(20)
  })
})


describe('memory location', () => {
  it('keeps only a trimmed, capped, optional location on new memories', () => {
    const raw = { chatId: 'scene', text: 'Brisa crossed the quay.', witnesses: ['brisa'] }
    expect(normalizeMemoryInput({ ...raw, location: '  Ferry Landing  ' }, NOW)).toMatchObject({ location: 'Ferry Landing' })
    expect(normalizeMemoryInput({ ...raw, location: ' x'.repeat(300) }, NOW)).toHaveProperty('location', (' x'.repeat(300)).trim().slice(0, 200))
    for (const location of [undefined, null, '', '   ', 123]) expect(normalizeMemoryInput({ ...raw, location }, NOW)).not.toHaveProperty('location')
  })
})
