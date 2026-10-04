import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleClient, refusedParamFrom } from './openaiCompatible'
import { KoboldApiError } from './types'
import type { GenerateRequest } from './types'
import type { ChatBackend } from './chatBackend'
import { stubRelayedFetch } from './relayTestUtils'

/**
 * Section 8's "additional model backends" — these tests check `OpenAICompatibleClient` against the
 * documented OpenAI Chat Completions contract with a mocked `fetch`, NOT against a real provider
 * (see the honesty note atop openaiCompatible.ts: nobody working on this had a real API key to
 * verify against). They lock in the request-shape/param-mapping and SSE-parsing logic so a future
 * change can't silently break it, but they cannot catch a real provider behaving differently than
 * documented.
 */

const BASE_REQUEST: GenerateRequest = {
  prompt: 'Hello there',
  max_length: 200,
  max_context_length: 4096,
}

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers ?? {}),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

/** Builds a fake streaming `Response` whose body yields the given raw SSE text in one chunk. */
function sseResponse(rawEvents: string): Response {
  const encoder = new TextEncoder()
  let sent = false
  const reader = {
    read: async () => {
      if (sent) return { done: true, value: undefined }
      sent = true
      return { done: false, value: encoder.encode(rawEvents) }
    },
  }
  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
    text: async () => '',
  } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAICompatibleClient — request building', () => {
  it('wraps a plain prompt as a single user message when no messages[] is supplied', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    stubRelayedFetch(fetchMock)

    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    await client.generate(BASE_REQUEST)

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.messages).toEqual([{ role: 'user', content: 'Hello there' }])
    expect(body.model).toBe('gpt-4o-mini')
    expect(body.stream).toBe(false)
  })

  it('sends a supplied messages[] as-is instead of wrapping prompt', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    stubRelayedFetch(fetchMock)

    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    await client.generate({
      ...BASE_REQUEST,
      messages: [
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Hello there' },
      ],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'Hello there' },
    ])
  })

  it('maps only the fields with a real Chat Completions equivalent, dropping KoboldCpp-only ones', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    stubRelayedFetch(fetchMock)

    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    await client.generate({
      ...BASE_REQUEST,
      temperature: 0.9,
      top_p: 0.95,
      top_k: 40, // KoboldCpp-only — must NOT appear in the sent body
      min_p: 0.05, // KoboldCpp-only
      rep_pen: 1.1, // KoboldCpp-only
      presence_penalty: 0.2,
      max_length: 256,
      stop_sequence: ['\nUser:'],
    })

    const [, init] = fetchMock.mock.calls[0]
    const body = JSON.parse(init.body as string)
    expect(body.temperature).toBe(0.9)
    expect(body.top_p).toBe(0.95)
    expect(body.presence_penalty).toBe(0.2)
    expect(body.max_tokens).toBe(256)
    expect(body.stop).toEqual(['\nUser:'])
    expect(body).not.toHaveProperty('top_k')
    expect(body).not.toHaveProperty('min_p')
    expect(body).not.toHaveProperty('rep_pen')
  })

  it('maps frequency_penalty/reasoning_effort/verbosity when the caller sets them, and omits them otherwise', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')

    await client.generate({ ...BASE_REQUEST, frequency_penalty: -0.4, reasoning_effort: 'high', verbosity: 'low' })
    let body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.frequency_penalty).toBe(-0.4)
    expect(body.reasoning_effort).toBe('high')
    expect(body.verbosity).toBe('low')

    fetchMock.mockClear()
    await client.generate(BASE_REQUEST)
    body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('frequency_penalty')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('verbosity')
  })

  it('sends Gemini only fields it accepts: no frequency_penalty (it refuses the whole request), and no zero penalties anywhere', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    stubRelayedFetch(fetchMock)
    const gemini = new OpenAICompatibleClient('https://generativelanguage.googleapis.com/v1beta/openai', false, 'gemini-3.8-flash')
    await gemini.generate({ ...BASE_REQUEST, frequency_penalty: 0.5, presence_penalty: 0.3 })
    let body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('frequency_penalty')
    expect(body.presence_penalty).toBe(0.3)

    // Quick tuning's defaults are 0: not sent to anyone.
    fetchMock.mockClear()
    const other = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    await other.generate({ ...BASE_REQUEST, frequency_penalty: 0, presence_penalty: 0 })
    body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).not.toHaveProperty('frequency_penalty')
    expect(body).not.toHaveProperty('presence_penalty')
  })

  // Live-verified against a real key: OpenRouter's free tier increasingly routes to reasoning
  // models, and one (`nex-agi/nex-n2.5-mini:free`) reproduced exactly this — reasoning tokens
  // filled the whole `max_tokens` budget and `content` came back empty every time, with no error at
  // all, until `reasoning: {enabled: false}` was added to the request.
  describe('reasoning — OpenRouter only', () => {
    it("requests reasoning off by default, since a hidden 'thinking' phase only costs reply budget in a roleplay app", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
      stubRelayedFetch(fetchMock)
      const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', false, 'some/model:free')

      await client.generate(BASE_REQUEST)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.reasoning).toEqual({ enabled: false })
    })

    it("translates an explicit reasoning_effort into OpenRouter's own shape too, alongside the OpenAI-style field", async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
      stubRelayedFetch(fetchMock)
      const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', false, 'some/model:free')

      await client.generate({ ...BASE_REQUEST, reasoning_effort: 'low' })
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.reasoning_effort).toBe('low')
      expect(body.reasoning).toEqual({ effort: 'low' })
    })

    it('never sends the OpenRouter-only field to a different host', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
      stubRelayedFetch(fetchMock)
      const client = new OpenAICompatibleClient('https://api.openai.com/v1', false, 'gpt-4o-mini')

      await client.generate(BASE_REQUEST)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body).not.toHaveProperty('reasoning')
    })

    it('recognises openrouter.ai regardless of a trailing slash or path', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
      stubRelayedFetch(fetchMock)
      const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1/', false, 'some/model:free')

      await client.generate(BASE_REQUEST)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.reasoning).toEqual({ enabled: false })
    })

    it('does not mistake a look-alike host for the real one', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
      stubRelayedFetch(fetchMock)
      const client = new OpenAICompatibleClient('https://openrouter.ai.evil.example.com/v1', false, 'some/model:free')

      await client.generate(BASE_REQUEST)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body).not.toHaveProperty('reasoning')
    })
  })

  it('asks the relay for the saved chat key (bearer) only when one is saved, and never sends a key itself', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    const raw = stubRelayedFetch(fetchMock)

    const withKey = new OpenAICompatibleClient('https://api.example.com/v1', true, 'gpt-4o-mini')
    await withKey.generate(BASE_REQUEST)
    let [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.relay).toEqual({ secret: 'chatBackendApiKey', auth: 'bearer', username: null })
    expect(init.headers.authorization).toBeUndefined()
    expect(raw.mock.calls[0][0]).toBe('/api/relay')

    fetchMock.mockClear()
    const withoutKey = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    await withoutKey.generate(BASE_REQUEST)
    ;[url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.relay).toEqual({ secret: null, auth: null, username: null })
    expect(init.headers.authorization).toBeUndefined()
  })

  it('posts to <baseUrl>/chat/completions, trimming a trailing slash', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    stubRelayedFetch(fetchMock)

    const client = new OpenAICompatibleClient('https://api.example.com/v1/', false, 'gpt-4o-mini')
    await client.generate(BASE_REQUEST)

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
  })

  it('adds /v1 to a bare address (a local server typed without it), and leaves any other path alone', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    stubRelayedFetch(fetchMock)

    await new OpenAICompatibleClient('http://172.16.69.113:1234/', false, '').generate(BASE_REQUEST)
    await new OpenAICompatibleClient('https://generativelanguage.googleapis.com/v1beta/openai', false, 'gemini').generate(BASE_REQUEST)

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://172.16.69.113:1234/v1/chat/completions',
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    ])
  })
})

