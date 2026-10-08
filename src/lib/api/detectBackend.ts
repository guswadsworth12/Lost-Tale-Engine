// Works out what a local model server speaks from just its URL — KoboldCpp's native API or the
// OpenAI-compatible /v1 shape (LM Studio, llama.cpp, Ollama, TabbyAPI, oobabooga) — so onboarding
// can take one address and wire the right backend without asking which protocol it is.

import { openAiRoot } from './openAiRoot'
import { hasAvailableOpenMayhemProvider, isOpenMayhem, loadOpenMayhemModels } from './openMayhem'
import { relayFetch } from './relay'

const PROBE_TIMEOUT_MS = 3500

export interface DetectedBackend {
  kind: 'koboldcpp' | 'openai-compatible'
  /** What to store as the base URL: bare origin for KoboldCpp, the `/v1` root for OpenAI-compatible. */
  baseUrl: string
  /** KoboldCpp only: the single loaded model's name. */
  model?: string
  /** OpenAI-compatible only: model ids from `/models`, when it answered. */
  models?: string[]
}

const strip = (u: string) => u.trim().replace(/\/+$/, '')

/**
 * Where an OpenAI-compatible service's API lives. A bare address (`http://host:1234`) means `/v1`,
 * the path local servers use; LM Studio answers anything else with an error dressed as a success.
 * An address with a path of its own (`…/v1beta/openai`, a proxy's) is used as typed.
 */
export { openAiRoot } from './openAiRoot'

/** `keySaved`: attach the saved chat key (bearer) through the relay. The browser never holds it. */
async function getJson(url: string, keySaved?: boolean): Promise<unknown | null> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    const res = await relayFetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json' },
      ...(keySaved ? { secret: 'chatBackendApiKey' as const, auth: 'bearer' as const } : {}),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

function modelIdsFrom(body: unknown): string[] | null {
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) return null
  const ids = data.map((m) => (m as { id?: unknown }).id).filter((id): id is string => typeof id === 'string')
  return ids.length ? ids : []
}

/** The `/v1` roots worth trying for an OpenAI-compatible server, given whatever the user typed. */
function openAiCandidates(base: string): string[] {
  if (/\/v\d+$/.test(base)) return [base]
  return [`${base}/v1`, base]
}

/**
 * Probe `url` and report which backend answers. KoboldCpp is checked first because its client is
 * written against Kobold's own API (streaming, vision, abort, token counts) rather than the
 * lowest common denominator — and Kobold also serves an OpenAI shim, so an OpenAI-first check
 * would misroute it. Returns null if nothing recognisable answers.
 */
export async function detectLocalBackend(url: string, keySaved?: boolean): Promise<DetectedBackend | null> {
  const base = strip(url)
  if (!base) return null

  for (const koboldRoot of [base, base.replace(/\/v\d+$/, '')]) {
    const body = await getJson(`${koboldRoot}/api/v1/model`, keySaved)
    const result = (body as { result?: unknown })?.result
    if (typeof result === 'string' && result) {
      return { kind: 'koboldcpp', baseUrl: koboldRoot, model: result }
    }
  }

  for (const root of openAiCandidates(base)) {
    const ids = modelIdsFrom(await getJson(`${root}/models`, keySaved))
    if (ids) return { kind: 'openai-compatible', baseUrl: root, models: ids }
  }

  return null
}

/** `GET {baseUrl}/models` → model ids, or null if it didn't answer usably. Empty array = answered, no models listed. */
export async function listOpenAiModels(baseUrl: string, keySaved?: boolean): Promise<string[] | null> {
  if (isOpenMayhem(baseUrl)) {
    try { return (await loadOpenMayhemModels(true)).filter(hasAvailableOpenMayhemProvider).map((m) => m.id) } catch { return null }
  }
  const root = openAiRoot(baseUrl)
  if (!root) return null
  return modelIdsFrom(await getJson(`${root}/models`, keySaved))
}

/**
 * Best-effort context window for one model id from `/models` metadata. OpenRouter returns
 * `context_length`, vLLM/llama.cpp return `max_model_len`, some return `context_window`. Null
 * when `/models` didn't answer or carried no size for that id — the caller keeps its own default.
 */
export async function fetchOpenAiModelContext(baseUrl: string, model: string, keySaved?: boolean): Promise<number | null> {
  if (isOpenMayhem(baseUrl)) {
    try { return (await loadOpenMayhemModels()).find((m) => m.id === model)?.context_length ?? null } catch { return null }
  }
  const root = openAiRoot(baseUrl)
  if (!root || !model) return null
  const body = await getJson(`${root}/models`, keySaved)
  const data = (body as { data?: unknown })?.data
  if (!Array.isArray(data)) return null
  const entry = data.find((m) => (m as { id?: unknown }).id === model) as Record<string, unknown> | undefined
  if (!entry) return null
  for (const key of ['context_length', 'max_model_len', 'context_window', 'max_context_length']) {
    const raw = entry[key] ?? (entry.top_provider as Record<string, unknown> | undefined)?.[key]
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return Math.floor(n)
  }
  return null
}
