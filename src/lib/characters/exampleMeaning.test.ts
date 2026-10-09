import { expect, it, vi } from 'vitest'
import { ExampleHistory, ExampleMeaning, previousExampleTurn } from './exampleMeaning'
import { MeaningRecall } from '../memory/meaningRecall'
import type { ExampleBankEntry } from './exampleBank'
const bank: ExampleBankEntry[] = [{ id: 'first', enabled: true, situations: ['everyday'], text: '<START>\n{{char}}: A crossing.' }, { id: 'second', enabled: true, situations: ['danger'], text: '<START>\n{{char}}: A storm.' }]
it('does not embed when off, missing a model/query or all entries disabled', async () => {
  const embed = vi.fn(async () => [[1, 0]])
  const c = { model: 'synthetic', key: 'synthetic', embed }
  const examples = new ExampleMeaning()
  await examples.similarities(false, c, [1, 0], bank)
  await examples.similarities(true, undefined, [1, 0], bank)
  await examples.similarities(true, c, undefined, bank)
  await examples.similarities(true, c, [1, 0], bank.map((e) => ({ ...e, enabled: false })))
  expect(embed).not.toHaveBeenCalled()
})
it('embeds missing entries once in the background, never inside a reply, then scores from the cache', async () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const vectors = (texts: string[]) => texts.map((text) => text.includes('storm') ? [0, 1] : [1, 0])
  // The first entry batch waits until released, as a slow service would.
  const embed = vi.fn(async (texts: string[]) => { if (texts.length === 2 && embed.mock.calls.length === 2) await gate; return vectors(texts) })
  const c = { model: 'synthetic', key: 'synthetic', embed }
  const recall = new MeaningRecall()
  const result = await recall.recall(true, c, 'A crossing.', async () => ({}))
  expect(result.queryVector).toEqual([1, 0])
  const examples = new ExampleMeaning()
  // The first replies don't wait: no scores yet, one shared background batch for both.
  const [a, b] = await Promise.all([examples.similarities(true, c, result.queryVector, bank), examples.similarities(true, c, result.queryVector, bank)])
  expect(a).toBeUndefined()
  expect(b).toBeUndefined()
  release()
  await examples.idle()
  const scores = await examples.similarities(true, c, result.queryVector, bank)
  expect(scores?.get('first')).toBe(1)
  expect(scores?.get('second')).toBe(0)
  expect(embed.mock.calls.map(([texts]) => texts.length)).toEqual([1, 2])
  await examples.similarities(true, c, [0, 1], bank)
  expect(embed).toHaveBeenCalledTimes(2)
  // Edited text or another model embeds only what's missing.
  await examples.similarities(true, c, [0, 1], [bank[0], { ...bank[1], text: bank[1].text + ' Changed.' }])
  expect(embed.mock.calls[embed.mock.calls.length - 1]?.[0]).toHaveLength(1)
  await examples.idle()
  await examples.similarities(true, { ...c, key: 'other-model' }, [1, 0], bank)
  expect(embed.mock.calls[embed.mock.calls.length - 1]?.[0]).toHaveLength(2)
})
it('pauses after a failure instead of remembering it all session, and falls back on mismatched dimensions', async () => {
  let clock = 0
  const embed = vi.fn(async () => { throw new Error('Synthetic failure') })
  const examples = new ExampleMeaning(() => clock, 30_000), c = { model: 'synthetic', key: 'failure', embed }
  expect(await examples.similarities(true, c, [1, 0], bank)).toBeUndefined()
  await examples.idle()
  expect(await examples.similarities(true, c, [1, 0], bank)).toBeUndefined()
  expect(embed).toHaveBeenCalledTimes(1)
  clock = 30_001
  await examples.similarities(true, c, [1, 0], bank)
  expect(embed).toHaveBeenCalledTimes(2)
  const mismatched = new ExampleMeaning(), m = { ...c, key: 'dims', embed: async () => [[1, 0, 0], [1, 0, 0]] }
  await mismatched.similarities(true, m, [1, 0], bank)
  await mismatched.idle()
  expect(await mismatched.similarities(true, m, [1, 0], bank)).toBeUndefined()
})
it('tracks successful picks separately for each speaker and chat without consuming previews', () => {
  const history = new ExampleHistory()
  expect(history.ids('chat', 'speaker')).toEqual([])
  history.record('chat', 'speaker', 'reply-1', ['first'])
  expect(history.ids('chat', 'speaker', 'reply-1')).toEqual(['first'])
  history.record('chat', 'speaker', 'reply-2', ['second'])
  expect(history.ids('chat', 'speaker', 'reply-2')).toEqual(['second'])
  // Rewind/delete restores the previous surviving turn; a turn without bank entries consumes none.
  expect(history.ids('chat', 'speaker', 'reply-1')).toEqual(['first'])
  expect(history.ids('chat', 'speaker', 'reply-without-bank')).toEqual([])
  expect(history.ids('chat', 'other')).toEqual([])
  expect(history.ids('fork', 'speaker')).toEqual([])
})

it('finds the previous surviving speaker reply through placeholders, failures and other speakers', () => {
  const messages = [
    { id: 'kept', role: 'char', text: 'A completed reply.' },
    { id: 'other', role: 'char', text: 'Another speaker.', speakerId: 'other' },
    { id: 'failed', role: 'char', text: 'Failed draft.', failed: true },
    { id: 'user', role: 'user', text: 'Continue.' },
    { id: 'streaming', role: 'char', text: '' },
  ]
  expect(previousExampleTurn(messages, 'speaker', 'speaker')).toBe('kept')
  expect(previousExampleTurn(messages.slice(1), 'speaker', 'speaker')).toBeUndefined()
})
