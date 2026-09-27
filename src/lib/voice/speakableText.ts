/** Strips roleplay formatting that reads badly out loud — *actions*, stray markdown — before handing text to TTS. */
export function toSpeakableText(text: string, narrator = false): string {
  return (narrator ? text.replace(/(^|\n)\s*(?:Game Master|Narrator)\s*:\s*/gi, '$1') : text)
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/[_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keep local voice models from receiving a whole scene in one expensive request. */
export function splitSpeechText(text: string, maxLength = 120): string[] {
  const chunks: string[] = []
  let rest = text.trim()
  while (rest.length > maxLength) {
    const window = rest.slice(0, maxLength + 1)
    const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '))
    const space = window.lastIndexOf(' ')
    const end = sentence >= maxLength / 2 ? sentence + 1 : space > 0 ? space : maxLength
    chunks.push(rest.slice(0, end).trim())
    rest = rest.slice(end).trimStart()
  }
  if (rest) chunks.push(rest)
  return chunks
}
