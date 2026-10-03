import { strToU8, zipSync } from 'fflate'
import type { Chat, StoredMessage, Story } from '@/lib/types'
import { chapterIdOf, chapterLabel, chaptersOf } from '@/lib/story/chapters'
import { sceneLabel } from '@/lib/story/recaps'
import { messageDisplayText, sceneLocation } from '@/lib/story/library'
import { splitMessageSegments, type MessageSegment } from '@/lib/text/messageSegments'

/**
 * A story laid out once as headings and lines, then written out in the formats people share
 * stories in: plain text, Markdown (Reddit, Discord, forums), Word (.docx), and a print page for
 * PDF. Pure apart from the download and print helpers at the end.
 */

export type StoryBlock =
  | { kind: 'title'; text: string }
  | { kind: 'chapter'; text: string; goal?: string; recap?: string }
  | { kind: 'scene'; text: string; recap?: string }
  | { kind: 'line'; speaker: string; player: boolean; segments: MessageSegment[] }

export interface StoryPart {
  scene: Chat
  messages: Pick<StoredMessage, 'role' | 'name' | 'text' | 'swipes' | 'activeSwipe' | 'failed'>[]
}

/** The story as blocks, in reading order. `includeRecaps: false` leaves out scene and chapter recaps. */
export function storyBlocks(title: string, parts: StoryPart[], story?: Pick<Story, 'chapters'>, opts?: { includeRecaps?: boolean }): StoryBlock[] {
  const includeRecaps = opts?.includeRecaps ?? true
  const chapters = story?.chapters?.length ? chaptersOf(story, parts.map((p) => p.scene)) : []
  const blocks: StoryBlock[] = [{ kind: 'title', text: title }]
  let lastChapter = ''
  for (const { scene, messages } of parts) {
    const chapter = chapters.find((c) => c.id === chapterIdOf(scene))
    if (chapter && chapter.id !== lastChapter) {
      lastChapter = chapter.id
      blocks.push({
        kind: 'chapter',
        text: chapterLabel(chapter),
        ...(chapter.goal?.trim() ? { goal: chapter.goal.trim() } : {}),
        ...(includeRecaps && chapter.recap?.text.trim() ? { recap: chapter.recap.text.trim() } : {}),
      })
    }
    const where = sceneLocation(scene)
    const recap = includeRecaps ? scene.recap?.text?.trim() : undefined
    blocks.push({ kind: 'scene', text: where ? `${sceneLabel(scene)} · ${where}` : sceneLabel(scene), ...(recap ? { recap } : {}) })
    for (const m of messages) {
      const text = messageDisplayText(m)
      if (!text) continue
      blocks.push({ kind: 'line', speaker: m.name, player: m.role === 'user', segments: splitMessageSegments(text) })
    }
  }
  return blocks
}

const plain = (segments: MessageSegment[]) => segments.map((s) => (s.type === 'action' ? `*${s.content}*` : s.content)).join('').trim()

