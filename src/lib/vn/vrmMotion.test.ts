import { describe, expect, it } from 'vitest'
import { selectVrmMotion } from './vrmMotion'

describe('VRM body motion selection', () => {
  const motions = { idle: '/idle.vrma', speaking: '/speaking.vrma', happy: '/happy.vrma' }

  it('uses speech over emotion, an available emotion over idle, and idle for missing clips', () => {
    expect(selectVrmMotion(motions, 'happy', true)).toBe('speaking')
    expect(selectVrmMotion(motions, 'laughing', false)).toBe('happy')
    expect(selectVrmMotion(motions, 'angry', false)).toBe('idle')
    expect(selectVrmMotion(undefined, 'happy', true)).toBe('idle')
    expect(selectVrmMotion({ angry: '/angry.vrma', sad: '/sad.vrma' }, 'pain', false)).toBe('sad')
  })
})