// A real user hit this against real OpenAI: "Unsupported parameter: 'max_tokens' is not supported
// with this model. Use 'max_completion_tokens' instead." OpenAI made that switch mandatory for
// o1/o3/o4-mini and has since widened it to some GPT-5-family models too, with no published,
// queryable way to know ahead of time which name a given model wants — every other project that's
// hit this (opencode, crush, several LangChain issues) confirms the same thing. So this client
// doesn't guess from the model name; it sends the widely-supported `max_tokens` first and only
// switches for the rest of its lifetime once it's actually seen that specific rejection.
describe('OpenAICompatibleClient — max_tokens / max_completion_tokens', () => {
  function maxTokensRejection() {
    return jsonResponse(400, {
      error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead." },
    })
  }

  it('sends max_tokens on the first request, same as ever', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', false, 'gpt-5.1')

    await client.generate({ ...BASE_REQUEST, max_length: 300 })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.max_tokens).toBe(300)
    expect(body).not.toHaveProperty('max_completion_tokens')
  })

  it('retries once with max_completion_tokens when that exact rejection comes back, and the retry succeeds transparently', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(maxTokensRejection())
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'Hello.' } }] }))
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', false, 'gpt-5.1')

    const text = await client.generate({ ...BASE_REQUEST, max_length: 300 })
    expect(text).toBe('Hello.')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(firstBody.max_tokens).toBe(300)
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondBody.max_completion_tokens).toBe(300)
    expect(secondBody).not.toHaveProperty('max_tokens')
  })

  it('remembers the switch — every later call on the same client instance goes straight to max_completion_tokens, no wasted retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(maxTokensRejection())
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'first' } }] }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'second' } }] }))
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', false, 'gpt-5.1')

    await client.generate(BASE_REQUEST)
    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'second' } }] }))

    await client.generate(BASE_REQUEST)
    expect(fetchMock).toHaveBeenCalledTimes(1) // no rejected first attempt this time
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.max_completion_tokens).toBeDefined()
    expect(body).not.toHaveProperty('max_tokens')
  })

  it('only ever retries once — a second, different rejection surfaces as a real error instead of looping', async () => {
    const fetchMock = vi.fn().mockResolvedValue(maxTokensRejection())
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', false, 'gpt-5.1')

    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/max_completion_tokens/)
    expect(fetchMock).toHaveBeenCalledTimes(2) // the one legitimate retry, then it gives up
  })

  it('leaves an unrelated 400 alone — never mistaken for the max_tokens rejection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: 'Invalid API key' } }))
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', false, 'gpt-5.1')

    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/Invalid API key/)
    expect(fetchMock).toHaveBeenCalledTimes(1) // no retry for a different kind of 400
  })

  it('applies the same retry to generateStream()', async () => {
    const events = [`data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}`, 'data: [DONE]'].map((e) => e + '\n\n').join('')
    const fetchMock = vi.fn().mockResolvedValueOnce(maxTokensRejection()).mockResolvedValueOnce(sseResponse(events))
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', false, 'gpt-5.1')

    const tokens: string[] = []
    const full = await client.generateStream(BASE_REQUEST, (t) => tokens.push(t))
    expect(full).toBe('Hi')
    expect(tokens).toEqual(['Hi'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string)
    expect(secondBody.max_completion_tokens).toBeDefined()
  })

  it("still resolves quietly (not a throw) on generateStream() when the signal was already aborted — same contract as before this retry existed", async () => {
    const controller = new AbortController()
    stubRelayedFetch(vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')))
    controller.abort()
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', false, 'gpt-5.1')
    const full = await client.generateStream(BASE_REQUEST, () => {}, controller.signal)
    expect(full).toBe('')
  })
})

