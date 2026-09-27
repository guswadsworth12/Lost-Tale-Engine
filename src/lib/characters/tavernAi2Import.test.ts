import { describe, expect, it } from 'vitest'
import { parseTavernAi2Card } from './tavernAi2Import'

describe('parseTavernAi2Card', () => {
  it('keeps prompt tree order and disables imported executable or conditional items', () => {
    const parsed = parseTavernAi2Card({
      cards: [{ name: 'Ivo', promptManagerSetAssetId: 'set' }],
      promptManagerSets: [{ assetId: 'set', activePromptManagerAssetId: 'pm' }],
      promptManagers: [{ assetId: 'pm', items: [
        { assetId: 'b', itemType: 'prompt', name: 'Voice', content: 'Distinct voice', isEnabled: true },
        { assetId: 'a', itemType: 'prompt', name: 'Macro', content: '<% print(1) %>', isEnabled: true },
        { assetId: 'c', itemType: 'folder', name: 'Lore', content: '' },
      ] }],
      libraryTrees: [{ type: 'prompt_manager', ownerAssetId: 'pm', nodes: [
        { itemAssetId: 'a', order: 0 }, { itemAssetId: 'b', order: 1 }, { itemAssetId: 'c', order: 2 },
      ] }],
    })
    expect(parsed?.promptItems.map((item) => item.name)).toEqual(['Macro', 'Voice'])
    expect(parsed?.promptItems.map((item) => item.enabled)).toEqual([false, true])
    expect(parsed?.disabledCount).toBe(1)
  })
})
