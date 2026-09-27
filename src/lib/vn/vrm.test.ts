import { describe, expect, it } from 'vitest'
import { speakingMouth, vrmEmotionWeights } from './vrm'
import { DEFAULT_EXPRESSION_IDS } from './expressions'

describe('VRM expression mapping', () => {
  it('maps every default RP expression onto the VRM presets, neutral to rest', () => {
    for (const id of DEFAULT_EXPRESSION_IDS) {
      const weights = vrmEmotionWeights(id)
      expect(Object.keys(weights).sort()).toEqual(['angry', 'happy', 'relaxed', 'sad', 'surprised'])
      if (id !== 'neutral') expect(Object.values(weights).some((w) => w > 0), id).toBe(true)
    }
    expect(Object.values(vrmEmotionWeights('neutral')).every((w) => w === 0)).toBe(true)
    expect(vrmEmotionWeights('a-custom-one').happy).toBe(0)
  })

  it('only opens the mouth while speaking', () => {
    expect(speakingMouth(false, 1.2)).toBe(0)
    const samples = Array.from({ length: 50 }, (_, i) => speakingMouth(true, i / 10))
    expect(Math.max(...samples)).toBeGreaterThan(0.5)
    expect(samples.every((v) => v >= 0 && v <= 1)).toBe(true)
  })
})
