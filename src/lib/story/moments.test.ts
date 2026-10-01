import { describe, expect, it } from 'vitest'
import { buildImprovePromptRequest, draftMomentPrompt, groupMoments, momentText, normalizeMomentInput, type StoryMoment } from './moments'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

describe('a new moment', () => {
  it('keeps known shapes and says what is missing', () => {
    expect(normalizeMomentInput({ kind: 'moment', caption: '  The lamp goes out  ', prompt: 'x', messageId: 'm1', characterIds: ['bea', 'bea', 7], image: PNG, extra: 1 }))
      .toEqual({ value: { kind: 'moment', caption: 'The lamp goes out', prompt: 'x', messageId: 'm1', characterIds: ['bea'], image: PNG } })
    expect(normalizeMomentInput({ kind: 'selfie', image: PNG }).error).toMatch(/what kind of picture/)
    expect(normalizeMomentInput({ kind: 'moment', image: '/avatars/x.png' }).error).toMatch(/needs its picture/)
  })
})

describe('the drafted prompt', () => {
  const cast = [{ name: 'Bea', appearance: 'tall, short grey hair, oilskin coat' }, { name: 'Cole' }]
  it('pictures the line, who is there and how they look, and where', () => {
    expect(draftMomentPrompt({ kind: 'moment', moments: [{ speaker: 'Bea', text: 'She blows out the lamp.' }], location: 'the lighthouse', timeOfDay: 'night', characters: cast, artStyle: 'Watercolor, muted colors' }))
      .toBe('Bea (tall, short grey hair, oilskin coat) and Cole at the lighthouse, night. The moment: Bea: She blows out the lamp. Watercolor, muted colors.')
  })
  it('says the time of day even when the place is unknown', () => {
    expect(draftMomentPrompt({ kind: 'moment', timeOfDay: 'morning', characters: [{ name: 'Bea' }] })).toBe('Bea, morning. Illustration, cinematic lighting, no text.')
  })

  it('drafts backgrounds without people, and portraits of one character', () => {
    expect(draftMomentPrompt({ kind: 'background', location: 'the harbor', timeOfDay: 'dawn', characters: cast })).toBe('Scenery of the harbor, dawn, no people. Illustration, cinematic lighting, no text.')
    expect(draftMomentPrompt({ kind: 'portrait', subject: 'Bea', characters: cast })).toBe('Portrait of Bea (tall, short grey hair, oilskin coat). Illustration, cinematic lighting, no text.')
  })
})

describe('the Gallery', () => {
  const m = (id: string, storyId: string, chatId: string, createdAt: number): StoryMoment => ({ id, storyId, chatId, characterIds: [], kind: 'moment', caption: id, prompt: '', imageUrl: `/${id}.png`, createdAt })
  it('groups moments by story, chapter and scene, in story order', () => {
    const scenes: Record<string, { chapterId: string; chapterLabel: string; chapterNumber: number; label: string; order: number }> = {
      s1: { chapterId: 'chapter-1', chapterLabel: 'Chapter 1', chapterNumber: 1, label: 'Scene 1', order: 1 },
      s2: { chapterId: 'c2', chapterLabel: 'Chapter 2 · Low Tide', chapterNumber: 2, label: 'Scene 1', order: 3 },
      s3: { chapterId: 'chapter-1', chapterLabel: 'Chapter 1', chapterNumber: 1, label: 'Scene 2', order: 2 },
    }
    const groups = groupMoments([m('b', 'story', 's2', 5), m('a', 'story', 's1', 4), m('c', 'story', 's3', 6), m('d', 'story', 's1', 1), m('z', 'lone', 'lone', 2)], {
      story: (id) => (id === 'story' ? 'Harbor' : 'A lone scene'),
      scene: (id) => scenes[id],
    })
    expect(groups.map((g) => g.storyTitle)).toEqual(['Harbor', 'A lone scene'])
    expect(groups[0].chapters.map((c) => [c.label, c.scenes.map((s) => [s.label, s.moments.map((x) => x.id)])])).toEqual([
      ['Chapter 1', [['Scene 1', ['d', 'a']], ['Scene 2', ['c']]]],
      ['Chapter 2 · Low Tide', [['Scene 1', ['b']]]],
    ])
  })
})

describe('picturing key moments', () => {
  const rend = { speaker: 'Rend', text: '*Rend draws the circle.* "Four great beasts." {OOC: make it epic}' }
  const gm = { speaker: 'Game Master', text: '[Set event (canon, no roll)] The binding takes: a small green cat.' }

  it('reads a line as the story tells it, without labels or out-of-character notes', () => {
    expect(momentText(rend.text)).toBe('Rend draws the circle. "Four great beasts."')
    expect(momentText(gm.text)).toBe('The binding takes: a small green cat.')
  })

  it('drafts from every picked moment, in order', () => {
    expect(draftMomentPrompt({ kind: 'moment', moments: [rend, gm], characters: [{ name: 'Rend' }] }))
      .toBe('Rend. The moments, in order: Rend: Rend draws the circle. "Four great beasts." / Game Master: The binding takes: a small green cat. Illustration, cinematic lighting, no text.')
  })

  it('asks the story model for one picture of the moments, looks taken from the cards', () => {
    const request = buildImprovePromptRequest('Rend in a chamber.', 'moment', { moments: [rend, gm], cards: [{ name: 'Emily', card: 'A small, bright-green feline Exceed.' }] })
    expect(request).toContain('Write a strong prompt for an image generator making a wide story illustration.')
    expect(request).toContain('The story moments to picture, in order:\n- Rend: Rend draws the circle. "Four great beasts."\n- Game Master: The binding takes: a small green cat.')
    expect(request).toContain('Make one picture of them: the single instant that shows them best')
    expect(request).toContain('- Emily: A small, bright-green feline Exceed.')
    expect(request).toContain('draw only on the moments and cards above')
    expect(buildImprovePromptRequest('Rend in a chamber.', 'moment')).toContain('Rewrite this into a strong prompt')
  })
})
