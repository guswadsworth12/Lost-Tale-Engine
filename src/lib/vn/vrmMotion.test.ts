import { describe, expect, it } from 'vitest'
import { restingArms, selectVrmMotion, vrmArmSign, waveWeight, wavingRightArm } from './vrmMotion'

describe('VRM body motion selection', () => {
  const motions = { idle: '/idle.vrma', speaking: '/speaking.vrma', happy: '/happy.vrma' }

  it('uses speech over emotion, an available emotion over idle, and idle for missing clips', () => {
    expect(selectVrmMotion(motions, 'happy', true)).toBe('speaking')
    expect(selectVrmMotion(motions, 'laughing', false)).toBe('happy')
    expect(selectVrmMotion(motions, 'angry', false)).toBe('idle')
    expect(selectVrmMotion(undefined, 'happy', true)).toBe('idle')
    expect(selectVrmMotion({ angry: '/angry.vrma', sad: '/sad.vrma' }, 'pain', false)).toBe('sad')
  })

  it('eases a wave in and back to the base pose', () => {
    expect(waveWeight(-1)).toBe(0)
    expect(waveWeight(0)).toBe(0)
    expect(waveWeight(0.3)).toBe(1)
    expect(waveWeight(2.4)).toBeGreaterThan(0)
    expect(waveWeight(2.6)).toBe(0)
  })

  it('turns the arms the right way for VRM 0.x and 1.0 models, which face opposite ways', () => {
    expect(vrmArmSign('0')).toBe(1)
    expect(vrmArmSign('1')).toBe(-1)
    // A model whose version can't be read is treated as current VRM (1.0).
    expect(vrmArmSign(undefined)).toBe(-1)
    expect(restingArms(1)).toEqual({ left: 1.2, right: -1.2 })
    expect(restingArms(-1)).toEqual({ left: -1.2, right: 1.2 })
    expect(wavingRightArm(1, 0)).toEqual({ upper: -0.8, lower: 2.7 })
    const raised = wavingRightArm(-1, 0.2)
    expect(raised.upper).toBeCloseTo(0.8)
    expect(raised.lower).toBeCloseTo(-2.9)
  })
})
