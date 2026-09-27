import { splitMessageSegments } from '@/lib/text/messageSegments'

/** Strips roleplay formatting that reads badly out loud — *actions*, stray markdown — before handing text to TTS. */
export function toSpeakableText(text: string, narrator = false): string {
  return (narrator ? text.replace(/(^|\n)\s*(?:Game Master|Narrator)\s*:\s*/gi, '$1') : text)
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/[_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface VoiceSegment {
  role: 'narrator' | 'character'
  text: string
}

/** Narration and action use the narrator voice; quoted speech uses the character's voice. */
export function splitVoiceSegments(text: string, narratorOnly = false): VoiceSegment[] {
  const segments: VoiceSegment[] = []
  const add = (role: VoiceSegment['role'], value: string) => {
    const clean = value.replace(/[*_~`#]/g, '').replace(/\s+/g, ' ').trim()
    if (!clean) return
    const last = segments[segments.length - 1]
    if (last?.role === role) last.text += ` ${clean}`
    else segments.push({ role, text: clean })
  }
  if (narratorOnly) {
    // GM judgment tags and no-op markers are engine notes, not story prose for TTS.
    const prose = text.replace(/(^|\n)\s*(?:Game Master|Narrator)\s*:\s*/gi, '$1').replace(/\[[^\]\n]*\]/g, ' ')
    add('narrator', prose)
    return segments
  }
  // Use the same parser that colors action and dialogue in the chat UI.
  for (const segment of splitMessageSegments(text, { disabled: true })) {
    add(segment.type === 'quote' ? 'character' : 'narrator',
      segment.type === 'quote' ? segment.content.slice(1, -1) : segment.content)
  }
  return segments
}

/** Keep local voice requests manageable without cutting ordinary dialogue in the middle of a phrase. */
export function splitSpeechText(text: string, maxLength = 280): string[] {
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > maxLength) {
    const sentenceEnds = [...rest.matchAll(/[.!?]+["”]?(?=\s|$)/g)].map((match) => match.index! + match[0].length)
    let end = 0
    for (const position of sentenceEnds) if (position <= maxLength) end = position
    // A slightly longer complete sentence sounds better than a short clip followed by a cut-off phrase.
    if (end < maxLength / 2) {
      end = sentenceEnds.find((position) => position > maxLength && position <= maxLength * 1.5) ?? end
    }
    if (!end) {
      for (const match of rest.slice(0, maxLength + 1).matchAll(/[,;:—](?=\s)/g)) end = match.index! + 1
      if (!end) end = rest.lastIndexOf(' ', maxLength)
    }
    if (end <= 0) end = rest.indexOf(' ', maxLength)
    if (end <= 0) end = rest.length
    chunks.push(rest.slice(0, end).trim())
    rest = rest.slice(end).trimStart()
  }
  if (rest) chunks.push(rest)
  return chunks
}
