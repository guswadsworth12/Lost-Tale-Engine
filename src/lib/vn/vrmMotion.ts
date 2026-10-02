import { vrmEmotionWeights } from './vrm'

export const VRM_MOTION_SLOTS = ['idle', 'speaking', 'happy', 'angry', 'sad', 'relaxed', 'surprised'] as const
export type VrmMotionSlot = typeof VRM_MOTION_SLOTS[number]
export type VrmMotions = Partial<Record<VrmMotionSlot, string>>

/** Speech takes priority; an expression-specific body motion is used when it is configured. */
export function selectVrmMotion(motions: VrmMotions | undefined, expression: string, speaking: boolean): VrmMotionSlot {
  if (speaking && motions?.speaking) return 'speaking'
  const weights = vrmEmotionWeights(expression)
  const emotion = (Object.keys(weights) as (keyof typeof weights)[])
    .filter((key) => weights[key] > 0 && motions?.[key])
    .sort((a, b) => weights[b] - weights[a])[0]
  return emotion ?? 'idle'
}
