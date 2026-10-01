import { useMemo } from 'react'
import { SECRET_SETTING_KEYS, isServiceSecretName, type SecretName, type SecretStatus } from './contract'
import { invalidate } from '@/lib/api/client'
import { relayFetch } from '@/lib/api/relay'
import { isOpenMayhem } from '@/lib/api/openMayhem'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

/**
 * The signed-in user's service credentials, from the browser's side: write-only. The browser can
 * save, replace, or remove a key and ask which ones are saved; it never reads one back. Every
 * outside call names the credential it needs and the server's relay attaches it (see relay.ts).
 */

/** Which credentials are saved. */
export type SecretFlags = Record<SecretName, boolean>

export const NO_SECRETS: SecretFlags = Object.freeze(
  Object.fromEntries(SECRET_SETTING_KEYS.map((name) => [name, false])) as SecretFlags,
) as SecretFlags

const RESOURCE = 'secrets'
const PERSIST_KEY = 'rp-settings'

/** Last list the server gave, for `hasSecret` outside React. Updated optimistically on save/remove. */
let known: SecretFlags = { ...NO_SECRETS }
let listed = false

function flagsFrom(list: SecretStatus[]): SecretFlags {
  const flags = { ...NO_SECRETS }
  for (const status of list) {
    if (status && ((SECRET_SETTING_KEYS as readonly string[]).includes(status.name) || isServiceSecretName(status.name))) flags[status.name] = !!status.set
  }
  return flags
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const res = await relayFetch(`/api/me/secrets${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: unknown } | null
    throw new Error(typeof data?.error === 'string' ? data.error : `${method} /api/me/secrets${path} failed (${res.status})`)
  }
  return res
}

export const secretsApi = {
  async list(): Promise<SecretStatus[]> {
    const list = (await (await send('GET', '')).json()) as SecretStatus[]
    known = flagsFrom(Array.isArray(list) ? list : [])
    listed = true
    return Array.isArray(list) ? list : []
  },
  async set(name: SecretName, value: string): Promise<void> {
    await send('PUT', `/${encodeURIComponent(name)}`, { value })
    known = { ...known, [name]: true }
    invalidate(RESOURCE)
  },
  async remove(name: SecretName): Promise<void> {
    await send('DELETE', `/${encodeURIComponent(name)}`)
    known = { ...known, [name]: false }
    invalidate(RESOURCE)
  },
  /** Moves a saved key to another name, server-side: the value never comes back here. */
  async move(from: SecretName, to: SecretName): Promise<void> {
    await send('POST', `/${encodeURIComponent(from)}/move`, { to })
    known = { ...known, [from]: false, [to]: true }
    invalidate(RESOURCE)
  },
}

/** Fresh flags from the server, for code outside React; falls back to the last known list if the server can't answer. */
export async function loadSecretFlags(): Promise<SecretFlags> {
  try {
    return flagsFrom(await secretsApi.list())
  } catch {
    return { ...known }
  }
}

/** Whether `name` was saved, as of the last list the server gave. For code outside React; components use `useSecretStatus`. */
export function hasSecret(name: SecretName): boolean {
  return known[name]
}

/** Which credentials are saved. `saved` keeps one identity until the list changes, so it's safe as a memo dependency. */
export function useSecretStatus(): { saved: SecretFlags; loading: boolean } {
  const list = useApiQuery<SecretStatus[]>(RESOURCE, () => secretsApi.list(), [])
  // Fixed keys by position, then whichever service keys are saved.
  const key = list
    ? `${SECRET_SETTING_KEYS.map((name) => (list.some((s) => s.name === name && s.set) ? 1 : 0)).join('')}|${list.filter((s) => s.set && isServiceSecretName(s.name)).map((s) => s.name).sort().join(',')}`
    : ''
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const saved = useMemo(() => (list ? flagsFrom(list) : NO_SECRETS), [key])
  return { saved, loading: list === undefined }
}

/** The credential an OpenAI-compatible chat request uses: OpenMayhem's own key through its proxy, else the chat key. */
export function chatSecretName(chatBackendBaseUrl: string): SecretName {
  return isOpenMayhem(chatBackendBaseUrl) ? 'openMayhemApiKey' : 'chatBackendApiKey'
}

/**
 * A provider change must not send the previous provider's key to its replacement. The settings
 * store already blanks its own copy on such a change; these wrap its setters to also forget the
 * saved credential. Use them wherever the user edits a provider, base URL, or backend.
 */
/** Removes a saved key that no longer has a use, such as a deleted connection's. */
export function forgetSecret(name: SecretName): void {
  forget(name)
}

function forget(name: SecretName): void {
  // Before the first list arrives, "not known to be saved" isn't "not saved": remove regardless.
  if (listed && !known[name]) return
  known = { ...known, [name]: false }
  secretsApi.remove(name).catch((e) => console.warn(`Could not remove the saved ${name}:`, e))
}

type ChatPatch = Parameters<ReturnType<typeof useSettingsStore.getState>['setChatBackendConfig']>[0]
type VoicePatch = Parameters<ReturnType<typeof useSettingsStore.getState>['setVoiceConfig']>[0]
type ImagePatch = Parameters<ReturnType<typeof useSettingsStore.getState>['setImageBackendConfig']>[0]

export function changeChatBackendConfig(patch: ChatPatch): void {
  const s = useSettingsStore.getState()
  const changesProvider = (patch.chatBackendBaseUrl !== undefined && patch.chatBackendBaseUrl !== s.chatBackendBaseUrl)
    || (patch.chatBackend !== undefined && patch.chatBackend !== s.chatBackend)
  s.setChatBackendConfig(patch)
  if (changesProvider) forget('chatBackendApiKey')
}

export function changeVoiceConfig(patch: VoicePatch): void {
  const s = useSettingsStore.getState()
  const changesProvider = (patch.ttsProvider !== undefined && patch.ttsProvider !== s.ttsProvider)
    || (patch.ttsBaseUrl !== undefined && patch.ttsBaseUrl !== s.ttsBaseUrl)
  s.setVoiceConfig(patch)
  if (changesProvider) forget('ttsApiKey')
}

export function changeImageBackendConfig(patch: ImagePatch): void {
  const s = useSettingsStore.getState()
  const changesProvider = (patch.imageBackend !== undefined && patch.imageBackend !== s.imageBackend)
    || (patch.imageBackendBaseUrl !== undefined && patch.imageBackendBaseUrl !== s.imageBackendBaseUrl)
  s.setImageBackendConfig(patch)
  if (changesProvider) forget('imageBackendPassword')
}

type PersistedSettings = { state?: Record<string, unknown>; version?: number }

function readPersisted(): PersistedSettings | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    return raw ? (JSON.parse(raw) as PersistedSettings) : null
  } catch {
    return null
  }
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Moves any key still kept in this browser (the settings store and its localStorage copy) to the
 * signed-in user's encrypted store on the server, then blanks the local copies. Run after sign-in.
 * Idempotent; never throws. A key that fails to upload stays where it was, so nothing is lost.
 *
 * NovelAI image generation used to keep its key in `imageBackendUsername`; it now uses the
 * `imageBackendPassword` credential, so that value moves there.
 */
export async function migrateLocalSecrets(): Promise<void> {
  try {
    const live = useSettingsStore.getState() as unknown as Record<string, unknown>
    const persisted = readPersisted()?.state ?? {}
    const value = (field: string) => text(live[field]) || text(persisted[field])

    const uploads: { name: SecretName; value: string; clears: string[] }[] = []
    for (const name of SECRET_SETTING_KEYS) {
      const v = value(name)
      if (v) uploads.push({ name, value: v, clears: [name] })
    }
    const imageBackend = live.imageBackend ?? persisted.imageBackend
    const novelAiImageKey = imageBackend === 'novelai-image' ? value('imageBackendUsername') : ''
    if (novelAiImageKey) {
      const existing = uploads.find((u) => u.name === 'imageBackendPassword')
      if (existing) existing.clears.push('imageBackendUsername')
      else uploads.push({ name: 'imageBackendPassword', value: novelAiImageKey, clears: ['imageBackendUsername'] })
    }
    if (!uploads.length) return

    const cleared: string[] = []
    const failed: string[] = []
    for (const upload of uploads) {
      try {
        await secretsApi.set(upload.name, upload.value)
        cleared.push(...upload.clears)
      } catch (e) {
        failed.push(...upload.clears)
        console.warn(`Could not move the saved ${upload.name} to your account; it stays in this browser for now.`, e)
      }
    }
    if (!cleared.length) return

    const blank = Object.fromEntries(cleared.map((field) => [field, '']))
    // The store's own save leaves credentials out of localStorage, so an older install's copy of a
    // key that failed to upload is put back as it was, for the next attempt after a reload.
    const kept = Object.fromEntries(failed.filter((field) => field in persisted).map((field) => [field, persisted[field]]))
    try {
      useSettingsStore.setState(blank as never)
    } catch (e) {
      console.warn('Could not clear keys from the settings store:', e)
    }
    try {
      const current = readPersisted()
      if (current?.state) {
        localStorage.setItem(PERSIST_KEY, JSON.stringify({ ...current, state: { ...current.state, ...blank, ...kept } }))
      }
    } catch (e) {
      console.warn('Could not clear keys from saved browser settings:', e)
    }
  } catch (e) {
    console.warn('Moving saved keys to your account failed:', e)
  }
}
