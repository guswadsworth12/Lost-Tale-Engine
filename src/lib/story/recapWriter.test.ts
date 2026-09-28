import { describe, expect, it } from 'vitest'
import { buildRecapPrompt, parseRecapResponse, writeSceneRecap, type RecapInput } from './recapWriter'

const base: RecapInput = {
  messages: [
    { role: 'user', name: 'Ada', text: 'We go down into the cistern.' },
    { role: 'char', name: 'Bram', text: 'Bram lights the lamp and follows.' },
  ],
  playerName: 'Ada',
  castNames: ['Bram', 'Cass'],
  location: 'The cistern',
}

describe('parseRecapResponse', () => {
  it('reads valid JSON', () => {
    const raw = JSON.stringify({
      recap: ' Ada and Bram went down. ',
      openThreads: ['Who flooded the cistern?', ''],
      lastingChanges: ['The cistern gate is broken.'],
    })
    expect(parseRecapResponse(raw)).toEqual({
      text: 'Ada and Bram went down.',
      openThreads: ['Who flooded the cistern?'],
      lastingChanges: ['The cistern gate is broken.'],
    })
  })

  it('reads fenced JSON with commentary around it', () => {
    const raw = 'Here you go:\n```json\n{"recap": "They argued.", "openThreads": ["The debt"], "lastingChanges": []}\n```\nHope that helps.'
    expect(parseRecapResponse(raw)).toEqual({ text: 'They argued.', openThreads: ['The debt'], lastingChanges: [] })
  })

  it('repairs slightly broken JSON (trailing comma, unclosed)', () => {
    const raw = '{"recap": "Bram swore an oath.", "openThreads": ["The oath", ], "lastingChanges": ["Bram is sworn to Ada."'
    const draft = parseRecapResponse(raw)
    expect(draft.text).toBe('Bram swore an oath.')
    expect(draft.openThreads).toEqual(['The oath'])
    expect(draft.lastingChanges).toEqual(['Bram is sworn to Ada.'])
  })

  it('treats plain text as the recap', () => {
    expect(parseRecapResponse('  Ada and Bram found the key.\n')).toEqual({
      text: 'Ada and Bram found the key.',
      openThreads: [],
      lastingChanges: [],
    })
  })

  it('treats plain text with a stray brace as the recap', () => {
    const draft = parseRecapResponse('Ada drew a { on the wall and left.')
    expect(draft.text).toBe('Ada drew a { on the wall and left.')
    expect(draft.openThreads).toEqual([])
  })

  it('returns an empty draft for an empty reply', () => {
    expect(parseRecapResponse('   ')).toEqual({ text: '', openThreads: [], lastingChanges: [] })
  })

  it('caps list lengths, drops non-strings, bullets and duplicates', () => {
    const many = Array.from({ length: 10 }, (_, i) => `- Thread ${i}`)
    const raw = JSON.stringify({
      recap: 'x',
      openThreads: [...many, 'Thread 0'],
      lastingChanges: [1, null, 'A', 'a', '  ', 'B', 'C', 'D', 'E', 'F', 'G'],
    })
    const draft = parseRecapResponse(raw)
    expect(draft.openThreads).toHaveLength(6)
    expect(draft.openThreads[0]).toBe('Thread 0')
    expect(draft.lastingChanges).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('accepts snake_case keys', () => {
    const draft = parseRecapResponse('{"recap":"r","open_threads":["t"],"lasting_changes":["c"]}')
    expect(draft).toEqual({ text: 'r', openThreads: ['t'], lastingChanges: ['c'] })
  })
})

describe('buildRecapPrompt', () => {
  it('names who was there and the location, and asks for the three fields', () => {
    const prompt = buildRecapPrompt(base)
    expect(prompt).toContain('Ada, Bram, Cass')
    expect(prompt).toContain('The cistern')
    expect(prompt).toContain('"recap"')
    expect(prompt).toContain('"openThreads"')
    expect(prompt).toContain('"lastingChanges"')
    expect(prompt).toMatch(/past-tense/)
    expect(prompt).toMatch(/80 to 160 words/)
    expect(prompt).toMatch(/Never invent/)
    expect(prompt).toContain('Bram: Bram lights the lamp and follows.')
    expect(prompt).not.toMatch(/was cut/)
  })

  it('keeps the latest messages and notes the cut when over budget', () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      role: (i % 2 ? 'char' : 'user') as 'user' | 'char',
      name: i % 2 ? 'Bram' : 'Ada',
      text: `message number ${i} ${'.'.repeat(80)}`,
    }))
    const prompt = buildRecapPrompt({ ...base, messages, maxChars: 1000 })
    expect(prompt).toContain('message number 49 ')
    expect(prompt).toContain('message number 45 ')
    expect(prompt).not.toContain('message number 0 ')
    expect(prompt).not.toContain('message number 20 ')
    expect(prompt).toMatch(/start of this scene was cut/)
    // Kept messages stay in order.
    expect(prompt.indexOf('message number 48 ')).toBeLessThan(prompt.indexOf('message number 49 '))
  })

  it('always keeps the latest message even if it alone exceeds the budget', () => {
    const prompt = buildRecapPrompt({ ...base, messages: [{ role: 'char', name: 'Bram', text: 'x'.repeat(500) }], maxChars: 100 })
    expect(prompt).toContain('Bram: xxx')
  })

  it('frames storySoFar as context only, never to be retold', () => {
    const prompt = buildRecapPrompt({ ...base, storySoFar: 'Scene 1: Ada met Bram at the guildhall.' })
    expect(prompt).toContain('Ada met Bram at the guildhall.')
    expect(prompt).toMatch(/context only/i)
    expect(prompt).toMatch(/Do not retell/)
    // The story so far comes before the transcript, not mixed into it.
    expect(prompt.indexOf('guildhall')).toBeLessThan(prompt.indexOf('Scene transcript:'))
  })

  it('omits the story-so-far block when empty', () => {
    expect(buildRecapPrompt({ ...base, storySoFar: '  ' })).not.toMatch(/story so far/i)
  })
})

describe('writeSceneRecap', () => {
  it('sends the built prompt and parses the reply', async () => {
    let seen = ''
    const draft = await writeSceneRecap({
      ...base,
      generate: async (p) => {
        seen = p
        return '{"recap":"Done.","openThreads":[],"lastingChanges":["The lamp is lost."]}'
      },
    })
    expect(seen).toBe(buildRecapPrompt(base))
    expect(draft).toEqual({ text: 'Done.', openThreads: [], lastingChanges: ['The lamp is lost.'] })
  })
})
