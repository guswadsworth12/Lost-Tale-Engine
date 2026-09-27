/** Strips roleplay formatting that reads badly out loud — *actions*, stray markdown — before handing text to TTS. */
export function toSpeakableText(text: string, narrator = false): string {
  return (narrator ? text.replace(/(^|\n)\s*(?:Game Master|Narrator)\s*:\s*/gi, '$1') : text)
    .replace(/\*[^*]*\*/g, ' ')
    .replace(/[_~`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
