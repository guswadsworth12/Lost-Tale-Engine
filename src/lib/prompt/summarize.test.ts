import { describe, expect, it, vi, type Mock } from 'vitest'
import { summarizeMessages } from './summarize'
import type { ChatMessage } from './builder'

const MESSAGES: ChatMessage[] = [
  { id: '1', role: 'char', name: 'Rin', text: '"Well, it\'s not like I missed you or anything." *She looks away.*' },
]

interface TestInput extends Omit<Parameters<typeof summarizeMessages>[0], 'generate'> {
  generate: Mock
}

function baseInput(overrides: Partial<TestInput> = {}): TestInput {
  return {
    existingSummary: '',
    messages: MESSAGES,
    charName: 'Rin',
    userName: 'You',
    generate: vi.fn(async () => 'Updated memory.'),
    ...overrides,
  }
}

describe('summarizeMessages', () => {
  it('builds a prompt with no voice-retention instruction when no fingerprint is passed', async () => {
    const input = baseInput()
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).not.toContain('distinctive voice worth protecting')
  })

  it('builds a prompt with no voice-retention instruction for an empty fingerprint object', async () => {
    const input = baseInput({ voiceFingerprint: {} })
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).not.toContain('distinctive voice worth protecting')
  })

  it('does not carry tics or catchphrases into factual memory', async () => {
    const input = baseInput({ voiceFingerprint: { catchphrases: ['show me'], verbalTics: ['well'] } })
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).not.toContain('"show me"')
    expect(prompt).not.toContain('"well"')
    expect(prompt).toContain('who requested, permitted, intended, or actually promised')
    expect(prompt).toContain('Do not infer routines or elapsed absences')
  })

  it('reminds the summarizer to keep register in the current card', async () => {
    const input = baseInput({ voiceFingerprint: { dialectNotes: 'formal under pressure' } })
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).toContain('Their current card provides voice guidance')
  })

  it('keeps the existing length/no-em-dash/no-invention instructions intact alongside the new one', async () => {
    const input = baseInput({ voiceFingerprint: { catchphrases: ['you are impossible'] }, detail: 'detailed' })
    await summarizeMessages(input)
    const prompt = input.generate.mock.calls[0][0] as string
    expect(prompt).toContain('no em dashes')
    expect(prompt).toContain('under 300 words')
    expect(prompt).toContain("Do not invent anything that didn't happen above.")
  })

  it('rejects a cut-off summary without advancing the memory checkpoint', async () => {
    const input = baseInput({ generate: vi.fn(async () => 'Pell promised to') })
    await expect(summarizeMessages(input)).rejects.toThrow('mid-sentence')
  })

  it('trims and returns the generated result', async () => {
    const input = baseInput()
    input.generate = vi.fn(async () => '  Trimmed memory.  \n')
    const result = await summarizeMessages(input)
    expect(result).toBe('Trimmed memory.')
  })
})