describe('OpenAICompatibleClient — generate()', () => {
  it('extracts choices[0].message.content from a successful response', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'Hello, world.' } }] })))
    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    const text = await client.generate(BASE_REQUEST)
    expect(text).toBe('Hello, world.')
  })

  it('returns an empty string when the response has no choices', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(200, {})))
    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    const text = await client.generate(BASE_REQUEST)
    expect(text).toBe('')
  })

  it('throws a specific error, not a bare empty string, when reasoning tokens filled the whole budget', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: '', reasoning: 'thinking about it for a while...' } }] })),
    )
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', false, 'some/model:free')
    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/hidden reasoning/)
  })

  it("also recognises DeepSeek's own reasoning_content name for the same field", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: '', reasoning_content: 'thinking...' } }] })),
    )
    const client = new OpenAICompatibleClient('https://api.deepseek.com/v1', false, 'deepseek-reasoner')
    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/hidden reasoning/)
  })

  it('leaves an ordinary empty reply (no reasoning either) exactly as it always returned — an empty string, not a throw', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: '' } }] })))
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', false, 'some/model:free')
    const text = await client.generate(BASE_REQUEST)
    expect(text).toBe('')
  })

  it('throws a KoboldApiError with the provider error message on a non-2xx response', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: 'Invalid API key' } })))
    const client = new OpenAICompatibleClient('https://api.example.com/v1', true, 'gpt-4o-mini')
    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(KoboldApiError)
    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/Invalid API key/)
  })

  it('throws a KoboldApiError when the network request itself fails', async () => {
    stubRelayedFetch(vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(KoboldApiError)
  })

  it('rethrows the original error instead of a KoboldApiError when the caller aborted', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('Aborted', 'AbortError')
    stubRelayedFetch(vi.fn().mockRejectedValue(abortError))
    controller.abort()
    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    await expect(client.generate(BASE_REQUEST, controller.signal)).rejects.toBe(abortError)
  })

  // FIXES_TODO.md item #14 — a 429's own body text can overclaim permanence (a provider's "Daily
  // limit reached" wording, confirmed live to sometimes clear in under a minute). These lock in that
  // the provider's own message is never dropped or rewritten, only ever appended to.
  describe('429 rate-limit hint', () => {
    it("appends the provider's own Retry-After seconds when the header is present", async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(429, { error: { message: 'Daily limit reached.' } }, { 'retry-after': '45' })),
      )
      const client = new OpenAICompatibleClient('https://api.example.com/v1', true, 'gpt-4o-mini')
      await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/Daily limit reached\..*retry in about 45s/)
    })

    it('renders a Retry-After of 60+ seconds in minutes, not seconds', async () => {
      stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(429, { error: { message: 'Rate limited.' } }, { 'retry-after': '125' })))
      const client = new OpenAICompatibleClient('https://api.example.com/v1', true, 'gpt-4o-mini')
      await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/retry in about 3m/)
    })

    it('falls back to a soft, honest hedge — never a fabricated time — when no Retry-After header comes back', async () => {
      stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(429, { error: { message: 'Daily limit reached. Credits do not affect this cap.' } })))
      const client = new OpenAICompatibleClient('https://api.example.com/v1', true, 'gpt-4o-mini')
      await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/Daily limit reached\. Credits do not affect this cap\..*can sometimes clear on its own/)
    })

    it('never adds a rate-limit hint for a non-429 error', async () => {
      stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(500, { error: { message: 'Internal error' } })))
      const client = new OpenAICompatibleClient('https://api.example.com/v1', true, 'gpt-4o-mini')
      await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/Internal error$/)
    })
  })
})

