import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The settings store persists to localStorage; give it one before it loads (the test env is node).
const storage = vi.hoisted(() => {
  const data = new Map<string, string>()
  const mock = {
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() { return data.size },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true })
  return data
})

import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { changeChatBackendConfig, hasSecret, migrateLocalSecrets, secretsApi } from './secrets'

type Call = { url: string; method: string; body?: { value?: string } }
let calls: Call[]
let failFor: Set<string>

function persisted(): Record<string, unknown> {
  return JSON.parse(storage.get('rp-settings') ?? '{}').state ?? {}
}

beforeEach(() => {
  calls = []
  failFor = new Set()
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const call: Call = { url, method, body: init.body ? JSON.parse(String(init.body)) : undefined }
    calls.push(call)
    const name = url.split('/').pop()!
    if (failFor.has(name)) return new Response(JSON.stringify({ error: 'nope' }), { status: 500 })
    if (method === 'GET') return new Response(JSON.stringify([]), { status: 200 })
    return new Response(null, { status: 204 })
  }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  useSettingsStore.setState({
    chatBackend: 'openai-compatible',
    chatBackendBaseUrl: 'https://api.example.com/v1',
    chatBackendApiKey: '',
    openMayhemApiKey: '',
    ttsApiKey: '',
    imageBackend: 'a1111',
    imageBackendUsername: '',
    imageBackendPassword: '',
  })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const puts = () => calls.filter((c) => c.method === 'PUT')

describe('migrateLocalSecrets', () => {
  it('uploads every non-empty key, then blanks them in the store and in saved browser settings', async () => {
    useSettingsStore.setState({ chatBackendApiKey: ' sk-chat ', ttsApiKey: 'tts-key', imageBackendPassword: 'a1111-pass' })
    // A key only the persisted copy still holds (e.g. written by an older tab) moves too.
    storage.set('rp-settings', JSON.stringify({ state: { ...persisted(), openMayhemApiKey: 'om-key' }, version: 0 }))

    await migrateLocalSecrets()

    expect(puts().map((c) => [c.url, c.body?.value])).toEqual([
      ['/api/me/secrets/chatBackendApiKey', 'sk-chat'],
      ['/api/me/secrets/openMayhemApiKey', 'om-key'],
      ['/api/me/secrets/ttsApiKey', 'tts-key'],
      ['/api/me/secrets/imageBackendPassword', 'a1111-pass'],
    ])
    const s = useSettingsStore.getState()
    expect([s.chatBackendApiKey, s.openMayhemApiKey, s.ttsApiKey, s.imageBackendPassword]).toEqual(['', '', '', ''])
    const p = persisted()
    expect([p.chatBackendApiKey, p.openMayhemApiKey, p.ttsApiKey, p.imageBackendPassword]).toEqual(['', '', '', ''])
    expect(hasSecret('chatBackendApiKey')).toBe(true)
  })

  it('is idempotent: nothing left to move means no requests', async () => {
    useSettingsStore.setState({ chatBackendApiKey: 'sk-chat' })
    await migrateLocalSecrets()
    calls = []
    await migrateLocalSecrets()
    expect(calls).toEqual([])
  })

  it('keeps a key locally when its upload fails, and never throws', async () => {
    useSettingsStore.setState({ chatBackendApiKey: 'sk-chat', ttsApiKey: 'tts-key' })
    storage.set('rp-settings', JSON.stringify({ state: { ...persisted(), ttsApiKey: 'tts-key' }, version: 0 }))
    failFor.add('ttsApiKey')
    await expect(migrateLocalSecrets()).resolves.toBeUndefined()
    expect(useSettingsStore.getState().chatBackendApiKey).toBe('')
    expect(useSettingsStore.getState().ttsApiKey).toBe('tts-key')
    expect(persisted().ttsApiKey).toBe('tts-key')
    expect(console.warn).toHaveBeenCalled()
  })

  it('never throws when the server is unreachable', async () => {
    useSettingsStore.setState({ chatBackendApiKey: 'sk-chat' })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))
    await expect(migrateLocalSecrets()).resolves.toBeUndefined()
    expect(useSettingsStore.getState().chatBackendApiKey).toBe('sk-chat')
  })

  it("moves NovelAI image generation's key out of the username field into the image password credential", async () => {
    useSettingsStore.setState({ imageBackend: 'novelai-image', imageBackendUsername: 'nai-key' })
    await migrateLocalSecrets()
    expect(puts().map((c) => [c.url, c.body?.value])).toEqual([['/api/me/secrets/imageBackendPassword', 'nai-key']])
    expect(useSettingsStore.getState().imageBackendUsername).toBe('')
    expect(persisted().imageBackendUsername).toBe('')
  })

  it("leaves A1111's username alone: it isn't a secret", async () => {
    useSettingsStore.setState({ imageBackend: 'a1111', imageBackendUsername: 'user', imageBackendPassword: 'pass' })
    await migrateLocalSecrets()
    expect(puts().map((c) => c.url)).toEqual(['/api/me/secrets/imageBackendPassword'])
    expect(useSettingsStore.getState().imageBackendUsername).toBe('user')
  })
})

describe('secretsApi', () => {
  it('lists, sets and removes by name, never reading a value back', async () => {
    await secretsApi.set('ttsApiKey', 'v')
    await secretsApi.remove('ttsApiKey')
    await secretsApi.list()
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ['PUT', '/api/me/secrets/ttsApiKey'],
      ['DELETE', '/api/me/secrets/ttsApiKey'],
      ['GET', '/api/me/secrets'],
    ])
    expect(calls[0].body).toEqual({ value: 'v' })
  })

  it('surfaces the server error message', async () => {
    failFor.add('ttsApiKey')
    await expect(secretsApi.set('ttsApiKey', 'v')).rejects.toThrow('nope')
  })
})

describe('changeChatBackendConfig', () => {
  it("forgets the saved chat key when the provider changes, so it's never sent to the new one", async () => {
    await secretsApi.set('chatBackendApiKey', 'v')
    calls = []
    changeChatBackendConfig({ chatBackendModel: 'other-model' })
    expect(calls).toEqual([])
    changeChatBackendConfig({ chatBackendBaseUrl: 'https://other.example.com/v1' })
    await vi.waitFor(() => expect(calls.map((c) => [c.method, c.url])).toEqual([['DELETE', '/api/me/secrets/chatBackendApiKey']]))
    expect(useSettingsStore.getState().chatBackendBaseUrl).toBe('https://other.example.com/v1')
  })
})
