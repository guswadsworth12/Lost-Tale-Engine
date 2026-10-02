import { describe, expect, it } from 'vitest'
import {
  authHeaderFor,
  forwardedRequestHeaders,
  parseRelayAuth,
  parseRelayTarget,
  passedResponseHeaders,
  relayTargetAllowed,
  savedServiceOrigins,
} from './relayPlan'

const settings = {
  baseUrl: 'http://localhost:5001/api',
  chatBackendBaseUrl: 'https://openrouter.ai/api/v1',
  ttsBaseUrl: 'not a url',
  imageBackendBaseUrl: 'file:///etc/passwd',
  ttsProfiles: { elevenlabs: { ttsBaseUrl: 'http://192.168.1.20:8811' } },
  chatBackendApiKey: 'ignored',
}

describe('relay allowlist', () => {
  it('allows the origins saved in the user settings, at any depth', () => {
    expect([...savedServiceOrigins(settings)].sort()).toEqual(['http://192.168.1.20:8811', 'http://localhost:5001', 'https://openrouter.ai'])
    expect(relayTargetAllowed(new URL('http://localhost:5001/api/v1/generate'), settings)).toBe(true)
    expect(relayTargetAllowed(new URL('https://openrouter.ai/api/v1/chat/completions'), settings)).toBe(true)
    expect(relayTargetAllowed(new URL('http://192.168.1.20:8811/v1/audio/speech'), settings)).toBe(true)
  })

  it('compares whole origins: scheme, host and port', () => {
    expect(relayTargetAllowed(new URL('http://localhost:5002/'), settings)).toBe(false)
    expect(relayTargetAllowed(new URL('https://localhost:5001/'), settings)).toBe(false)
    expect(relayTargetAllowed(new URL('http://openrouter.ai/'), settings)).toBe(false)
    expect(relayTargetAllowed(new URL('https://openrouter.ai.attacker.test/'), settings)).toBe(false)
  })

  it('rejects non-http schemes, credentials in the URL and non-URL settings', () => {
    expect(relayTargetAllowed(new URL('file:///etc/passwd'), settings)).toBe(false)
    expect(relayTargetAllowed(new URL('http://user:pw@localhost:5001/'), settings)).toBe(false)
    expect(relayTargetAllowed(new URL('http://localhost:5001/'), null)).toBe(false)
    expect(relayTargetAllowed(new URL('http://localhost:5001/'), { baseUrl: 42 })).toBe(false)
  })

  it('allows the fixed provider origins and Azure speech regions over https only', () => {
    expect(relayTargetAllowed(new URL('https://text.novelai.net/ai/generate-stream'), null)).toBe(true)
    expect(relayTargetAllowed(new URL('https://api.elevenlabs.io/v1/voices'), null)).toBe(true)
    expect(relayTargetAllowed(new URL('http://api.elevenlabs.io/v1/voices'), null)).toBe(false)
    expect(relayTargetAllowed(new URL('https://eastus.tts.speech.microsoft.com/cognitiveservices/v1'), null)).toBe(true)
    expect(relayTargetAllowed(new URL('http://eastus.tts.speech.microsoft.com/'), null)).toBe(false)
    expect(relayTargetAllowed(new URL('https://evil.tts.speech.microsoft.com.attacker.test/'), null)).toBe(false)
    expect(relayTargetAllowed(new URL('https://text.novelai.net:8443/'), null)).toBe(false)
  })

  it('parses only absolute http(s) targets', () => {
    expect(parseRelayTarget('https://api.elevenlabs.io/v1/voices?x=1')?.href).toBe('https://api.elevenlabs.io/v1/voices?x=1')
    expect(parseRelayTarget('/v1/voices')).toBeUndefined()
    expect(parseRelayTarget('javascript:alert(1)')).toBeUndefined()
    expect(parseRelayTarget('https://a:b@api.elevenlabs.io/')).toBeUndefined()
    expect(parseRelayTarget(undefined)).toBeUndefined()
    expect(parseRelayTarget(['https://api.elevenlabs.io/'])).toBeUndefined()
  })
})

describe('relay credentials', () => {
  it('builds bearer, basic and named-header credentials', () => {
    expect(authHeaderFor('bearer', 'k')).toEqual(['Authorization', 'Bearer k'])
    expect(authHeaderFor('basic', 'pw', 'user')).toEqual(['Authorization', `Basic ${Buffer.from('user:pw').toString('base64')}`])
    expect(authHeaderFor('header:xi-api-key', 'k')).toEqual(['xi-api-key', 'k'])
    expect(authHeaderFor('header:Ocp-Apim-Subscription-Key', 'k')).toEqual(['Ocp-Apim-Subscription-Key', 'k'])
  })

  it('rejects unsafe header names', () => {
    for (const auth of ['header:Cookie', 'header:host', 'header:', 'header:Bad Name', 'header:x\r\nInjected: 1', 'header:x-relay-target', 'digest']) {
      expect(parseRelayAuth(auth)).toBeUndefined()
    }
    expect(() => authHeaderFor('header:cookie', 'k')).toThrow()
    expect(parseRelayAuth(undefined)).toBe('bearer')
  })
})

describe('relay headers', () => {
  it('forwards only the safe request headers', () => {
    const forwarded = forwardedRequestHeaders({
      'content-type': 'application/json', accept: 'text/event-stream', cookie: 'session=1', authorization: 'Bearer client',
      'x-relay-target': 'https://x', 'x-relay-secret': 'ttsApiKey', origin: 'http://localhost:5173', host: 'localhost:3001',
      // Fish Audio names its voice engine in a `model` header.
      model: 's2-pro',
    })
    expect(forwarded).toEqual({ 'content-type': 'application/json', accept: 'text/event-stream', model: 's2-pro' })
  })

  it('passes back only the allowed response headers', () => {
    const upstream = new Headers({ 'content-type': 'audio/mpeg', 'set-cookie': 'a=1', 'retry-after': '5', 'access-control-allow-origin': '*', 'content-disposition': 'attachment' })
    expect(passedResponseHeaders(upstream)).toEqual({ 'content-type': 'audio/mpeg', 'retry-after': '5', 'content-disposition': 'attachment' })
  })
})