/** Plain text: actions keep their *asterisks*, as they were written. */
export function storyAsText(blocks: StoryBlock[]): string {
  const out: string[] = []
  for (const b of blocks) {
    if (b.kind === 'title') out.push(b.text.toUpperCase(), '')
    else if (b.kind === 'chapter') out.push('', b.text, '='.repeat(b.text.length), ...(b.goal ? [`Goal: ${b.goal}`] : []), ...(b.recap ? [`Chapter recap: ${b.recap}`] : []), '')
    else if (b.kind === 'scene') out.push('', b.text, '-'.repeat(b.text.length), ...(b.recap ? [`Recap: ${b.recap}`, ''] : []))
    else out.push(`${b.speaker}: ${plain(b.segments)}`, '')
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

/** Escapes what Markdown would otherwise read as formatting, so prose stays prose. */
function md(text: string): string {
  return text.replace(/([\\`*_[\]#<>|~])/g, '\\$1')
}

function mdSegments(segments: MessageSegment[]): string {
  return segments.map((s) => {
    const content = s.type === 'text' ? s.content : s.content.trim()
    if (!content) return s.content
    if (s.type === 'action') return `*${md(content)}*`
    if (s.type === 'sfx') return `**${md(content)}**`
    return md(s.content)
  }).join('').trim()
}

/** Markdown for Reddit, Discord, and forums: speaker in bold, actions in italics. */
export function storyAsMarkdown(blocks: StoryBlock[]): string {
  const out: string[] = []
  for (const b of blocks) {
    if (b.kind === 'title') out.push(`# ${md(b.text)}`)
    else if (b.kind === 'chapter') out.push(`## ${md(b.text)}`, ...(b.goal ? [`*Goal: ${md(b.goal)}*`] : []), ...(b.recap ? [`> ${md(b.recap)}`] : []))
    else if (b.kind === 'scene') out.push(`### ${md(b.text)}`, ...(b.recap ? [`> *Recap:* ${md(b.recap)}`] : []))
    else out.push(`**${md(b.speaker)}:** ${mdSegments(b.segments)}`)
  }
  return `${out.join('\n\n')}\n`
}

// ---- Word (.docx) ----

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function run(text: string, style: { bold?: boolean; italic?: boolean; color?: string } = {}): string {
  if (!text) return ''
  const props = [style.bold ? '<w:b/>' : '', style.italic ? '<w:i/>' : '', style.color ? `<w:color w:val="${style.color}"/>` : ''].join('')
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`
}

function para(runs: string, style?: string): string {
  return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${runs}</w:p>`
}

function docxBody(blocks: StoryBlock[]): string {
  const out: string[] = []
  for (const b of blocks) {
    if (b.kind === 'title') out.push(para(run(b.text), 'Title'))
    else if (b.kind === 'chapter') {
      out.push(para(run(b.text), 'Heading1'))
      if (b.goal) out.push(para(run(`Goal: ${b.goal}`, { italic: true, color: '666666' })))
      if (b.recap) out.push(para(run('Chapter recap: ', { bold: true, color: '666666' }) + run(b.recap, { color: '666666' }), 'Recap'))
    } else if (b.kind === 'scene') {
      out.push(para(run(b.text), 'Heading2'))
      if (b.recap) out.push(para(run('Recap: ', { bold: true, color: '666666' }) + run(b.recap, { color: '666666' }), 'Recap'))
    } else {
      const speaker = run(`${b.speaker}: `, { bold: true, ...(b.player ? { color: '2F7F6F' } : {}) })
      const body = b.segments.map((s) => run(s.content, { italic: s.type === 'action', bold: s.type === 'sfx' })).join('')
      out.push(para(speaker + body))
    }
  }
  return out.join('')
}

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia" w:eastAsia="Georgia"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:after="480"/></w:pPr><w:rPr><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="240" w:after="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Recap"><w:name w:val="Recap"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:left="360"/></w:pPr><w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>
</w:styles>`

/** A Word document (.docx): title, a page per chapter, scene headings, speakers in bold and actions in italics. */
export function storyAsDocx(blocks: StoryBlock[], now = new Date()): Uint8Array {
  const title = blocks.find((b) => b.kind === 'title')?.text ?? 'Story'
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'word/styles.xml': strToU8(DOCX_STYLES),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${docxBody(blocks)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Lost Tales Engine</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`),
  }
  return zipSync(files)
}

// ---- Print (PDF) ----

function html(text: string): string {
  return xml(text).replace(/'/g, '&#39;')
}

/** A self-contained, book-like page to print or save as PDF from the browser's print dialog. */
export function storyPrintHtml(blocks: StoryBlock[]): string {
  const title = blocks.find((b) => b.kind === 'title')?.text ?? 'Story'
  const body = blocks.map((b) => {
    if (b.kind === 'title') return `<h1>${html(b.text)}</h1>`
    if (b.kind === 'chapter') return `<h2>${html(b.text)}</h2>${b.goal ? `<p class="goal">Goal: ${html(b.goal)}</p>` : ''}${b.recap ? `<p class="recap"><b>Chapter recap:</b> ${html(b.recap)}</p>` : ''}`
    if (b.kind === 'scene') return `<h3>${html(b.text)}</h3>${b.recap ? `<p class="recap"><b>Recap:</b> ${html(b.recap)}</p>` : ''}`
    const segs = b.segments.map((s) => (s.type === 'action' ? `<em>${html(s.content)}</em>` : s.type === 'sfx' ? `<b>${html(s.content)}</b>` : html(s.content))).join('')
    return `<p class="line"><span class="who${b.player ? ' you' : ''}">${html(b.speaker)}:</span> ${segs}</p>`
  }).join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${html(title)}</title>
<style>
@page { margin: 2cm; }
body { font-family: Georgia, 'Times New Roman', serif; font-size: 11.5pt; line-height: 1.55; color: #111; max-width: 42em; margin: 0 auto; }
h1 { text-align: center; font-size: 24pt; font-weight: normal; margin: 1.5em 0 1.5em; }
h2 { font-size: 17pt; margin: 0 0 .6em; break-before: page; }
h1 + h2 { break-before: avoid; }
h3 { font-size: 13pt; margin: 1.6em 0 .6em; break-after: avoid; }
p { margin: 0 0 .7em; }
.line { orphans: 3; widows: 3; }
.who { font-weight: bold; }
.who.you { color: #2f7f6f; }
.goal { font-style: italic; color: #555; }
.recap { font-size: 10pt; color: #555; border-left: 2px solid #ccc; padding-left: .8em; }
</style></head><body>
${body}
</body></html>`
}

// ---- Saving ----

export type StoryExportFormat = 'txt' | 'md' | 'docx'

const MIME: Record<StoryExportFormat, string> = {
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** A filename from the story's title: letters, digits, spaces, dashes and underscores. */
export function storyFilename(title: string, format: StoryExportFormat): string {
  const safe = (title || 'story').replace(/[^\p{L}\p{N}\-_ ]/gu, '').replace(/\s+/g, ' ').trim() || 'story'
  return `${safe}.${format}`
}

export function storyFile(blocks: StoryBlock[], format: StoryExportFormat): Blob {
  const data = format === 'txt' ? storyAsText(blocks) : format === 'md' ? storyAsMarkdown(blocks) : storyAsDocx(blocks)
  return new Blob([data as BlobPart], { type: MIME[format] })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Opens the browser's print dialog on the story, from a hidden frame so no pop-up is needed; the
 * dialog's "Save as PDF" makes the PDF. Every script and emoji the browser can show prints too.
 */
export function printStory(blocks: StoryBlock[]): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const doc = frame.contentWindow?.document
  if (!doc || !frame.contentWindow) {
    frame.remove()
    throw new Error('Printing is not available here.')
  }
  doc.open()
  doc.write(storyPrintHtml(blocks))
  doc.close()
  const win = frame.contentWindow
  const cleanUp = () => setTimeout(() => frame.remove(), 1000)
  win.addEventListener('afterprint', cleanUp, { once: true })
  // Give the frame a moment to lay out (fonts) before the dialog opens.
  setTimeout(() => {
    win.focus()
    win.print()
    // Browsers that never fire afterprint still get the frame removed eventually.
    setTimeout(() => frame.isConnected && frame.remove(), 60_000)
  }, 250)
}