describe('OpenAICompatibleClient — generateStream()', () => {
  it('parses delta.content chunks, calls onToken incrementally, and ignores [DONE]', async () => {
    const events = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hel' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'lo' } }] })}`,
      'data: [DONE]',
    ]
      .map((e) => e + '\n\n')
      .join('')
    stubRelayedFetch(vi.fn().mockResolvedValue(sseResponse(events)))

    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    const tokens: string[] = []
    const full = await client.generateStream(BASE_REQUEST, (token) => tokens.push(token))

    expect(tokens).toEqual(['Hel', 'lo'])
    expect(full).toBe('Hello')
  })

  it('ignores malformed/keepalive events without throwing', async () => {
    const events = [': keepalive', `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}`, 'data: not json'].map((e) => e + '\n\n').join('')
    stubRelayedFetch(vi.fn().mockResolvedValue(sseResponse(events)))

    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    const full = await client.generateStream(BASE_REQUEST, () => {})
    expect(full).toBe('ok')
  })

  it('returns an empty string instead of throwing when the caller aborted before the request landed', async () => {
    const controller = new AbortController()
    stubRelayedFetch(vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')))
    controller.abort()
    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    const full = await client.generateStream(BASE_REQUEST, () => {}, controller.signal)
    expect(full).toBe('')
  })

  // Reproduces the live shape captured from an actual OpenRouter response: `delta.reasoning`
  // streams real text every chunk while `delta.content` stays `''` for the whole reply, right up to
  // `[DONE]` — the model spent its entire token budget thinking and never actually answered.
  it('throws a specific error (not a silent empty reply) when every delta was reasoning and none was content', async () => {
    const events = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: '', role: 'assistant', reasoning: 'Let me consider how ' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: '', reasoning: 'Sumire would respond here...' } }] })}`,
      'data: [DONE]',
    ]
      .map((e) => e + '\n\n')
      .join('')
    stubRelayedFetch(vi.fn().mockResolvedValue(sseResponse(events)))

    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', false, 'some/model:free')
    const tokens: string[] = []
    await expect(client.generateStream(BASE_REQUEST, (t) => tokens.push(t))).rejects.toThrow(/hidden reasoning/)
    // The reasoning text is never handed to the caller as if it were the reply.
    expect(tokens).toEqual([])
  })

  it('never calls onToken with a reasoning delta, even when content deltas are also present', async () => {
    const events = [
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'thinking first...' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hi' } }] })}`,
      'data: [DONE]',
    ]
      .map((e) => e + '\n\n')
      .join('')
    stubRelayedFetch(vi.fn().mockResolvedValue(sseResponse(events)))

    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', false, 'some/model:free')
    const tokens: string[] = []
    const full = await client.generateStream(BASE_REQUEST, (t) => tokens.push(t))
    expect(tokens).toEqual(['Hi'])
    expect(full).toBe('Hi')
  })

  it("reports an error sent back as a plain JSON success (LM Studio's wrong-path answer) instead of an empty reply", async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(sseResponse('{"error":"Unexpected endpoint or method. (POST /chat/completions)"}')))
    const client = new OpenAICompatibleClient('http://localhost:1234/api', false, '')
    await expect(client.generateStream(BASE_REQUEST, () => {})).rejects.toThrow(/answered with Unexpected endpoint or method/)

    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(200, { error: { message: 'Model unloaded' } })))
    await expect(client.generate(BASE_REQUEST)).rejects.toThrow(/answered with Model unloaded/)
  })

  it('leaves a genuinely empty stream (no reasoning either) returning an empty string, same as always', async () => {
    const events = ['data: [DONE]'].map((e) => e + '\n\n').join('')
    stubRelayedFetch(vi.fn().mockResolvedValue(sseResponse(events)))
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', false, 'some/model:free')
    const full = await client.generateStream(BASE_REQUEST, () => {})
    expect(full).toBe('')
  })
})

