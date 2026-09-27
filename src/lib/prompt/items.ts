export interface PromptItem {
  id: string
  name: string
  content: string
  role: 'system' | 'user' | 'assistant'
  enabled: boolean
  /** Imported rules and executable macros are kept for review, never run. */
  importWarning?: string
  source?: 'tavernai2'
}

/** Character items are assembled in author order. Imported code is never evaluated. */
export function renderPromptItems(items: PromptItem[] | undefined, role: PromptItem['role'] = 'system'): string {
  return (items ?? [])
    .filter((item) => item.role === role && item.enabled && !item.importWarning && item.content.trim())
    .map((item) => item.content.trim())
    .join('\n\n')
}
