import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HELP_TOPIC,
  HELP_GROUPS,
  HELP_TOPIC_IDS,
  HELP_TOPICS,
  blockText,
  getHelpTopic,
  isHelpTopicId,
  parseHelpInline,
  searchHelp,
} from './helpContent'
import { TOUR_STEPS } from './tourSteps'

/** The workflows the reference has to cover. Renaming a topic id means updating deep links too. */
const REQUIRED_TOPICS = [
  'getting-started',
  'navigation',
  'stories',
  'playing',
  'visual-novel',
  'story-panel',
  'cast',
  'worlds',
  'lore',
  'media',
  'writers-room',
  'settings',
  'campaign',
  'simulation',
  'dating',
  'shortcuts',
]

const allStrings = (): string[] =>
  HELP_TOPICS.flatMap((topic) => [
    topic.title,
    topic.summary,
    ...topic.sections.flatMap((section) => [
      section.heading,
      ...section.blocks.flatMap((block) =>
        block.kind === 'text' || block.kind === 'note'
          ? [block.text]
          : block.kind === 'keys'
            ? block.rows.flatMap((row) => [row.keys, row.description])
            : block.items,
      ),
    ]),
  ])

describe('help content', () => {
  it('has every required topic, each exactly once', () => {
    const ids = HELP_TOPICS.map((topic) => topic.id)
    for (const id of REQUIRED_TOPICS) expect(ids).toContain(id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([...HELP_TOPIC_IDS].sort())
  })

  it('gives every topic and section a non-empty, unique id and real content', () => {
    const sectionIds: string[] = []
    for (const topic of HELP_TOPICS) {
      expect(topic.id.trim()).not.toBe('')
      expect(topic.title.trim()).not.toBe('')
      expect(topic.summary.trim()).not.toBe('')
      expect(HELP_GROUPS).toContain(topic.group)
      expect(topic.sections.length).toBeGreaterThan(0)
      for (const section of topic.sections) {
        expect(section.id).toMatch(/^[a-z0-9][a-z0-9-]*$/)
        expect(section.heading.trim()).not.toBe('')
        expect(section.blocks.length).toBeGreaterThan(0)
        for (const block of section.blocks) expect(blockText(block).trim()).not.toBe('')
        sectionIds.push(section.id)
      }
    }
    expect(new Set(sectionIds).size).toBe(sectionIds.length)
  })

  it('only relates to topics that exist, and never to itself', () => {
    for (const topic of HELP_TOPICS) {
      for (const related of topic.related ?? []) {
        expect(isHelpTopicId(related)).toBe(true)
        expect(related).not.toBe(topic.id)
      }
    }
  })

  it('has balanced **bold** markers everywhere', () => {
    for (const text of allStrings()) {
      expect((text.match(/\*\*/g) ?? []).length % 2, text).toBe(0)
    }
  })

  it('marks the conditional systems as conditional', () => {
    for (const id of ['campaign', 'simulation', 'dating'] as const) {
      expect(getHelpTopic(id).condition).toBeTruthy()
    }
  })

  it('does not present guided story rules as rules enforcement', () => {
    const campaign = getHelpTopic('campaign').sections.flatMap((section) => section.blocks.map(blockText)).join(' ')
    expect(campaign).toMatch(/not rules enforcement/i)
  })

  it('keeps Media short: story CGs and the soundtrack', () => {
    const media = getHelpTopic('media')
    expect(media.summary).toMatch(/^Story CGs and unlock progress/)
    expect(media.sections.map((section) => section.heading)).toEqual(['Story CGs and unlock progress', 'Soundtrack'])
  })

  it('falls back to the default topic for unknown ids', () => {
    expect(getHelpTopic('nope').id).toBe(DEFAULT_HELP_TOPIC)
    expect(getHelpTopic(undefined).id).toBe(DEFAULT_HELP_TOPIC)
    expect(getHelpTopic('dating').id).toBe('dating')
  })

  it('points every tour step at a real help topic', () => {
    for (const step of TOUR_STEPS) if (step.helpTopic) expect(isHelpTopicId(step.helpTopic)).toBe(true)
  })
})

describe('parseHelpInline', () => {
  it('splits bold runs', () => {
    expect(parseHelpInline('Open **Cast** then **Worlds**.')).toEqual([
      { text: 'Open ', strong: false },
      { text: 'Cast', strong: true },
      { text: ' then ', strong: false },
      { text: 'Worlds', strong: true },
      { text: '.', strong: false },
    ])
  })

  it('leaves an unmatched marker as text', () => {
    expect(parseHelpInline('a ** b')).toEqual([{ text: 'a ** b', strong: false }])
    expect(parseHelpInline('')).toEqual([])
  })
})

describe('searchHelp', () => {
  it('returns nothing for an empty query', () => {
    expect(searchHelp('   ')).toEqual([])
  })

  it('finds sections by their text, case-insensitively', () => {
    const results = searchHelp('HIDE UI')
    expect(results.some((result) => result.topicId === 'visual-novel' && result.sectionId === 'vn-quick-menu')).toBe(true)
  })

  it('requires every word to match', () => {
    expect(searchHelp('backup restore').every((result) => result.topicId === 'settings')).toBe(true)
    expect(searchHelp('zzzz backup')).toEqual([])
  })

  it('lists topic-level matches before section matches', () => {
    const results = searchHelp('lorebook')
    expect(results[0].topicId).toBe('lore')
    expect(results[0].sectionId).toBeUndefined()
  })

  it('finds a topic through its keywords', () => {
    expect(searchHelp('persona').some((result) => result.topicId === 'cast')).toBe(true)
  })

  it('finds the merged player-card controls in Cast', () => {
    expect(searchHelp('you only').some((result) => result.topicId === 'cast')).toBe(true)
    expect(searchHelp('how others see you').some((result) => result.topicId === 'cast')).toBe(true)
  })
})
