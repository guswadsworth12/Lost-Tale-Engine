import { describe, expect, it } from 'vitest'
import { buildChapterRecapPrompt, writeChapterRecap, type ChapterRecapInput } from './chapterRecap'

const input: ChapterRecapInput = {
  chapterLabel: 'Chapter 1 · The Fog',
  goal: 'Get home before the tide.',
  playerName: 'Wren',
  scenes: [
    { label: 'Scene 1', recap: 'They met at the dock.' },
    { label: 'Scene 2', recap: 'The ferry never came.', openThreads: ['Where is the ferry?'] },
  ],
}

describe('chapter recaps', () => {
  it('ask for the arc from the scene recaps, with the chapter\'s goal', () => {
    const prompt = buildChapterRecapPrompt(input)
    expect(prompt).toContain('Chapter 1 · The Fog')
    expect(prompt).toContain('Get home before the tide.')
    expect(prompt).toContain('Scene 2: The ferry never came. (Left open: Where is the ferry?)')
    expect(prompt).toContain('"openThreads"')
  })

  it('read the model\'s JSON reply', async () => {
    const draft = await writeChapterRecap({ ...input, generate: async () => '```json\n{"recap": "Wren reached the coast too late.", "openThreads": ["Where is the ferry?"]}\n```' })
    expect(draft).toEqual({ text: 'Wren reached the coast too late.', openThreads: ['Where is the ferry?'] })
  })

  it('fall back to the scene recaps when there is no model, or it writes nothing', async () => {
    const failed = await writeChapterRecap({ ...input, generate: async () => { throw new Error('No model connected') } })
    expect(failed).toEqual({ text: 'They met at the dock.\n\nThe ferry never came.', openThreads: ['Where is the ferry?'], fallback: 'No model connected' })
    expect((await writeChapterRecap({ ...input, generate: async () => '{"recap": ""}' })).fallback).toBeTruthy()
  })
})
