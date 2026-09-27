import type { PromptItem } from '@/lib/prompt/items'
import { newId } from '@/lib/id'

interface TavernItem {
  assetId?: string
  name?: string
  itemType?: string
  content?: string
  chatRolePlaceholder?: string
  isEnabled?: boolean
  hasRules?: boolean
  contentAction?: string
}

interface TavernPack {
  format?: string
  cards?: Array<{ name?: string; avatarImage?: string; avatarMimeType?: string; promptManagerSetAssetId?: string }>
  promptManagerSets?: Array<{ assetId?: string; activePromptManagerAssetId?: string }>
  promptManagers?: Array<{ assetId?: string; items?: TavernItem[] }>
  libraryTrees?: Array<{ type?: string; ownerAssetId?: string; nodes?: Array<{ itemAssetId?: string; order?: number }> }>
}

export interface TavernAi2CharacterImport {
  name: string
  avatarDataUrl?: string
  promptItems: PromptItem[]
  disabledCount: number
}

/** Extract text prompts and avatar from a TavernAI 2 card export; never execute pack code. */
export function parseTavernAi2Card(value: unknown): TavernAi2CharacterImport | null {
  if (!value || typeof value !== 'object') return null
  const pack = value as TavernPack
  if (!Array.isArray(pack.cards) || !Array.isArray(pack.promptManagers)) return null
  const card = pack.cards[0]
  if (!card || typeof card.name !== 'string' || !card.name.trim()) return null
  const set = pack.promptManagerSets?.find((entry) => entry.assetId === card.promptManagerSetAssetId)
  const manager = pack.promptManagers.find((entry) => entry.assetId === set?.activePromptManagerAssetId)
    ?? pack.promptManagers[0]
  if (!manager || !Array.isArray(manager.items)) return null

  const byId = new Map(manager.items.map((item) => [item.assetId, item]))
  const tree = pack.libraryTrees?.find((entry) => entry.type === 'prompt_manager' && entry.ownerAssetId === manager.assetId)
  const ordered = tree?.nodes?.length
    ? [...tree.nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((node) => byId.get(node.itemAssetId)).filter((item): item is TavernItem => !!item)
    : manager.items
  const promptItems = ordered
    .filter((item) => item.itemType === 'prompt')
    .map((item): PromptItem => {
      const content = typeof item.content === 'string' ? item.content : ''
      const reasons = [
        item.hasRules ? 'TavernAI activation rule needs review' : '',
        item.contentAction && item.contentAction !== 'insert' ? 'TavernAI replacement rule needs review' : '',
        /<%[%\s\S]*?%>/.test(content) ? 'TavernAI macro is not executed here' : '',
      ].filter(Boolean)
      const role = item.chatRolePlaceholder === 'user' ? 'user' : item.chatRolePlaceholder === 'ai' ? 'assistant' : 'system'
      return {
        id: newId(),
        name: item.name?.trim() || 'Prompt item',
        content,
        role,
        enabled: item.isEnabled !== false && reasons.length === 0,
        importWarning: reasons.length ? reasons.join('; ') : undefined,
        source: 'tavernai2',
      }
    })
  const avatarDataUrl = card.avatarImage && card.avatarMimeType?.startsWith('image/')
    ? `data:${card.avatarMimeType};base64,${card.avatarImage}`
    : undefined
  return { name: card.name, avatarDataUrl, promptItems, disabledCount: promptItems.filter((item) => !!item.importWarning).length }
}
