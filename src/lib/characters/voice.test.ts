import { describe, expect, it } from 'vitest'
import {
  collectCharacterTurns,
  countProseWords,
  deriveCardReplyBand,
  detectVoiceFingerprint,
  extractExampleCharTurns,
  clipReplyToBudget,
  replyTokenBudget,
  resolveReplyLength,
  usesActionMarkup,
} from './voice'

const TERSE_EXAMPLES = [
  '<START>',
  '{{user}}: How was your day?',
  '{{char}}: Fine.',
  '<START>',
  '{{user}}: Want to get lunch?',
  '{{char}}: *shrugs* If you\'re paying.',
].join('\n')

const VERBOSE_EXAMPLES = [
  '<START>',
  '{{user}}: Tell me about this place.',
  `{{char}}: *She gestures at the water, the light catching the ring on her hand.* This harbour was the first thing I ever painted, back when I still believed a horizon could be got right in a single afternoon if you only stared at it hard enough. It cannot, obviously. I have tried perhaps forty times since, in every season and every kind of weather, and each attempt is wrong in a slightly different and slightly more interesting way than the last. The morning ones come out too kind. The winter ones lie about the cold. *A pause, wry, as she tucks a loose strand of hair back.* You asked a small question and I have handed you the entire lecture, complete with footnotes. That tends to happen when someone lets me talk about the work. Consider yourself warned for next time.`,
].join('\n')

describe('countProseWords', () => {
  it('ignores wrapping asterisks and quote marks', () => {
    expect(countProseWords('*She waves.* "Hi there."')).toBe(4)
  })
})

describe('extractExampleCharTurns', () => {
  it('pulls only the {{char}} turns out of a SillyTavern example block', () => {
    const turns = extractExampleCharTurns(TERSE_EXAMPLES)
    expect(turns).toEqual(['Fine.', "*shrugs* If you're paying."])
  })

  it('returns nothing for loose prose with no speaker labels', () => {
    expect(extractExampleCharTurns('She walked in and sat down without a word.')).toEqual([])
  })

  it('ends a character turn when a named third person speaks', () => {
    const example = '<START>\n{{user}}: You can stay.\n{{char}}: Are you sure?\nTamsin: Nobody minds.\n{{char}}: Then I will.'
    expect(extractExampleCharTurns(example)).toEqual(['Are you sure?', 'Then I will.'])
    expect(deriveCardReplyBand({ mes_example: example, first_mes: '' }).source).toBe('examples')
  })
})

describe('deriveCardReplyBand', () => {
  it('bands a terse card as brief, from its examples', () => {
    const d = deriveCardReplyBand({ mes_example: TERSE_EXAMPLES, first_mes: '' })
    expect(d.band).toBe('brief')
    expect(d.source).toBe('examples')
  })

  it('bands a verbose card as detailed', () => {
    expect(deriveCardReplyBand({ mes_example: VERBOSE_EXAMPLES, first_mes: '' }).band).toBe('detailed')
  })

  it('falls back to the greeting when there is no example dialogue', () => {
    const d = deriveCardReplyBand({ mes_example: '', first_mes: 'Hey. *She looks up briefly, then back at her book.* You need something?' })
    expect(d.source).toBe('greeting')
  })

  it('defaults to moderate for a blank card', () => {
    expect(deriveCardReplyBand({ mes_example: '', first_mes: '' })).toEqual({ band: 'moderate', measuredWords: 0, source: 'default' })
  })
})

describe('resolveReplyLength', () => {
  it('an explicit override wins over the card measurement', () => {
    const r = resolveReplyLength('detailed', { mes_example: TERSE_EXAMPLES, first_mes: '' })
    expect(r.band).toBe('detailed')
    expect(r.derived).toBe(false)
  })

  it('auto / unset measures the card and points the model at its own examples', () => {
    const r = resolveReplyLength(undefined, { mes_example: TERSE_EXAMPLES, first_mes: '' })
    expect(r.band).toBe('brief')
    expect(r.derived).toBe(true)
    expect(r.instruction).toContain('example dialogue')
  })
})

