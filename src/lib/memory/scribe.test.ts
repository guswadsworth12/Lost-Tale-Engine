import { describe, expect, it, vi } from 'vitest'
import { buildScribePrompt, parseScribeResponse, tryParseScribeResponse, commitScribeResponse, type ScribeInput } from './scribe'

const cast = [
  { id: 'ash', name: 'Ash Vale' },
  { id: 'bea', name: 'Bea' },
  { id: 'cole', name: 'Cole' },
  { id: 'dara', name: 'Dara' },
]

function input(over: Partial<ScribeInput> = {}): ScribeInput {
  return {
    worldName: 'Testland',
    playerName: 'Ash Vale',
    playerId: 'ash',
    cast,
    messages: [
      { n: 1, id: 'msg-1', name: 'Ash Vale', text: 'Ash hands Bea the key.', witnessIds: ['ash', 'bea', 'cole'] },
      { n: 2, id: 'msg-2', name: 'Bea', text: 'Bea whispers her real name to Ash.', witnessIds: ['ash', 'bea', 'cole'] },
      { n: 3, id: 'msg-3', name: 'Cole', text: 'Cole tells Dara about the broken ward.', witnessIds: ['cole', 'dara'] },
    ],
    existing: [
      { n: 1, id: 'mem-1', text: 'Cole broke the ward on the east gate.', knownByIds: ['cole', 'ash'] },
      { n: 2, id: 'mem-2', text: 'Bea promised to guard the key.', knownByIds: ['bea', 'ash'], unresolved: true },
      { n: 3, id: 'mem-3', text: 'Dara distrusts Cole.', knownByIds: ['dara'] },
    ],
    ...over,
  }
}

const json = (value: unknown) => JSON.stringify(value)

describe('buildScribePrompt', () => {
  it('asks for attributed commitments, state transitions, and evidence before resolution', () => {
    const prompt = buildScribePrompt(input())
    expect(prompt).toContain('distinguish who asked, permitted, intended, offered, and explicitly committed')
    expect(prompt).toContain('retire obsolete current-state memories')
    expect(prompt).toContain('reassurance is not completion')
    expect(prompt).toContain('Do not invent a routine or elapsed absence')
  })

  it('numbers messages with their witness lists and lists existing memories', () => {
    const prompt = buildScribePrompt(input())
    expect(prompt).toContain('[1] Ash Vale (witnessed by: Ash Vale, Bea, Cole): Ash hands Bea the key.')
    expect(prompt).toContain('[3] Cole (witnessed by: Cole, Dara): Cole tells Dara about the broken ward.')
    expect(prompt).toContain('(1) Cole broke the ward on the east gate. — known by: Cole, Ash Vale')
    expect(prompt).toMatch(/\(2\) Bea promised to guard the key\. — known by: Bea, Ash Vale \[open thread\]/)
    expect(prompt).toContain('Testland')
    expect(prompt).toContain('Reply with only a JSON object')
    expect(prompt).toContain('at most 4')
  })

  it('asks how each memory is known, and to record a rumor as what someone said', () => {
    const prompt = buildScribePrompt(input())
    expect(prompt).toContain('"certainty" is one of: firsthand, claim, belief.')
    expect(prompt).toContain('write it as "X said that ..."')
    expect(prompt).toContain('"certainty":"firsthand"')
  })

  it('honours maxNew and omits the memory section when there is none', () => {
    const prompt = buildScribePrompt(input({ existing: [], maxNew: 2 }))
    expect(prompt).toContain('at most 2')
    expect(prompt).not.toContain('already remember')
    expect(prompt).not.toContain('known by:')
  })
})

