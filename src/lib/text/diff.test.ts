import { describe, expect, it } from 'vitest'
import { diffLines, diffWords, hasChanges } from './diff'

const rebuild = (parts: { type: string; text: string }[], keep: 'before' | 'after') =>
  parts.filter((p) => p.type === 'same' || p.type === (keep === 'before' ? 'removed' : 'added')).map((p) => p.text).join('')

describe('text diff', () => {
  it('marks the words that changed and keeps the rest', () => {
    const parts = diffWords('Keep scenes short and end on a question.', 'Keep scenes long and end on a cliffhanger.')
    expect(parts).toEqual([
      { type: 'same', text: 'Keep scenes ' },
      { type: 'removed', text: 'short' },
      { type: 'added', text: 'long' },
      { type: 'same', text: ' and end on a ' },
      { type: 'removed', text: 'question.' },
      { type: 'added', text: 'cliffhanger.' },
    ])
  })

  it('always rebuilds both texts exactly', () => {
    const before = 'Line one\nLine two\nLine three\n'
    const after = 'Line one\nLine 2\nLine three\nLine four'
    for (const parts of [diffLines(before, after), diffWords(before, after)]) {
      expect(rebuild(parts, 'before')).toBe(before)
      expect(rebuild(parts, 'after')).toBe(after)
    }
    expect(diffLines(before, after).filter((p) => p.type !== 'same').map((p) => p.text)).toEqual(['Line two\n', 'Line 2\n', 'Line four'])
  })

  it('says when nothing changed', () => {
    expect(hasChanges(diffWords('same text', 'same text'))).toBe(false)
    expect(hasChanges(diffWords('', 'new'))).toBe(true)
  })
})