describe('collectCharacterTurns', () => {
  it('combines example turns, first_mes, and alternate greetings, dropping blanks', () => {
    const turns = collectCharacterTurns({
      mes_example: TERSE_EXAMPLES,
      first_mes: 'Hey there.',
      alternate_greetings: ['Oh, it\'s you.', '  ', undefined as unknown as string].filter(Boolean),
    })
    expect(turns).toEqual(['Fine.', "*shrugs* If you're paying.", 'Hey there.', "Oh, it's you."])
  })

  it('returns just the example turns when there is no greeting', () => {
    expect(collectCharacterTurns({ mes_example: TERSE_EXAMPLES, first_mes: '' })).toHaveLength(2)
  })
})

describe('usesActionMarkup', () => {
  it('is true when the card uses *asterisk* action beats anywhere in its authored text', () => {
    expect(usesActionMarkup({ mes_example: TERSE_EXAMPLES, first_mes: 'Hey.' })).toBe(true)
    expect(usesActionMarkup({ mes_example: '', first_mes: '*She looks up.* "Oh. You."' })).toBe(true)
  })

  it('is false for a deliberately plain-prose card with no asterisks', () => {
    expect(
      usesActionMarkup({
        mes_example: '<START>\n{{user}}: Hi.\n{{char}}: She just nods, not looking up from the book.',
        first_mes: 'The bell over the door rings. She does not look up.',
      }),
    ).toBe(false)
  })
})

describe('detectVoiceFingerprint', () => {
  it('reports zero turns analyzed and finds nothing for a blank card', () => {
    const d = detectVoiceFingerprint({ mes_example: '', first_mes: '' })
    expect(d).toEqual({ verbalTics: [], catchphrases: [], turnsAnalyzed: 0 })
  })

  it('does not treat a single turn as "recurring" anything, even if it repeats a word internally', () => {
    // One turn, however distinctive, cannot demonstrate a *recurring* pattern across turns.
    const d = detectVoiceFingerprint({
      mes_example: '',
      first_mes: '"Well, well, well, look who it is. Well I never."',
    })
    expect(d.turnsAnalyzed).toBe(1)
    expect(d.verbalTics).toEqual([])
    expect(d.catchphrases).toEqual([])
  })

  const TSUNDERE = [
    '<START>',
    '{{user}}: Did you make this for me?',
    '{{char}}: "Well, it\'s not like I wanted to make it for you or anything." *She shoves the box into his hands without looking at him.*',
    '<START>',
    '{{user}}: You waited outside for an hour?',
    '{{char}}: "Well, it\'s not like I have anywhere better to be." *She looks away, ears red.*',
    '<START>',
    '{{user}}: Thanks for helping me study.',
    '{{char}}: "Fine! Whatever! Just don\'t expect me to do it again!" *She huffs and crosses her arms.*',
  ].join('\n')

  it('detects a recurring verbal tic across distinct turns', () => {
    const d = detectVoiceFingerprint({
      mes_example: TSUNDERE,
      first_mes: '"Well, it\'s not like I asked you to come over, you know."',
    })
    expect(d.turnsAnalyzed).toBe(4)
    expect(d.verbalTics).toContain('well')
  })

  it('detects a repeated multi-word catchphrase across distinct turns, not just a single one', () => {
    const d = detectVoiceFingerprint({
      mes_example: TSUNDERE,
      first_mes: '"Well, it\'s not like I asked you to come over, you know."',
    })
    expect(d.catchphrases.some((c) => c.includes("it's not like i"))).toBe(true)
  })

  it('does not surface a phrase that only appears in one turn', () => {
    const d = detectVoiceFingerprint({
      mes_example: TSUNDERE,
      first_mes: '"Well, it\'s not like I asked you to come over, you know."',
    })
    expect(d.catchphrases.some((c) => c.includes('do it again'))).toBe(false)
    expect(d.catchphrases.some((c) => c.includes('helping me study'))).toBe(false)
  })

  it('excludes a repeated stopword-only n-gram from catchphrases', () => {
    const d = detectVoiceFingerprint({
      mes_example: '',
      first_mes: '"I stood at the edge of the lake for a long while."',
      alternate_greetings: ['"He handed me the key of the door and said nothing."'],
    })
    expect(d.catchphrases.some((c) => c === 'of the')).toBe(false)
  })

  it('reads a terse card as short, clipped sentence rhythm', () => {
    const d = detectVoiceFingerprint({ mes_example: TERSE_EXAMPLES, first_mes: 'Hi. Sit.' })
    expect(d.sentenceRhythm).toBe('Short, clipped sentences.')
  })

  it('reads a verbose card as long, winding sentence rhythm', () => {
    const d = detectVoiceFingerprint({
      mes_example: VERBOSE_EXAMPLES,
      first_mes:
        '"I have spent a very long time thinking about the particular quality of light that falls across this harbour in the early evening, and I am still not sure I have found the words for it, even after all these years of trying."',
    })
    expect(d.sentenceRhythm).toBe('Long, winding sentences.')
  })

  it('flags a genuine majority ellipsis/question habit but not an isolated one', () => {
    const ellipsisHeavy = detectVoiceFingerprint({
      mes_example: '',
      first_mes: '"I mean... I guess... it could work..."',
      alternate_greetings: ['"Maybe... if you really want to..."', '"I suppose... why not..."'],
    })
    expect(ellipsisHeavy.punctuationNotes).toContain('ellipses')

    const mostlyPlain = detectVoiceFingerprint({
      mes_example: '',
      first_mes: '"Sure, that works."',
      alternate_greetings: ['"Sounds good to me."', '"Wait... are you serious?"'],
    })
    expect(mostlyPlain.punctuationNotes ?? '').not.toContain('ellipses')
  })
})