describe('parseScribeResponse', () => {
  it('drops a memory nobody was present to witness, instead of sinking the whole batch', () => {
    const lonely = input({ messages: [
      { n: 1, id: 'msg-1', name: 'Ash Vale', text: 'The lamp gutters out.', witnessIds: [] },
      { n: 2, id: 'msg-2', name: 'Bea', text: 'Bea whispers her real name to Ash.', witnessIds: ['ash', 'bea'] },
    ] })
    const result = parseScribeResponse(json({ add: [{ from: 1, text: 'The lamp went out.' }, { from: 2, text: 'Bea told Ash her real name.' }] }), lonely)
    expect(result.add.map((a) => a.messageId)).toEqual(['msg-2'])
  })

  it('reads fenced JSON and maps names to ids', () => {
    const raw =
      '```json\n' +
      json({
        add: [{ from: 1, text: '  Ash gave Bea\n the key. ', kind: 'promise', importance: 0.7, about: ['ash vale', 'Bea'], unresolved: true }],
      }) +
      '\n```'
    const result = parseScribeResponse(raw, input())
    expect(result.add).toEqual([
      {
        messageId: 'msg-1',
        text: 'Ash gave Bea the key.',
        kind: 'promise',
        certainty: 'firsthand',
        importance: 0.7,
        aboutIds: ['ash', 'bea'],
        witnessIds: ['ash', 'bea', 'cole'],
        unresolved: true,
      },
    ])
  })

  it('reads JSON wrapped in prose', () => {
    const raw = `Here is what they will remember:\n${json({ add: [{ from: 2, text: 'Bea told Ash her name.' }] })}\nHope that helps.`
    const result = parseScribeResponse(raw, input())
    expect(result.add).toHaveLength(1)
    expect(result.add[0]).toMatchObject({ messageId: 'msg-2', kind: 'event', importance: 0.5 })
  })

  it('reads how each memory is known, defaulting to firsthand (an impression to belief)', () => {
    const raw = json({
      add: [
        { from: 3, text: 'Cole said that the mayor fled the city.', kind: 'learned', certainty: 'Claim' },
        { from: 1, text: 'Ash handed over the key.', kind: 'event' },
        { from: 2, text: 'Ash suspects Bea is hiding something.', kind: 'impression' },
        { from: 2, text: 'Bea seems frightened of Cole.', kind: 'impression', certainty: 'firsthand' },
        { from: 1, text: 'Bea took the key without a word.', certainty: 'hearsay' },
      ],
    })
    const result = parseScribeResponse(raw, input({ maxNew: 5 }))
    expect(result.add.map((a) => a.certainty)).toEqual(['claim', 'firsthand', 'belief', 'firsthand', 'firsthand'])
  })

  it('returns an empty result for garbage without throwing', () => {
    const empty = { add: [], told: [], retire: [], resolve: [] }
    expect(parseScribeResponse('nothing to add', input())).toEqual(empty)
    expect(parseScribeResponse('{not json at all', input())).toEqual(empty)
    expect(parseScribeResponse('', input())).toEqual(empty)
    expect(parseScribeResponse('[1, 2]', input())).toEqual(empty)
    expect(parseScribeResponse(json({ add: 'nope', told: 5 }), input())).toEqual(empty)
  })

  it('drops unknown names and adds with an invalid message number', () => {
    const raw = json({
      add: [
        { from: 1, text: 'Ash and Zed argued.', about: ['Ash', 'Zed'] },
        { from: 9, text: 'This came from nowhere.' },
        { text: 'No source at all.' },
      ],
    })
    const result = parseScribeResponse(raw, input())
    expect(result.add).toHaveLength(1)
    // "Ash" resolves by unambiguous first name; "Zed" is not in the cast.
    expect(result.add[0].aboutIds).toEqual(['ash'])
  })

  it('never widens witnesses beyond who perceived the message', () => {
    const raw = json({
      add: [{ from: 3, text: 'Cole confessed the ward to Dara.', witnesses: ['Cole', 'Dara', 'Ash', 'Bea'], feelings: { Ash: 1, Dara: -3 } }],
    })
    const [add] = parseScribeResponse(raw, input()).add
    expect(add.witnessIds).toEqual(['cole', 'dara'])
    expect(add.feelings).toEqual({ dara: -1 })
  })

  it('falls back to the message witnesses when the requested set is entirely outside it', () => {
    const raw = json({ add: [{ from: 3, text: 'Cole spoke to Dara.', witnesses: ['Ash'] }] })
    expect(parseScribeResponse(raw, input()).add[0].witnessIds).toEqual(['cole', 'dara'])
  })

  it('narrows witnesses for a whisper and limits feelings to them', () => {
    const raw = json({
      add: [{ from: 2, text: 'Bea told Ash her real name.', kind: 'secret', witnesses: ['Ash', 'Bea'], feelings: { Ash: 0.4, Cole: -0.5 } }],
    })
    const [add] = parseScribeResponse(raw, input()).add
    expect(add.witnessIds).toEqual(['ash', 'bea'])
    expect(add.feelings).toEqual({ ash: 0.4 })
  })

  it('drops near-duplicates of existing memories and of each other', () => {
    const raw = json({
      add: [
        { from: 3, text: 'Cole broke the ward on the east gate!', importance: 0.9 },
        { from: 1, text: 'Ash gave Bea the key to keep.', importance: 0.4 },
        { from: 1, text: 'Ash gave Bea the key to keep', importance: 0.6 },
      ],
    })
    const result = parseScribeResponse(raw, input())
    expect(result.add).toHaveLength(1)
    expect(result.add[0]).toMatchObject({ text: 'Ash gave Bea the key to keep', importance: 0.6 })
  })

  it('caps new memories to maxNew keeping the most important, in reply order', () => {
    const raw = json({
      add: [
        { from: 1, text: 'Ash handed over the key.', importance: 0.2 },
        { from: 2, text: 'Bea revealed a secret name.', importance: 0.9 },
        { from: 3, text: 'Dara learned about the ward.', importance: 0.5 },
        { from: 1, text: 'Cole watched in silence.', importance: 0.7 },
      ],
    })
    const result = parseScribeResponse(raw, input({ maxNew: 2 }))
    expect(result.add.map((a) => a.importance)).toEqual([0.9, 0.7])
  })

  it('clamps importance, defaults kind, and trims long text', () => {
    const raw = json({ add: [{ from: 1, text: 'word '.repeat(200), kind: 'journal', importance: 7 }] })
    const [add] = parseScribeResponse(raw, input()).add
    expect(add.kind).toBe('event')
    expect(add.importance).toBe(1)
    expect(add.text.length).toBeLessThanOrEqual(300)
  })

  it('records telling, excluding people who already know and listeners who were not there', () => {
    const raw = json({
      told: [
        { memory: 1, to: ['Dara', 'Ash', 'Bea'], by: 'Cole', from: 3 },
        { memory: 1, to: ['Ash'], by: 'Cole', from: 3 },
        { memory: 9, to: ['Dara'], from: 3 },
      ],
    })
    const result = parseScribeResponse(raw, input())
    expect(result.told).toEqual([{ memoryId: 'mem-1', toIds: ['dara'], byId: 'cole', messageId: 'msg-3' }])
  })

  it('retires valid memories and resolves only open threads', () => {
    const raw = json({
      retire: [{ memory: 3, reason: 'Dara now trusts Cole.' }, { memory: 42, reason: 'bogus' }],
      resolve: [1, 2, '2', 7],
    })
    const result = parseScribeResponse(raw, input())
    expect(result.retire).toEqual([{ memoryId: 'mem-3', reason: 'Dara now trusts Cole.' }])
    expect(result.resolve).toEqual(['mem-2'])
  })
})

