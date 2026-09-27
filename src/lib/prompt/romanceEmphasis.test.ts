import { describe, expect, it } from 'vitest'
import { romancePromptPolicy } from './romanceEmphasis'

describe('romancePromptPolicy', () => {
  it('keeps the full dating-sim prompt stack, including anticipation before a scene', () => {
    const policy = romancePromptPolicy('focus', false, false)
    expect(policy).toMatchObject({ proactive: true, intimacyOptions: true, intimacyContent: true, naturalGuidance: '' })
  })

  it('lets romance arise in story worlds without anticipating intimacy in ordinary scenes', () => {
    const policy = romancePromptPolicy('natural', false, false)
    expect(policy).toMatchObject({ proactive: false, intimacyOptions: false, intimacyContent: false })
    expect(policy.naturalGuidance).toContain('do not steer an ordinary exchange toward dating or intimacy')
  })

  it('keeps scene continuity and content guidance once intimacy is active, plus a content boundary after player escalation', () => {
    expect(romancePromptPolicy('natural', true, false)).toMatchObject({ proactive: false, intimacyOptions: true, intimacyContent: true })
    expect(romancePromptPolicy('natural', false, true)).toMatchObject({ proactive: false, intimacyOptions: false, intimacyContent: true })
    expect(romancePromptPolicy('natural', false, false, true)).toMatchObject({ proactive: false, intimacyOptions: false, intimacyContent: true })
  })

  it('disables dating prompt guidance when the campaign has dating off', () => {
    expect(romancePromptPolicy('off', true, true)).toEqual({ proactive: false, intimacyOptions: false, intimacyContent: false, naturalGuidance: '' })
  })
})
