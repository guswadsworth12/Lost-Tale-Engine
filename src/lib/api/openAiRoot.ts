/** The same /v1 root for text, embeddings and the opt-in local evaluation CLI. */
export function openAiRoot(url: string): string {
  const base = url.trim().replace(/\/+$/, '')
  try {
    const { pathname } = new URL(base)
    if (pathname === '' || pathname === '/') return `${base}/v1`
  } catch {
    // Not a full address: used as typed.
  }
  return base
}
