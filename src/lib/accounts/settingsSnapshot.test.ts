import { describe, expect, it } from 'vitest'
import { SECRET_SETTING_KEYS } from '@/lib/accounts/contract'
import { inheritsLocalSettings, omitSecrets, settingsPatchFromServer, settingsSnapshot } from './settingsSnapshot'

const state = {
  colorMode: 'dark',
  chatBackendApiKey: 'sk-one',
  openMayhemApiKey: 'om-two',
  ttsApiKey: 'tts-three',
  imageBackendPassword: 'pw-four',
  imageBackendUsername: 'artist',
  sampler: { temperature: 0.9, top_p: 1 },
  themeTokensDark: { '--c-bg': '1 1 1', '--c-text': '2 2 2' },
  themeTokensLight: { '--c-bg': '9 9 9' },
  quickReplies: [{ id: 'a' }],
  setColorMode: () => {},
}

describe('settingsSnapshot', () => {
  it('drops every secret and every function', () => {
    const snap = settingsSnapshot(state)
    for (const key of SECRET_SETTING_KEYS) expect(snap).not.toHaveProperty(key)
    expect(snap).not.toHaveProperty('setColorMode')
    expect(snap).toMatchObject({ colorMode: 'dark', imageBackendUsername: 'artist', quickReplies: [{ id: 'a' }] })
    expect(JSON.stringify(snap)).not.toMatch(/sk-one|om-two|tts-three|pw-four/)
  })
})

describe('omitSecrets', () => {
  it('keeps everything but the secret fields', () => {
    const kept = omitSecrets(state)
    for (const key of SECRET_SETTING_KEYS) expect(kept).not.toHaveProperty(key)
    expect(kept.setColorMode).toBe(state.setColorMode)
    expect(kept.colorMode).toBe('dark')
  })
})

describe('settingsPatchFromServer', () => {
  it('replaces flat values and deep-merges the nested ones', () => {
    const patch = settingsPatchFromServer(
      { colorMode: 'light', sampler: { temperature: 0.5 }, themeTokensDark: { '--c-bg': '5 5 5' }, quickReplies: [] },
      state,
    )
    expect(patch.colorMode).toBe('light')
    expect(patch.sampler).toEqual({ temperature: 0.5, top_p: 1 })
    expect(patch.themeTokensDark).toEqual({ '--c-bg': '5 5 5', '--c-text': '2 2 2' })
    expect(patch.quickReplies).toEqual([])
    expect(patch).not.toHaveProperty('themeTokensLight')
  })

  it('never takes a secret, an unknown key, or a value over an action', () => {
    const patch = settingsPatchFromServer(
      { chatBackendApiKey: 'leak', ttsApiKey: 'leak', notASetting: 1, setColorMode: 'x' },
      state,
    )
    expect(patch).toEqual({})
  })

  it('ignores a non-object answer', () => {
    expect(settingsPatchFromServer(null, state)).toEqual({})
    expect(settingsPatchFromServer([1, 2], state)).toEqual({})
  })
})

describe('inheritsLocalSettings', () => {
  it('keeps preferences for the same user only', () => {
    expect(inheritsLocalSettings({ id: 'u1', role: 'member' }, 'u1')).toBe(true)
    expect(inheritsLocalSettings({ id: 'u2', role: 'owner' }, 'u1')).toBe(false)
  })

  it('hands a pre-accounts browser to the owner only', () => {
    expect(inheritsLocalSettings({ id: 'u1', role: 'owner' }, null)).toBe(true)
    expect(inheritsLocalSettings({ id: 'u2', role: 'member' }, null)).toBe(false)
  })
})
