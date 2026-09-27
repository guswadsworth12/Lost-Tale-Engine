import { describe, expect, it } from 'vitest'
import { romancePromptPolicy } from './romanceEmphasis'

describe('romancePromptPolicy', () => {
  it('keeps the full dating-sim prompt stack, including anticipation before a scene', () => {
    const policy = romancePromptPolicy('focus', false)
    expect(policy).toMatchObject({ proactive: true, guards: true, scene: false, aftercare: true, intimacyOptions: true, intimacyContent: true, naturalGuidance: '' })
  })

  it('lets romance arise in story worlds without anticipating intimacy in ordinary scenes', () => {
    const policy = romancePromptPolicy('natural', false)
    expect(policy).toMatchObject({ proactive: false, guards: true, scene: false, aftercare: true, intimacyOptions: false, intimacyContent: false })
    expect(policy.naturalGuidance).toContain('do not steer an ordinary exchange toward dating or intimacy')
  })

  it('keeps intimate handling within active scenes in story worlds', () => {
    expect(romancePromptPolicy('natural', true)).toMatchObject({ proactive: false, guards: true, scene: true, aftercare: true, intimacyOptions: true, intimacyContent: true })
  })

  it('disables dating prompt guidance when the campaign has dating off', () => {
    expect(romancePromptPolicy('off', true)).toEqual({ proactive: false, guards: false, scene: false, aftercare: false, intimacyOptions: false, intimacyContent: false, naturalGuidance: '' })
  })
})