describe('OpenAICompatibleClient — no-op / fallback surface', () => {
  it('getEffectiveMaxContext always returns the caller-supplied fallback (no introspection endpoint)', async () => {
    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    expect(await client.getEffectiveMaxContext(8192)).toBe(8192)
    expect(await client.getEffectiveMaxContext()).toBe(4096)
  })

  it('tokenCount falls back to the same character-based estimate the rest of the app uses', async () => {
    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    const { count } = await client.tokenCount('twelve characters here')
    expect(count).toBe(Math.ceil('twelve characters here'.length / 4))
  })

  it('abort() resolves without making any request', async () => {
    const fetchMock = vi.fn()
    stubRelayedFetch(fetchMock)
    // Typed as the shared interface, not the concrete class — every real call site holds a
    // `ChatBackend`, and the interface's `abort(genkey)` takes an argument this implementation
    // itself just ignores.
    const client: ChatBackend = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    await expect(client.abort('some-genkey')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('getChatTemplate always returns null (not a locally loaded GGUF)', async () => {
    const client = new OpenAICompatibleClient('https://api.example.com/v1', false, 'gpt-4o-mini')
    expect(await client.getChatTemplate()).toBeNull()
  })
})

// Settings → Connection's "does this actually work" check (also the header status dot for this
// backend) — a GET, never a real chat completion, so it costs nothing on a paid provider.
describe('checkConnection', () => {
  it("hits GET {baseUrl}/models for a non-OpenRouter provider, and treats 200 as ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: 'gpt-4o-mini' }] }))
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', true, 'gpt-4o-mini')
    const result = await client.checkConnection()
    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({ headers: expect.any(Object) }))
    const [, init] = fetchMock.mock.calls[0]
    expect(init.relay).toMatchObject({ secret: 'chatBackendApiKey', auth: 'bearer' })
  })

  it('reports a rejected key distinctly on 401/403, for a non-OpenRouter provider', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(401, {})))
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', true, 'gpt-4o-mini')
    expect(await client.checkConnection()).toEqual({ ok: false, detail: 'The API key was rejected.' })
  })

  it('reports unreachable (not a key problem) when the fetch itself fails', async () => {
    stubRelayedFetch(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const client = new OpenAICompatibleClient('https://api.example.com/v1', true, 'gpt-4o-mini')
    const result = await client.checkConnection()
    expect(result.ok).toBe(false)
    expect(result.detail).toContain('Could not reach')
  })

  it('refuses to check with no base URL set, without making a request', async () => {
    const fetchMock = vi.fn()
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('', true, 'gpt-4o-mini')
    expect(await client.checkConnection()).toEqual({ ok: false, detail: 'No base URL set.' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("uses OpenRouter's own /key endpoint instead of /models, since /models there is public and would never catch a bad key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { data: { is_free_tier: true, usage: 0, limit: null } }),
    )
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', true, 'minimax/minimax-m3:free')
    await client.checkConnection()
    expect(fetchMock).toHaveBeenCalledWith('https://openrouter.ai/api/v1/key', expect.anything())
  })

  it("surfaces OpenRouter's usage/limit as the success detail", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, { data: { is_free_tier: false, usage: 25.5, limit: 100 } })),
    )
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', true, 'anthropic/claude-3.5-sonnet')
    expect(await client.checkConnection()).toEqual({ ok: true, detail: '$25.50 used of $100 limit' })
  })

  it('falls back to noting a free-tier key when OpenRouter reports no usage yet', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(200, { data: { is_free_tier: true, limit: null } })))
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', true, 'minimax/minimax-m3:free')
    expect(await client.checkConnection()).toEqual({ ok: true, detail: 'Free-tier key' })
  })

  it("still reports a rejected key on OpenRouter's /key endpoint", async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(401, {})))
    const client = new OpenAICompatibleClient('https://openrouter.ai/api/v1', true, 'minimax/minimax-m3:free')
    expect(await client.checkConnection()).toEqual({ ok: false, detail: 'The API key was rejected.' })
  })

  // Nano-GPT's /models is public too (200s for any key), so — like OpenRouter — it needs a
  // dedicated key check. Its balance endpoint lives at /api/check-balance, one level up from the
  // configured /api/v1 base URL, and wants the key as x-api-key.
  describe('Nano-GPT', () => {
    it('POSTs to /api/check-balance (not /v1/models), sending the key as x-api-key', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usd_balance: '5.00', nano_balance: '1.0', nanoDepositAddress: 'nano_x' }))
      stubRelayedFetch(fetchMock)
      const client = new OpenAICompatibleClient('https://nano-gpt.com/api/v1', true, 'anthropic/claude-sonnet-5')
      await client.checkConnection()
      expect(fetchMock).toHaveBeenCalledWith('https://nano-gpt.com/api/check-balance', expect.objectContaining({ method: 'POST' }))
      const [, init] = fetchMock.mock.calls[0]
      expect(init.relay).toMatchObject({ secret: 'chatBackendApiKey', auth: 'header:x-api-key' })
    })

    it('surfaces the USD balance as the success detail', async () => {
      stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(200, { usd_balance: '12.3456', nano_balance: '4.2', nanoDepositAddress: 'nano_x' })))
      const client = new OpenAICompatibleClient('https://nano-gpt.com/api/v1', true, 'anthropic/claude-sonnet-5')
      expect(await client.checkConnection()).toEqual({ ok: true, detail: '$12.35 balance' })
    })

    it('treats any non-2xx balance response as a rejected key (live: a bad key 401s with its own error body)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(401, { error: { message: 'Malformed API key.', code: 'malformed_api_key' } })),
      )
      const client = new OpenAICompatibleClient('https://nano-gpt.com/api/v1', true, 'anthropic/claude-sonnet-5')
      expect(await client.checkConnection()).toEqual({ ok: false, detail: 'The API key was rejected.' })
    })

    it('reports unreachable (not a key problem) when the balance fetch itself fails', async () => {
      stubRelayedFetch(vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
      const client = new OpenAICompatibleClient('https://nano-gpt.com/api/v1', true, 'anthropic/claude-sonnet-5')
      const result = await client.checkConnection()
      expect(result.ok).toBe(false)
      expect(result.detail).toContain('Could not reach')
    })

    it('still reports ok (just without a figure) when the balance body is unparseable', async () => {
      stubRelayedFetch(vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => {
          throw new Error('not json')
        },
        text: async () => 'not json',
      } as unknown as Response))
      const client = new OpenAICompatibleClient('https://nano-gpt.com/api/v1', true, 'anthropic/claude-sonnet-5')
      expect(await client.checkConnection()).toEqual({ ok: true })
    })
  })
})

