import { vrmEmotionWeights } from './vrm'

export const VRM_MOTION_SLOTS = ['idle', 'speaking', 'happy', 'angry', 'sad', 'relaxed', 'surprised'] as const
export type VrmMotionSlot = typeof VRM_MOTION_SLOTS[number]
export type VrmMotions = Partial<Record<VrmMotionSlot, string>>

/** Ease a brief hand gesture in and out, returning to the clip or idle pose afterward. */
export function waveWeight(elapsed: number): number {
  return Math.max(0, Math.min(1, elapsed / 0.3, (2.6 - elapsed) / 0.4))
}

/** Speech takes priority; an expression-specific body motion is used when it is configured. */
export function selectVrmMotion(motions: VrmMotions | undefined, expression: string, speaking: boolean): VrmMotionSlot {
  if (speaking && motions?.speaking) return 'speaking'
  const weights = vrmEmotionWeights(expression)
  const emotion = (Object.keys(weights) as (keyof typeof weights)[])
    .filter((key) => weights[key] > 0 && motions?.[key])
    .sort((a, b) => weights[b] - weights[a])[0]
  return emotion ?? 'idle'
}

/**
 * Which way the arm bones turn for a model's VRM version. VRM 0.x and 1.0 face opposite ways, so
 * the same arm pose needs the opposite rotation: arms at the sides are +1.2 / -1.2 on a 0.x model
 * and -1.2 / +1.2 on a 1.0 model.
 */
export function vrmArmSign(metaVersion: string | undefined): 1 | -1 {
  return metaVersion === '0' ? 1 : -1
}

/** Upper-arm rotations (z) that rest the arms at the sides. */
export function restingArms(sign: 1 | -1): { left: number; right: number } {
  return { left: 1.2 * sign, right: -1.2 * sign }
}

/** The right arm's raised wave pose (z), `swing` being the forearm's back-and-forth. */
export function wavingRightArm(sign: 1 | -1, swing: number): { upper: number; lower: number } {
  return { upper: -0.8 * sign, lower: (2.7 + swing) * sign }
}
