/**
 * Story moments: pictures of things that happened in a story, kept in the Gallery under the story,
 * chapter and scene they came from. A moment is made from a scene (and usually one message in
 * it), as a scene picture, a background for the location, or a portrait of someone present.
 *
 * Only relative `.ts` imports here: the server loads this file with plain Node.
 */

export type MomentKind = 'moment' | 'background' | 'portrait'
export const MOMENT_KINDS: MomentKind[] = ['moment', 'background', 'portrait']

export interface StoryMoment {
  id: string
  /** The story the scene belongs to, or the scene's own id when it stands alone. */
  storyId: string
  /** The scene (chat) it came from. */
  chatId: string
  messageId?: string
  chapterId?: string
  /** Who is in it. */
  characterIds: string[]
  kind: MomentKind
  caption: string
  prompt: string
  imageUrl: string
  /** The account that made it. */
  createdBy?: string
  createdAt: number
}

export interface MomentInput {
  kind: MomentKind
  caption: string
  prompt: string
  messageId?: string
  characterIds: string[]
  /** A `data:` image, written to disk by the server. */
  image: string
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** A new moment from a request, or why it can't be saved. */
export function normalizeMomentInput(raw: unknown): { value?: MomentInput; error?: string } {
  const v = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  const kind = MOMENT_KINDS.find((k) => k === v.kind)
  if (!kind) return { error: 'Say what kind of picture this is: a moment, a background, or a portrait.' }
  if (typeof v.image !== 'string' || !/^data:image\/[\w+.-]+;base64,/.test(v.image)) return { error: 'A moment needs its picture.' }
  const messageId = text(v.messageId, 100)
  const characterIds = Array.isArray(v.characterIds) ? [...new Set(v.characterIds.filter((id): id is string => typeof id === 'string' && !!id && id.length <= 100))].slice(0, 20) : []
  return { value: { kind, caption: text(v.caption, 200), prompt: text(v.prompt, 4000), ...(messageId ? { messageId } : {}), characterIds, image: v.image } }
}

// ---- Drafting the prompt -------------------------------------------------------------------------

/** One line of the story picked as a key moment to picture. */
export interface MomentLine {
  speaker?: string
  text: string
}

/** A line as it reads in the story: without GM labels (`[Set event …]`) or out-of-character notes (`{…}`). */
export function momentText(text: string): string {
  return text.replace(/\[[^\]\n]*\]/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim()
}

export interface MomentDraftInput {
  kind: MomentKind
  /** The key moments being pictured, in story order. */
  moments?: MomentLine[]
  location?: string
  timeOfDay?: string
  /** Who is there, with how they look now (outfit, form). */
  characters: { name: string; appearance?: string }[]
  /** For a portrait: whose. */
  subject?: string
  /** The world's art style, when it has one. */
  artStyle?: string
}

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value)

/**
 * The prompt the "Picture this" dialog opens with, written from the scene without a model call.
 * The writer edits it, or asks the story model to improve it.
 */
export function draftMomentPrompt(input: MomentDraftInput): string {
  const where = [input.location, input.timeOfDay].filter(Boolean).join(', ')
  // "at the pier, night", or just ", night" when the place isn't known.
  const at = input.location ? ` at ${where}` : input.timeOfDay ? `, ${input.timeOfDay}` : ''
  const look = (c: { name: string; appearance?: string }) => (c.appearance ? `${c.name} (${clip(c.appearance.replace(/\s+/g, ' ').trim(), 160)})` : c.name)
  const style = input.artStyle?.trim() ? `${input.artStyle.trim()}.` : 'Illustration, cinematic lighting, no text.'
  if (input.kind === 'background') {
    return [`Scenery of ${input.location || 'the place where this scene happens'}${input.timeOfDay ? `, ${input.timeOfDay}` : ''}, no people.`, style].join(' ')
  }
  if (input.kind === 'portrait') {
    const subject = input.characters.find((c) => c.name === input.subject) ?? input.characters[0]
    return [`Portrait of ${subject ? look(subject) : 'the character'}${where ? `, ${where}` : ''}.`, style].join(' ')
  }
  const lines = (input.moments ?? []).map((m) => ({ ...m, text: momentText(m.text) })).filter((m) => m.text)
  const said = (m: MomentLine, max: number) => `${m.speaker ? `${m.speaker}: ` : ''}${clip(m.text, max)}`
  return [
    input.characters.length ? `${input.characters.map(look).join(' and ')}${at}.` : where ? `${where}.` : '',
    lines.length === 1 ? `The moment: ${said(lines[0], 320)}` : '',
    lines.length > 1 ? `The moments, in order: ${lines.map((m) => said(m, Math.max(80, Math.floor(720 / lines.length)))).join(' / ')}` : '',
    style,
  ].filter(Boolean).join(' ')
}

