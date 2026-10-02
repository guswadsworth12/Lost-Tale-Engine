import { describe, expect, it } from 'vitest'
import { selectVrmMotion, waveWeight } from './vrmMotion'

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
})
