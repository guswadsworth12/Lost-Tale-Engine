import { expect, it } from 'vitest'
import { EXAMPLE_TOKEN_BUDGET, guessSituations, pickExamples, splitExamples, validateExampleBank, type ExampleBankEntry } from './exampleBank'
import { deriveCardReplyBand } from './voice'
const entry = (id: string, situations: ExampleBankEntry['situations'], text = '<START>\n{{user}}: Hello.\n{{char}}: A synthetic reply.'): ExampleBankEntry => ({ id, situations, text, enabled: true })
it('guesses literal situation words and scene state without matching word fragments', () => {
  expect(guessSituations('A joking tease blushes after victory. We are planning a route.')).toEqual(['banter', 'teasing', 'planning', 'celebrating'])
  expect(guessSituations('Coffee and congratulations! A furious enemy attacks.')).toEqual(['everyday', 'anger', 'danger', 'celebrating'])
  expect(guessSituations('A planet and a fighter.')).toEqual([])
  expect(guessSituations('', { activeDate: true })).toEqual(['everyday', 'flirting'])
  expect(guessSituations('', { activeHangout: true, pendingAdjudication: true, planning: true })).toEqual(['everyday', 'danger', 'planning'])
  expect(guessSituations('', { danger: true })).toEqual(['danger'])
})
it('picks by score, everyday tie preference and bank order within 450 tokens', () => {
  const bank = [entry('other', ['banter']), entry('daily', ['everyday']), entry('both', ['everyday', 'banter'])]
  expect(pickExamples(bank, { recentText: 'Hello, funny!' }).map((p) => p.entry.id)).toEqual(['both', 'daily'])
  expect(pickExamples([entry('first', ['banter']), entry('second', ['banter']), entry('third', ['banter'])], { recentText: 'funny' }).map((p) => p.entry.id)).toEqual(['first', 'second'])
  const picked = pickExamples([entry('large', ['danger'], '<START>\n{{char}}: '+ 'x'.repeat(1740)), entry('small', ['danger'])], { recentText: 'danger' })
  expect(picked).toHaveLength(1)
  expect(picked.reduce((n, p) => n + p.tokens, 0)).toBeLessThanOrEqual(EXAMPLE_TOKEN_BUDGET)
  expect(pickExamples([entry('too-big', ['danger'], 'x'.repeat(1801))], { recentText: 'danger' })).toEqual([])
})
it('avoids previous entries when another fits, but repeats when nothing else fits', () => {
  const bank = [entry('a', ['banter']), entry('b', ['banter']), entry('wrong', ['danger'])]
  expect(pickExamples(bank, { recentText: 'joke', previousIds: ['a'] }).map((p) => p.entry.id)).toEqual(['b'])
  expect(pickExamples(bank, { recentText: 'joke', previousIds: ['a', 'b'] }).map((p) => p.entry.id)).toEqual(['a', 'b'])
  expect(pickExamples([bank[0], bank[2]], { recentText: 'joke', previousIds: ['a'] }).map((p) => p.entry.id)).toEqual(['a'])
})
it('falls back to one enabled everyday entry, or adds nothing without one', () => {
  const bank = [{ ...entry('off', ['everyday']), enabled: false }, entry('first', ['everyday']), entry('second', ['everyday'])]
  expect(pickExamples(bank, { recentText: 'Unmatched sentence.' }).map((p) => [p.entry.id, p.fallback])).toEqual([['first', true]])
  expect(pickExamples([entry('danger', ['danger'])], { recentText: '' })).toEqual([])
})
it('similarity changes a tied pick and marks its reason', () => {
  const bank = [entry('a', ['everyday']), entry('b', ['everyday']), entry('c', ['everyday'])]
  const picks = pickExamples(bank, { recentText: 'hello', similarities: new Map([['c', 0.9], ['b', 0.1]]) })
  expect(picks.map((p) => p.entry.id)).toEqual(['c', 'b'])
  expect(picks.every((p) => p.similarMeaning)).toBe(true)
})
it('splits line-based START blocks, suggests editable tags and preserves reply band and measured median', () => {
  const text = '<start>\n{{user}}: A danger!\n{{char}}: Keep calm and stay close.\n<START>\n{{char}}: We should plan the route very carefully.\nMore words follow.'
  let id = 0
  const bank = splitExamples(text, () => String(++id))
  expect(bank.map((e) => e.situations)).toEqual([['danger'], ['planning']])
  expect(validateExampleBank(bank)).toEqual(bank)
  expect(deriveCardReplyBand({ mes_example: '', first_mes: '' }, bank)).toEqual(deriveCardReplyBand({ mes_example: text, first_mes: '' }))
  expect(deriveCardReplyBand({ mes_example: '', first_mes: '' }, bank.map((e) => ({ ...e, enabled: false }))).source).toBe('default')
})