describe('OpenAICompatibleClient — as a model connection', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('carries the connection\'s own key, not the chat key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ message: { content: 'hi' } }] }))
    stubRelayedFetch(fetchMock)
    await new OpenAICompatibleClient('https://api.groq.com/openai/v1', true, 'llama', 'service:groq').generate(BASE_REQUEST)
    expect(fetchMock.mock.calls[0][1].relay).toEqual({ secret: 'service:groq', auth: 'bearer', username: null })
  })

  it('says when a safety filter stopped the reply, streaming or not', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(200, { choices: [{ finish_reason: 'content_filter', message: { content: '' } }] })))
    await expect(new OpenAICompatibleClient('https://generativelanguage.googleapis.com/v1beta/openai', true, 'gemini-2.5-pro').generate(BASE_REQUEST))
      .rejects.toThrow(/safety filter blocked this reply/)
    stubRelayedFetch(vi.fn().mockResolvedValue(sseResponse('data: {"choices":[{"finish_reason":"SAFETY","delta":{}}]}\n\ndata: [DONE]\n\n')))
    await expect(new OpenAICompatibleClient('https://generativelanguage.googleapis.com/v1beta/openai', true, 'gemini-2.5-pro').generateStream(BASE_REQUEST, () => {}))
      .rejects.toThrow(/safety filter blocked this reply/)
  })

  it('reads an error Gemini wraps in an array', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(429, [{ error: { code: 429, message: 'Quota exceeded for gemini-2.5-pro.', status: 'RESOURCE_EXHAUSTED' } }])))
    await expect(new OpenAICompatibleClient('https://generativelanguage.googleapis.com/v1beta/openai', true, 'gemini-2.5-pro').generate(BASE_REQUEST))
      .rejects.toThrow(/Quota exceeded for gemini-2.5-pro/)
  })

  it('lists a service\'s models, without Gemini\'s models/ prefix', async () => {
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ id: 'models/gemini-2.5-pro' }, { id: 'models/gemini-2.5-flash' }] })))
    expect(await new OpenAICompatibleClient('https://generativelanguage.googleapis.com/v1beta/openai', true, '').listModels()).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(401, {})))
    expect(await new OpenAICompatibleClient('https://api.example.com/v1', false, '').listModels()).toEqual([])
  })
})

