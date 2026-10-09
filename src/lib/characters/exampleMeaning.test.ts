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
it('reuses the Phase 2 query and embeds missing entry texts once in a batch, including concurrent previews', async () => {
  const embed = vi.fn(async (texts: string[]) => texts.map((text) => text.includes('storm') ? [0, 1] : [1, 0]))
  const c = { model: 'synthetic', key: 'synthetic', embed }
  const recall = new MeaningRecall()
  const result = await recall.recall(true, c, 'A crossing.', async () => ({}))
  expect(result.queryVector).toEqual([1, 0])
  const examples = new ExampleMeaning()
  const [a, b] = await Promise.all([examples.similarities(true, c, result.queryVector, bank), examples.similarities(true, c, result.queryVector, bank)])
  expect(a).toEqual(b)
  expect(a?.get('first')).toBe(1)
  expect(a?.get('second')).toBe(0)
  expect(embed.mock.calls.map(([texts]) => texts.length)).toEqual([1, 2])
  await examples.similarities(true, c, [0, 1], bank)
  expect(embed).toHaveBeenCalledTimes(2)
  await examples.similarities(true, c, [0, 1], [bank[0], { ...bank[1], text: bank[1].text + ' Changed.' }])
  expect(embed.mock.calls[embed.mock.calls.length - 1]?.[0]).toHaveLength(1)
  await examples.similarities(true, { ...c, key: 'other-model' }, [1, 0], bank)
  expect(embed.mock.calls[embed.mock.calls.length - 1]?.[0]).toHaveLength(2)
})
it('falls back on failures or incompatible dimensions without repeatedly embedding a failed entry', async () => {
  const embed = vi.fn(async () => { throw new Error('Synthetic failure') })
  const examples = new ExampleMeaning(), c = { model: 'synthetic', key: 'failure', embed }
  expect(await examples.similarities(true, c, [1, 0], bank)).toBeUndefined()
  expect(await examples.similarities(true, c, [1, 0], bank)).toBeUndefined()
  expect(embed).toHaveBeenCalledTimes(1)
  expect(await new ExampleMeaning().similarities(true, { ...c, embed: async () => [[1, 0, 0], [1, 0, 0]] }, [1, 0], bank)).toBeUndefined()
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
