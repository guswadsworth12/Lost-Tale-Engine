import { describe, expect, it } from 'vitest'
import { splitSpeechText, toSpeakableText } from './speakableText'

describe('toSpeakableText', () => {
  it('strips an action wrapped in asterisks, leaving surrounding dialogue', () => {
    expect(toSpeakableText('*smiles warmly* Hello there.')).toBe('Hello there.')
  })

  it('strips multiple actions and squeezes the remaining gaps to single spaces', () => {
    expect(toSpeakableText('*leans in* I missed you *smiles*')).toBe('I missed you')
  })

  it('removes stray markdown characters without removing their letters', () => {
    expect(toSpeakableText('_hello_ ~world~ `code` #tag')).toBe('hello world code tag')
  })

  it('collapses internal whitespace runs to a single space and trims the ends', () => {
    expect(toSpeakableText('  too   much   space  ')).toBe('too much space')
  })

  it('returns an empty string when the text is only action text', () => {
    expect(toSpeakableText('*just an action*')).toBe('')
  })

  it('leaves an unmatched single asterisk alone, since the pair pattern requires a closing one', () => {
    expect(toSpeakableText('a stray * mark')).toBe('a stray * mark')
  })

  it('returns an empty string for empty input', () => {
    expect(toSpeakableText('')).toBe('')
  })

  it('removes Game Master labels from narrator speech while keeping the prose', () => {
    expect(toSpeakableText('Game Master: The city comes back into view.\nGame Master: Home is waiting.', true))
      .toBe('The city comes back into view. Home is waiting.')
    expect(toSpeakableText('Game Master: Hello.')).toBe('Game Master: Hello.')
  })
})

it('splits long narration into bounded clips without losing words', () => {
  const text = 'The western hill is still there. The old hall waits above the city. Home is waiting at the top of it.'
  const clips = splitSpeechText(text, 45)
  expect(clips.every((clip) => clip.length <= 45)).toBe(true)
  expect(clips.join(' ')).toBe(text)
})
