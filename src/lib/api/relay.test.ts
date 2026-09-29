import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { relayFetch } from './relay'
import { RELAY_HEADERS, RELAY_PATH } from '@/lib/accounts/contract'
import { useAuthStore } from '@/lib/accounts/useAuthStore'

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('ok'))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const sent = (i = 0) => {
  const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit]
  return { url, init, headers: new Headers(init.headers) }
}

describe('relayFetch', () => {
  it('fetches a same-origin path directly, with no relay headers and no Authorization', async () => {
    await relayFetch('/api/openmayhem/models', { headers: { Authorization: 'Bearer leaked', Accept: 'application/json' }, secret: 'openMayhemApiKey' })
    const { url, headers } = sent()
    expect(url).toBe('/api/openmayhem/models')
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('accept')).toBe('application/json')
    expect([...headers.keys()].some((k) => k.startsWith('x-relay-'))).toBe(false)
  })

  it('sends an absolute URL through the relay with the target, secret and auth mode', async () => {
    const signal = new AbortController().signal
    const body = JSON.stringify({ model: 'm', messages: [] })
    await relayFetch('https://api.example.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer leaked' },
      body,
      signal,
      secret: 'chatBackendApiKey',
      auth: 'bearer',
    })
    const { url, init, headers } = sent()
    expect(url).toBe(RELAY_PATH)
    expect(init.method).toBe('POST')
    expect(init.body).toBe(body)
    expect(init.signal).toBe(signal)
    expect(headers.get(RELAY_HEADERS.target)).toBe('https://api.example.com/v1/chat/completions')
    expect(headers.get(RELAY_HEADERS.secret)).toBe('chatBackendApiKey')
    expect(headers.get(RELAY_HEADERS.auth)).toBe('bearer')
    expect(headers.get(RELAY_HEADERS.username)).toBeNull()
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('authorization')).toBeNull()
    // The relay's own options never reach fetch as RequestInit fields.
    expect(init).not.toHaveProperty('secret')
    expect(init).not.toHaveProperty('auth')
  })

  it('names no secret when none is given, even with an auth mode', async () => {
    await relayFetch('http://localhost:5001/api/v1/model', { auth: 'bearer' })
    const { url, headers } = sent()
    expect(url).toBe(RELAY_PATH)
    expect(headers.get(RELAY_HEADERS.target)).toBe('http://localhost:5001/api/v1/model')
    expect(headers.get(RELAY_HEADERS.secret)).toBeNull()
    expect(headers.get(RELAY_HEADERS.auth)).toBeNull()
  })

  it('passes basic auth\'s username and a header auth mode through', async () => {
    await relayFetch('http://127.0.0.1:7860/sdapi/v1/txt2img', { secret: 'imageBackendPassword', auth: 'basic', username: 'user' })
    expect(sent().headers.get(RELAY_HEADERS.username)).toBe('user')
    await relayFetch('https://api.elevenlabs.io/v1/text-to-speech/v', { secret: 'ttsApiKey', auth: 'header:xi-api-key', username: 'ignored' })
    expect(sent(1).headers.get(RELAY_HEADERS.auth)).toBe('header:xi-api-key')
    expect(sent(1).headers.get(RELAY_HEADERS.username)).toBeNull()
  })

  it('returns the upstream response untouched, including a streamed body', async () => {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'))
        c.close()
      },
    })
    const upstream = new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    fetchMock.mockResolvedValueOnce(upstream)
    const res = await relayFetch('https://api.example.com/v1/chat/completions', { method: 'POST' })
    expect(res).toBe(upstream)
    expect(await res.text()).toContain('"content":"Hi"')
  })

  it("signs out on the server's own sign-in gate, leaving the body readable", async () => {
    const signedOut = vi.fn()
    useAuthStore.setState({ signedOut })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Sign in required' }), { status: 401 }))
    const res = await relayFetch('https://api.example.com/v1/models')
    expect(signedOut).toHaveBeenCalledTimes(1)
    expect(await res.json()).toEqual({ error: 'Sign in required' })
  })

  it("leaves a service's own 401 (a rejected key) alone", async () => {
    const signedOut = vi.fn()
    useAuthStore.setState({ signedOut })
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Invalid API key' } }), { status: 401 }))
    const res = await relayFetch('https://api.example.com/v1/models')
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
    await relayFetch('/api/novelai/tokenize')
    expect(signedOut).not.toHaveBeenCalled()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: { message: 'Invalid API key' } })
  })
})
