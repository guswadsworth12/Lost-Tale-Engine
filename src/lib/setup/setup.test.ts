import { describe, expect, it } from 'vitest'
import { NEW_SETUP, checklist, nextStep, previousStep, remaining, resumeStep, shouldShowWizard, withSkipped, type SetupFacts } from './setup'

const nothing: SetupFacts = { textReady: false, voiceReady: false, imagesReady: false, hasStory: false }

describe('the setup wizard', () => {
  it('opens by itself only for an account that never finished or put it off, and has no stories', () => {
    expect(shouldShowWizard(undefined, 0)).toBe(true)
    expect(shouldShowWizard(NEW_SETUP, 0)).toBe(true)
    expect(shouldShowWizard({ ...NEW_SETUP, status: 'active' }, 0)).toBe(true)
    expect(shouldShowWizard({ ...NEW_SETUP, status: 'dismissed' }, 0)).toBe(false)
    expect(shouldShowWizard({ ...NEW_SETUP, status: 'done' }, 0)).toBe(false)
    // Someone already playing is never interrupted.
    expect(shouldShowWizard(NEW_SETUP, 3)).toBe(false)
  })

  it('ticks a step when what it sets up exists, however it got there', () => {
    const items = checklist({ ...nothing, textReady: true, hasStory: true }, NEW_SETUP)
    expect(items.map((i) => [i.step.id, i.state])).toEqual([['text', 'done'], ['voice', 'todo'], ['images', 'todo'], ['story', 'done']])
    expect(remaining({ ...nothing, textReady: true, hasStory: true }, NEW_SETUP)).toBe(2)
  })

  it('lets optional steps be skipped, but never the Text model', () => {
    const skipped = withSkipped(withSkipped(NEW_SETUP, 'voice', true), 'text', true)
    const states = Object.fromEntries(checklist(nothing, skipped).map((i) => [i.step.id, i.state]))
    expect(states).toMatchObject({ voice: 'skipped', text: 'todo' })
    // Doing a skipped step another way still counts as done.
    expect(checklist({ ...nothing, voiceReady: true }, skipped).find((i) => i.step.id === 'voice')?.state).toBe('done')
    expect(withSkipped(skipped, 'voice', false).skipped).toEqual(['text'])
  })

  it('picks up at the welcome the first time, then at the first step still to do', () => {
    expect(resumeStep(nothing, NEW_SETUP)).toBe('welcome')
    const active = { ...NEW_SETUP, status: 'active' as const }
    expect(resumeStep(nothing, active)).toBe('text')
    expect(resumeStep({ ...nothing, textReady: true }, withSkipped(active, 'voice', true))).toBe('images')
    expect(resumeStep({ textReady: true, voiceReady: true, imagesReady: true, hasStory: true }, active)).toBe('story')
  })

  it('walks the steps in order', () => {
    expect(nextStep('welcome')).toBe('text')
    expect(nextStep('images')).toBe('story')
    expect(nextStep('story')).toBeUndefined()
    expect(previousStep('welcome')).toBeUndefined()
    expect(previousStep('voice')).toBe('text')
  })

  it('gives owners an optional Invite players step before the first story, and members never see it', () => {
    const owner = { ...nothing, isOwner: true }
    expect(checklist(owner, NEW_SETUP).map((i) => i.step.id)).toEqual(['text', 'voice', 'images', 'invite', 'story'])
    expect(checklist(nothing, NEW_SETUP).map((i) => i.step.id)).not.toContain('invite')
    expect(nextStep('images', owner)).toBe('invite')
    expect(nextStep('invite', owner)).toBe('story')
    expect(previousStep('story', owner)).toBe('invite')
    expect(nextStep('images', nothing)).toBe('story')
    // Done once anyone else has an account; skippable like any optional step.
    expect(checklist({ ...owner, hasOtherUsers: true }, NEW_SETUP).find((i) => i.step.id === 'invite')?.state).toBe('done')
    expect(checklist(owner, withSkipped(NEW_SETUP, 'invite', true)).find((i) => i.step.id === 'invite')?.state).toBe('skipped')
  })
})
