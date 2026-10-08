import { describe, expect, it } from 'vitest'
import { splitSpeechText, splitVoiceSegments, toSpeakableText } from './speakableText'

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

it('keeps short replies together instead of splitting a quoted phrase at 120 characters', () => {
  const text = '"You brought something for both of us, huh?" "All right, then. Let\'s see if you learned how to pack light before rescuing Brisa from whatever you\'ve dragged back this time."'
  expect(splitSpeechText(text)).toEqual([text])
})

it('splits longer replies at sentence endings and preserves every word', () => {
  const text = 'A long sentence fills the hall with all the noise of a crowded table. '.repeat(6).trim()
  const clips = splitSpeechText(text)
  expect(clips.length).toBeGreaterThan(1)
  expect(clips.every((clip) => clip.endsWith('.'))).toBe(true)
  expect(clips.join(' ')).toBe(text)
})

describe('splitVoiceSegments', () => {
  it('routes actions and bare narration to the narrator while keeping quoted dialogue with the character', () => {
    expect(splitVoiceSegments('*Maelin sets down her mug.* "Welcome home." She smiles. "Sit with us."')).toEqual([
      { role: 'narrator', text: 'Maelin sets down her mug.' },
      { role: 'character', text: 'Welcome home.' },
      { role: 'narrator', text: 'She smiles.' },
      { role: 'character', text: 'Sit with us.' },
    ])
  })

  it('speaks GM story prose without reading labels or judgment tags', () => {
    expect(splitVoiceSegments('Game Master: Valenne comes into view.\nGame Master: Home is waiting.', true)).toEqual([
      { role: 'narrator', text: 'Valenne comes into view. Home is waiting.' },
    ])
    expect(splitVoiceSegments('[GM judgment (guided, not a rules result)] The gifts are received.', true)).toEqual([
      { role: 'narrator', text: 'The gifts are received.' },
    ])
  })

  it('does not send an internal GM no-op marker to LuxTTS', () => {
    expect(splitVoiceSegments('[The GM lets the moment play out.]', true)).toEqual([])
  })
})
