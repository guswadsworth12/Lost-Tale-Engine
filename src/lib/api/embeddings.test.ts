import { afterEach, describe, expect, it, vi } from 'vitest'
import { embeddingConnection } from './embeddings'
import { OpenAICompatibleClient } from './openaiCompatible'
import { loadServiceModels } from './serviceModels'
import { RELAY_HEADERS, serviceSecretName } from '@/lib/accounts/contract'
import { SERVICE_KINDS, MODEL_JOBS } from './services'

afterEach(() => vi.unstubAllGlobals())
describe('embedding services and relay', () => {
  it('uses /v1 handling and the saved vault credential, reordering a batch by provider index', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }] })))
    vi.stubGlobal('fetch', fetch)
    const client = new OpenAICompatibleClient('http://localhost:1234/', true, 'synthetic', serviceSecretName('local'))
    expect(await client.embed(['river', 'gift'])).toEqual([[1, 0], [0, 1]])
    const init = fetch.mock.calls[0][1] as RequestInit
    expect(fetch.mock.calls[0][0]).toBe('/api/relay')
    const headers = new Headers(init.headers)
    expect(headers.get(RELAY_HEADERS.target)).toBe('http://localhost:1234/v1/embeddings')
    expect(JSON.parse(String(init.body))).toEqual({ model: 'synthetic', input: ['river', 'gift'], encoding_format: 'float' })
    expect(headers.get(RELAY_HEADERS.secret)).toBe(serviceSecretName('local'))
    expect(headers.get('authorization')).toBeNull()
  })
  it('rejects incomplete, invalid, duplicate-index and failed batches', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const client = new OpenAICompatibleClient('http://localhost:1234/v1', false, 'synthetic')
    for (const body of [{ data: [] }, { data: [{ index: 1, embedding: [1] }] }, { data: [{ index: 0, embedding: [null] }] }]) {
      fetch.mockResolvedValue(new Response(JSON.stringify(body)))
      await expect(client.embed(['river'])).rejects.toThrow()
    }
    fetch.mockResolvedValue(new Response('', { status: 500 }))
    await expect(client.embed(['river'])).rejects.toThrow()
  })
  it('offers embeddings only on the supported kinds, keeps them out of text lists/jobs and permits typed models', async () => {
    expect(Object.entries(SERVICE_KINDS).filter(([, v]) => v.offers.includes('embeddings')).map(([id]) => id)).toEqual(['openai', 'openai-compatible'])
    expect(MODEL_JOBS.map((v) => v.id)).not.toContain('embeddings')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'synthetic-chat' }, { id: 'nomic-embed-text' }, { id: 'text-embedding-small' }] }))))
    const local = { id: 'local', name: 'Local', kind: 'openai-compatible' as const, baseUrl: 'http://localhost:1234/v1' }
    expect(await loadServiceModels(local, {})).toMatchObject({ text: ['synthetic-chat'], embeddings: ['nomic-embed-text', 'text-embedding-small'] })
    expect(embeddingConnection({ services: [local], embeddingModel: { serviceId: 'local', model: 'typed-model' } }, {})?.model).toBe('typed-model')
    expect(embeddingConnection({ services: [local], embeddingModel: null }, {})).toBeUndefined()
  })
})