describe('replyTokenBudget', () => {
  it('caps well below the user max for a brief band', () => {
    expect(replyTokenBudget('brief', 512).visible).toBeLessThan(160)
  })

  it('never raises the user ceiling for the reply text', () => {
    expect(replyTokenBudget('detailed', 120).visible).toBeLessThanOrEqual(120)
  })

  it('keeps a sane floor even against an extreme user setting', () => {
    expect(replyTokenBudget('brief', 10).visible).toBeGreaterThanOrEqual(48)
  })

  it('defaults to no reasoning reserve, reproducing the old prose-only cap', () => {
    const budget = replyTokenBudget('brief', 512)
    expect(budget.request).toBe(budget.visible)
    expect(budget).toEqual(replyTokenBudget('brief', 512, 0))
  })

  it('adds the reasoning reserve on top of the band cap for the request, so a thinking model can finish reasoning before the visible reply', () => {
    const budget = replyTokenBudget('brief', 8000, 3000)
    expect(budget.request).toBe(budget.visible + 3000)
    expect(budget.visible).toBe(replyTokenBudget('brief', 8000).visible)
  })

  it('keeps the band when the reserve is large: the reply text stays at the band cap and only the request grows', () => {
    // The old cap clamped band + reserve to the user max, so a 768 reserve turned a moderate
    // speaker's 228-token cap into the full 512, and the reply could fill it.
    const budget = replyTokenBudget('moderate', 512, 768)
    expect(budget.visible).toBeLessThan(512)
    expect(budget.request).toBe(budget.visible + 768)
  })

  it('ignores a negative reserve rather than lowering the cap', () => {
    expect(replyTokenBudget('brief', 512, -100)).toEqual(replyTokenBudget('brief', 512, 0))
  })
})

describe('clipReplyToBudget', () => {
  it('leaves a reply within its budget alone', () => {
    expect(clipReplyToBudget('Short and done.', 50)).toEqual({ text: 'Short and done.', clipped: false })
  })

  it('cuts a reply that ran past its budget to the budget', () => {
    const long = 'She keeps talking. '.repeat(100)
    const held = clipReplyToBudget(long, 50)
    expect(held.clipped).toBe(true)
    expect(held.text.length).toBe(200)
    expect(long.startsWith(held.text)).toBe(true)
  })
})

describe('automatic reply guidance', () => {
  it('does not force a sentence cap when examples are brief', () => {
    const guidance = resolveReplyLength('auto', { mes_example: TERSE_EXAMPLES, first_mes: '' }).instruction
    expect(guidance).not.toContain('one to three sentences')
    expect(guidance).toContain('Match the length and rhythm')
  })
})
