import fs from 'node:fs'
import { expect, it } from 'vitest'
import { buildPrompt } from './builder'
import { getInstructTemplate } from './instructTemplates'
import { exampleText, pickExamples, type ExampleBankEntry } from '../characters/exampleBank'
const base = '<START>\n{{user}}: Hello.\n{{char}}: Welcome to the harbor.'
const bank: ExampleBankEntry[] = [{ id: 'planning', situations: ['planning'], text: '<START>\n{{user}}: What is the plan?\n{{char}}: We follow the river.', enabled: true }]
const input = { character: { name: 'Mara', description: 'A synthetic harbor guide.', personality: 'Warm and direct.', scenario: '', first_mes: '', mes_example: base }, personaName: 'Rowan', personaDescription: '', history: [{ id: 'line', role: 'user' as const, name: 'Rowan', text: 'We should plan the route.' }], lorebooks: [], template: getInstructTemplate('plain-chat'), contextBudget: 4000, scanDepth: 8, includeSectionBreakdown: true, countTokens: async (text: string) => Math.ceil(text.length / 4) }
it('preserves the full Phase 3 module-off prompt including examples, and the module-on empty-bank path', async () => {
  const baseline = JSON.parse(fs.readFileSync(new URL('./fixtures/examples-module-off.json', import.meta.url), 'utf8'))
  const picks = pickExamples(bank, { recentText: 'plan the route' })
  expect(await buildPrompt({ ...input, exampleDialogue: exampleText(base, picks, false) })).toEqual(baseline)
  expect(await buildPrompt({ ...input, exampleDialogue: exampleText(base, pickExamples([], { recentText: 'plan' }), true) })).toEqual(baseline)
})
it('appends chosen blocks after the base inside the unchanged wrapper, substitutes macros and honors the section switch', async () => {
  const picks = pickExamples(bank, { recentText: 'plan' })
  const exampleDialogue = exampleText(base, picks, true)
  const result = await buildPrompt({ ...input, exampleDialogue })
  expect(result.prompt).toContain("Example lines showing Mara's voice, style, and typical phrasing. A reference only, not something that already happened in this scene. Do not repeat or continue these lines; write a new reply instead.\n<START>\nRowan: Hello.\nMara: Welcome to the harbor.\n\n<START>\nRowan: What is the plan?\nMara: We follow the river.")
  expect(result.prompt.match(/We follow the river/g)).toHaveLength(1)
  expect((await buildPrompt({ ...input, exampleDialogue, promptSections: { examples: false } })).prompt).not.toContain('We follow the river')
  expect((await buildPrompt({ ...input, character: { ...input.character, mes_example: '' }, exampleDialogue: exampleText('', picks, true) })).prompt).toContain('We follow the river')
})
