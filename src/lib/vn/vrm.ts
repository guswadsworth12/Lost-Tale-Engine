/**
 * How RP's expression ids drive a VRM model's standard expression presets in VN mode. VRM 1.0 only
 * standardizes five emotions (happy, angry, sad, relaxed, surprised) plus visemes and blinks, so
 * RP's wider set is folded onto those at partial weights; `neutral` and unknown ids rest at zero.
 */

export type VrmEmotion = 'happy' | 'angry' | 'sad' | 'relaxed' | 'surprised'

const MAP: Record<string, Partial<Record<VrmEmotion, number>>> = {
  happy: { happy: 1 },
  laughing: { happy: 1 },
  smitten: { happy: 0.7, relaxed: 0.3 },
  love: { happy: 0.6, relaxed: 0.4 },
  blush: { happy: 0.4, relaxed: 0.3 },
  smirk: { happy: 0.4, relaxed: 0.4 },
  flirty: { happy: 0.5, relaxed: 0.5 },
  sultry: { relaxed: 0.8 },
  aroused: { relaxed: 0.7, surprised: 0.2 },
  relief: { relaxed: 1 },
  sleepy: { relaxed: 1 },
  yearning: { sad: 0.5, relaxed: 0.3 },
  sad: { sad: 1 },
  crying: { sad: 1 },
  pain: { sad: 0.6, angry: 0.4 },
  angry: { angry: 1 },
  annoyed: { angry: 0.6 },
  disgust: { angry: 0.5, sad: 0.2 },
  determined: { angry: 0.4 },
  surprised: { surprised: 1 },
  scared: { surprised: 0.7, sad: 0.3 },
  embarrassed: { surprised: 0.3, happy: 0.3 },
  confusion: { surprised: 0.4, sad: 0.2 },
  thinking: { relaxed: 0.2 },
}

export const VRM_EMOTIONS: VrmEmotion[] = ['happy', 'angry', 'sad', 'relaxed', 'surprised']

/** Target weight for each VRM emotion preset. Always returns all five so stale weights get cleared. */
export function vrmEmotionWeights(expressionId: string | undefined): Record<VrmEmotion, number> {
  const hit = MAP[expressionId ?? ''] ?? {}
  return Object.fromEntries(VRM_EMOTIONS.map((e) => [e, hit[e] ?? 0])) as Record<VrmEmotion, number>
}

/** Mouth-open viseme while speaking: a cheap two-frequency flap, 0 when silent. */
export function speakingMouth(speaking: boolean, t: number): number {
  if (!speaking) return 0
  return Math.max(0, Math.min(1, 0.45 + 0.35 * Math.sin(t * 17) + 0.2 * Math.sin(t * 7.3)))
}
