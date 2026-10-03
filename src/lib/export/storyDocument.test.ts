import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import type { Chat, Story } from '@/lib/types'
import { storyAsDocx, storyAsMarkdown, storyAsText, storyBlocks, storyFilename, storyPrintHtml, type StoryPart } from './storyDocument'

const scene = (id: string, extra: Partial<Chat> = {}) =>
  ({ id, title: id, characterId: 'c', createdAt: 1, updatedAt: 1, storyId: 'st', ...extra }) as Chat

const a = scene('a', { sceneNumber: 1, endedAt: 2, recap: { text: 'They met.', presentIds: [], location: 'Inn', writtenAt: 2 } })
const b = scene('b', { sceneNumber: 2, chapterId: 'c2', chapterSceneNumber: 1, previousSceneId: 'a' })
const story: Pick<Story, 'chapters'> = { chapters: [
  { id: 'chapter-1', number: 1, startedAt: 1, endedAt: 2, recap: { text: 'Arc one.', sceneIds: ['a'], writtenAt: 2 } },
  { id: 'c2', number: 2, title: 'Low Tide', goal: 'Find the bell.', startedAt: 2 },
] }
const parts: StoryPart[] = [
  { scene: a, messages: [
    { role: 'char', name: 'Ann', text: '*She lifts the lamp.* "Come in." It creaks.' },
    { role: 'user', name: 'Bo', text: 'Fish & chips <3 *really*' },
    { role: 'char', name: 'Ann', text: '', failed: true },
  ] },
  { scene: b, messages: [{ role: 'char', name: 'Ann', text: 'first', swipes: ['first', 'second'], activeSwipe: 1 }] },
]

describe('a story laid out for export', () => {
  it('heads each chapter and scene, keeps recaps unless left out, and skips failed turns', () => {
    const blocks = storyBlocks('Night', parts, story)
    expect(blocks.map((x) => x.kind)).toEqual(['title', 'chapter', 'scene', 'line', 'line', 'chapter', 'scene', 'line'])
    expect(blocks[1]).toEqual({ kind: 'chapter', text: 'Chapter 1', recap: 'Arc one.' })
    expect(blocks[2]).toEqual({ kind: 'scene', text: 'Scene 1 · Inn', recap: 'They met.' })
    expect(blocks[5]).toMatchObject({ text: 'Chapter 2 · Low Tide', goal: 'Find the bell.' })
    // The active swipe is the one exported.
    expect(blocks[7]).toMatchObject({ speaker: 'Ann', segments: [{ type: 'text', content: 'second' }] })
    const bare = storyBlocks('Night', parts, story, { includeRecaps: false })
    expect(bare.some((x) => 'recap' in x)).toBe(false)
  })

  it('writes plain text with actions in asterisks', () => {
    const text = storyAsText(storyBlocks('Night', parts, story))
    expect(text).toContain('NIGHT\n\nChapter 1\n=========\nChapter recap: Arc one.')
    expect(text).toContain('Scene 1 · Inn\n-------------\nRecap: They met.')
    expect(text).toContain('Ann: *She lifts the lamp.* "Come in." It creaks.')
    expect(text).toContain('Bo: Fish & chips <3 *really*')
    expect(text).not.toMatch(/\n{3,}/)
  })

  it('writes Markdown with bold speakers and italic actions, escaping the rest', () => {
    const out = storyAsMarkdown(storyBlocks('Night', parts, story))
    expect(out).toContain('# Night\n\n## Chapter 1\n\n> Arc one.\n\n### Scene 1 · Inn\n\n> *Recap:* They met.')
    expect(out).toContain('**Ann:** *She lifts the lamp.* "Come in." It creaks.')
    expect(out).toContain('**Bo:** Fish & chips \\<3 *really*')
    expect(out).toContain('## Chapter 2 · Low Tide\n\n*Goal: Find the bell.*')
  })

  it('writes a Word document Word can open: the right parts, styles, and escaped text', () => {
    const files = unzipSync(storyAsDocx(storyBlocks('Night & Day', parts, story), new Date('2026-01-02T03:04:05.678Z')))
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'])
    const doc = strFromU8(files['word/document.xml'])
    expect(doc).toContain('<w:pStyle w:val="Title"/></w:pPr><w:r><w:t xml:space="preserve">Night &amp; Day</w:t></w:r>')
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>')
    expect(doc).toContain('<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">She lifts the lamp.</w:t></w:r>')
    expect(doc).toContain('Fish &amp; chips &lt;3 ')
    expect(doc).not.toMatch(/<w:t[^>]*>[^<]*[<>][^<]*<\/w:t>/)
    expect(strFromU8(files['docProps/core.xml'])).toContain('<dcterms:created xsi:type="dcterms:W3CDTF">2026-01-02T03:04:05Z</dcterms:created>')
  })

  it('makes a print page with each chapter on a new page and nothing unescaped', () => {
    const page = storyPrintHtml(storyBlocks('Night', parts, story))
    expect(page).toContain('<title>Night</title>')
    expect(page).toContain('break-before: page')
    expect(page).toContain('<span class="who you">Bo:</span> Fish &amp; chips &lt;3 <em>really</em>')
  })

  it('names the file after the story', () => {
    expect(storyFilename('Hollowmere Station', 'docx')).toBe('Hollowmere Station.docx')
    expect(storyFilename('Café: "Night"/2', 'md')).toBe('Café Night2.md')
    expect(storyFilename('???', 'txt')).toBe('story.txt')
  })
})