it('keeps failed or truncated batches retryable instead of accepting repaired partial output', () => {
  for (const raw of ['no JSON', '{"add":[{"from":1,"text":"An unfinished memory', '{"add":[{"from":1,"text":"A completed item."}],"retire":[']) {
    expect(tryParseScribeResponse(raw, input())).toBeUndefined()
  }
  expect(tryParseScribeResponse('```json\n{"add":[],"told":[],"retire":[],"resolve":[]}\n```', input())).toEqual({ add: [], told: [], retire: [], resolve: [] })
  expect(tryParseScribeResponse('{"add":[],"told":[],"retire":[],"resolve":[]}', input())).toBeDefined()
})
it('attributes module-on retirements to optional from and leaves invalid or omitted attribution for the batch fallback', () => {
  const raw = json({ retire: [{ memory: 1, reason: 'changed', from: 2 }, { memory: 2, from: 99 }, { memory: 3 }] })
  expect(tryParseScribeResponse(raw, input({ deepMemory: true }))?.retire).toEqual([
    { memoryId: 'mem-1', reason: 'changed', messageId: 'msg-2' }, { memoryId: 'mem-2', reason: 'superseded' }, { memoryId: 'mem-3', reason: 'superseded' },
  ])
  expect(tryParseScribeResponse(raw, input())?.retire[0]).not.toHaveProperty('messageId')
})

it('does not commit memories or advance the watermark after a failed batch, and retries it successfully', async () => {
  let watermark = 999
  const commit = vi.fn(async () => { watermark = 3000 })
  for (const raw of ['garbage', '{"add":[{"from":1,"text":"Incomplete', '{}']) {
    expect(await commitScribeResponse(raw, input(), commit)).toBe(false)
    expect(watermark).toBe(999)
    expect(commit).not.toHaveBeenCalled()
  }
  expect(await commitScribeResponse('{"add":[],"told":[],"retire":[],"resolve":[]}', input(), commit)).toBe(true)
  expect(watermark).toBe(3000)
  expect(commit).toHaveBeenCalledTimes(1)
})