/** What the story model can draw on beyond the draft: the key moments picked, and how the people in them look. */
export interface MomentContext {
  moments?: MomentLine[]
  /** Who is in the picture, from their own cards (`cardBrief`). */
  cards?: { name: string; card: string }[]
}

/**
 * Asks the story model to turn the draft into a better image prompt, keeping every fact in it. With
 * key moments picked, it writes one picture from them; with cards, it takes people's looks from those.
 */
export function buildImprovePromptRequest(draft: string, kind: MomentKind, context: MomentContext = {}): string {
  const moments = (context.moments ?? []).map((m) => ({ ...m, text: momentText(m.text) })).filter((m) => m.text)
  const cards = (context.cards ?? []).filter((c) => c.card.trim())
  return [
    `${moments.length ? 'Write' : 'Rewrite this into'} a strong prompt for an image generator making a ${kind === 'moment' ? 'wide story illustration' : kind === 'background' ? 'wide scenery background with no people' : 'tall character portrait'}.`,
    moments.length
      ? `The story moments to picture, in order:\n${moments.map((m) => `- ${m.speaker ? `${m.speaker}: ` : ''}${clip(m.text, 600)}`).join('\n')}\nMake one picture of them: the single instant that shows them best, unless they plainly belong in one frame.`
      : '',
    cards.length ? `How the people in it look, from their character cards (take only what can be seen):\n${cards.map((c) => `- ${c.name}: ${clip(c.card.replace(/\s+/g, ' '), 600)}`).join('\n')}` : '',
    `Keep every name, appearance detail, place and action in the draft${moments.length || cards.length ? ', and draw only on the moments and cards above' : ''}; invent nothing else. One paragraph of concrete visual description: subject, composition, setting, lighting, mood, style. No text or lettering in the image.`,
    `Draft:\n${draft}`,
    'Reply with only the new prompt.',
  ].filter(Boolean).join('\n\n')
}

// ---- The Gallery ----------------------------------------------------------------------------------

export interface MomentGroup {
  storyId: string
  storyTitle: string
  chapters: { chapterId: string; label: string; scenes: { chatId: string; label: string; moments: StoryMoment[] }[] }[]
}

/**
 * Moments grouped Story → Chapter → Scene for the Gallery: stories newest first, chapters and
 * scenes in story order, moments oldest first within a scene.
 */
export function groupMoments(
  moments: readonly StoryMoment[],
  describe: {
    story: (storyId: string) => string
    /** A scene's chapter (id and label) and its own label and order. */
    scene: (chatId: string) => { chapterId: string; chapterLabel: string; chapterNumber: number; label: string; order: number } | undefined
  },
): MomentGroup[] {
  const byStory = new Map<string, StoryMoment[]>()
  for (const m of moments) byStory.set(m.storyId, [...(byStory.get(m.storyId) ?? []), m])
  return [...byStory.entries()]
    .sort(([, a], [, b]) => Math.max(...b.map((m) => m.createdAt)) - Math.max(...a.map((m) => m.createdAt)))
    .map(([storyId, list]) => {
      const chapters = new Map<string, { chapterId: string; label: string; number: number; scenes: Map<string, { chatId: string; label: string; order: number; moments: StoryMoment[] }> }>()
      for (const m of list) {
        const scene = describe.scene(m.chatId) ?? { chapterId: m.chapterId ?? 'chapter-1', chapterLabel: 'Chapter 1', chapterNumber: 1, label: 'Scene', order: 0 }
        const chapter = chapters.get(scene.chapterId) ?? { chapterId: scene.chapterId, label: scene.chapterLabel, number: scene.chapterNumber, scenes: new Map() }
        const entry = chapter.scenes.get(m.chatId) ?? { chatId: m.chatId, label: scene.label, order: scene.order, moments: [] }
        entry.moments.push(m)
        chapter.scenes.set(m.chatId, entry)
        chapters.set(scene.chapterId, chapter)
      }
      return {
        storyId,
        storyTitle: describe.story(storyId),
        chapters: [...chapters.values()].sort((a, b) => a.number - b.number).map((c) => ({
          chapterId: c.chapterId,
          label: c.label,
          scenes: [...c.scenes.values()].sort((a, b) => a.order - b.order).map((s) => ({ chatId: s.chatId, label: s.label, moments: [...s.moments].sort((a, b) => a.createdAt - b.createdAt) })),
        })),
      }
    })
}