// Real refusals from live play: chatgpt-5.5 refusing `max_tokens` and then `stop`, and Gemini refusing
// fields it doesn't know. Each is learned once and the request redone without it.
describe('OpenAICompatibleClient — fields a model refuses by name', () => {
  const refusal = (message: string) => jsonResponse(400, { error: { message, type: 'invalid_request_error' } })
  const STOP_REQUEST: GenerateRequest = { ...BASE_REQUEST, stop_sequence: ['\nRend:'], temperature: 0.7 }

  it('reads the refused field from OpenAI and Google wording', () => {
    expect(refusedParamFrom("Unsupported parameter: 'stop' is not supported with this model.")).toBe('stop')
    expect(refusedParamFrom("Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported.")).toBe('temperature')
    expect(refusedParamFrom('Invalid JSON payload received. Unknown name "verbosity": Cannot find field.')).toBe('verbosity')
    expect(refusedParamFrom('Rate limit reached')).toBeUndefined()
  })

  it('learns max_tokens, then stop, then temperature in one turn, and ends the reply at the stop sequence itself', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(refusal("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."))
      .mockResolvedValueOnce(refusal("Unsupported parameter: 'stop' is not supported with this model."))
      .mockResolvedValueOnce(refusal("Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported."))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'She nods.\nRend: I nod back.' } }] }))
    stubRelayedFetch(fetchMock)
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', false, 'chatgpt-5.5')

    expect(await client.generate(STOP_REQUEST)).toBe('She nods.')
    const last = JSON.parse(fetchMock.mock.calls[3][1].body as string)
    expect(last).toMatchObject({ max_completion_tokens: 200 })
    expect(last).not.toHaveProperty('stop')
    expect(last).not.toHaveProperty('temperature')

    // Remembered: the next turn goes straight through.
    fetchMock.mockClear()
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'Fine.' } }] }))
    expect(await client.generate(STOP_REQUEST)).toBe('Fine.')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops a stream at the stop sequence when the model refused stop', async () => {
    const events = ['She waits.', '\nRe', 'nd: I speak for Rend.'].map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('') + 'data: [DONE]\n\n'
    stubRelayedFetch(vi.fn()
      .mockResolvedValueOnce(refusal("Unsupported parameter: 'stop' is not supported with this model."))
      .mockResolvedValueOnce({ ...sseResponse(events), body: { getReader: () => {
        let sent = false
        return { read: async () => (sent ? { done: true, value: undefined } : (sent = true, { done: false, value: new TextEncoder().encode(events) })), cancel: async () => {} }
      } } } as unknown as Response))
    const shown: string[] = []
    const client = new OpenAICompatibleClient('https://api.openai.com/v1', false, 'chatgpt-5.5')
    expect(await client.generateStream(STOP_REQUEST, (_t, full) => shown.push(full))).toBe('She waits.')
    expect(shown[shown.length - 1]).toBe('She waits.')
  })

  it("drops a field Gemini doesn't know, never sends it verbosity, and explains Interactions-only models", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(400, [{ error: { code: 400, message: 'Invalid JSON payload received. Unknown name "presence_penalty": Cannot find field.' } }]))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: 'ok' } }] }))
    stubRelayedFetch(fetchMock)
    const gemini = new OpenAICompatibleClient('https://generativelanguage.googleapis.com/v1beta/openai', false, 'gemini-x')
    expect(await gemini.generate({ ...BASE_REQUEST, presence_penalty: 0.3, verbosity: 'low' })).toBe('ok')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).not.toHaveProperty('verbosity')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body as string)).not.toHaveProperty('presence_penalty')

    stubRelayedFetch(vi.fn().mockResolvedValue(jsonResponse(400, [{ error: { code: 400, message: 'This model only supports Interactions API.' } }])))
    await expect(gemini.generate(BASE_REQUEST)).rejects.toThrow(/Interactions API, which Lost Tales Engine doesn't support yet/)
  })

  it('never drops a field the request needs, and leaves an unnamed 400 alone', async () => {
    const fetchMock = vi.fn().mockResolvedValue(refusal("Unsupported parameter: 'messages' is not supported with this model."))
    stubRelayedFetch(fetchMock)
    await expect(new OpenAICompatibleClient('https://api.openai.com/v1', false, 'odd').generate(BASE_REQUEST)).rejects.toThrow(/messages/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
