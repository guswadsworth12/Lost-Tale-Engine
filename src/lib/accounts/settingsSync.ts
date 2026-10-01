/**
 * Keeps the signed-in user's preferences on the server, so they follow the user to any browser.
 *
 * On sign-in (`startSettingsSync`), in order:
 *   1. upload any API keys still sitting in this browser into the user's encrypted vault;
 *   2. load the user's saved preferences: apply them if the server has some, otherwise (their
 *      first sign-in) save this browser's current preferences as theirs;
 *   3. watch the settings store and save a snapshot (credentials and functions removed) 1.5s
 *      after the last change.
 * On sign-out (`endSettingsSession`) the watcher stops and this browser's preferences go back to
 * defaults, so the next person to sign in here never sees the previous one's. The browser also
 * remembers whose preferences it holds (`SETTINGS_OWNER_KEY`): a sign-in by someone else (say,
 * after a session expired while the tab was closed) starts from defaults too, before step 1, so
 * neither their keys nor their preferences are carried over. A browser with no owner recorded
 * (an install from before accounts, when the one user was the owner) hands its preferences and keys
 * to the owner account only; anyone else signing in there starts from defaults.
 */
import { loadSecretFlags, migrateLocalSecrets, secretsApi } from '@/lib/accounts/secrets'
import { migrateToServices, type PreServiceSettings } from '@/lib/api/servicesMigration'
import { meSettingsApi } from '@/lib/accounts/api'
import { inheritsLocalSettings, settingsPatchFromServer, settingsSnapshot } from '@/lib/accounts/settingsSnapshot'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import type { AccountUser } from '@/lib/accounts/contract'

export const SETTINGS_SYNC_DEBOUNCE_MS = 1500
/** localStorage: the id of the user whose preferences this browser currently holds. */
export const SETTINGS_OWNER_KEY = 'rp-settings-user'
const SETTINGS_STORAGE_KEY = 'rp-settings'

/** Bumped on every start/end, so a bootstrap still running for an ended session does nothing. */
let session = 0
let unsubscribe: (() => void) | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let lastSent = ''

function currentSnapshot(): Record<string, unknown> {
  return settingsSnapshot(useSettingsStore.getState())
}

async function send(snapshot: Record<string, unknown>): Promise<void> {
  const serialized = JSON.stringify(snapshot)
  if (serialized === lastSent) return
  await meSettingsApi.put(snapshot)
  lastSent = serialized
}

function stopWatching(): void {
  unsubscribe?.()
  unsubscribe = null
  if (timer) clearTimeout(timer)
  timer = null
}

function readOwner(): string | null {
  try {
    return localStorage.getItem(SETTINGS_OWNER_KEY)
  } catch {
    return null
  }
}

function writeOwner(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(SETTINGS_OWNER_KEY, userId)
    else localStorage.removeItem(SETTINGS_OWNER_KEY)
  } catch {
    // Storage blocked: the in-memory reset still happened.
  }
}

/** Every preference (and any credential still in memory) back to defaults, and nothing left in localStorage. */
function resetLocalSettings(): void {
  useSettingsStore.setState(useSettingsStore.getInitialState(), true)
  useSettingsStore.persist.clearStorage()
  try {
    localStorage.removeItem(SETTINGS_STORAGE_KEY)
  } catch {
    // Storage blocked: nothing persisted to clear.
  }
}

export async function startSettingsSync(user: Pick<AccountUser, 'id' | 'role'>): Promise<void> {
  stopWatching()
  const mine = ++session
  lastSent = ''
  if (!inheritsLocalSettings(user, readOwner())) resetLocalSettings()
  writeOwner(user.id)

  try {
    await migrateLocalSecrets()
  } catch (e) {
    console.warn('Could not move saved API keys to the server:', e)
  }
  if (mine !== session) return

  try {
    const remote = await meSettingsApi.get()
    if (mine !== session) return
    if (remote?.settings) {
      useSettingsStore.setState(settingsPatchFromServer(remote.settings, useSettingsStore.getState()))
      lastSent = JSON.stringify(currentSnapshot())
    } else {
      await send(currentSnapshot())
    }
  } catch (e) {
    console.warn('Could not load saved preferences:', e)
  }
  if (mine !== session) return

  try {
    await moveToServices()
  } catch (e) {
    console.warn('Could not set up services from the earlier settings:', e)
  }
  if (mine !== session) return

  unsubscribe = useSettingsStore.subscribe(() => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (mine !== session) return
      send(currentSnapshot()).catch((e) => console.warn('Could not save preferences:', e))
    }, SETTINGS_SYNC_DEBOUNCE_MS)
  })
}

/**
 * Once per account: the chat, image and voice providers set up before services become services,
 * with their saved keys moved (server-side) to the service that now owns each.
 */
async function moveToServices(): Promise<void> {
  const state = useSettingsStore.getState()
  if (state.servicesMigrated) return
  const { settings, keyMoves } = migrateToServices(state as unknown as PreServiceSettings, await loadSecretFlags())
  for (const { from, to } of keyMoves) {
    // A key that can't be moved is entered again on its service; nothing else depends on it.
    await secretsApi.move(from, to).catch((e) => console.warn(`Could not move the saved ${from} key:`, e))
  }
  useSettingsStore.getState().applyServices(settings)
}

/** Save a pending change now (before an explicit sign-out). */
export async function flushSettingsSync(): Promise<void> {
  if (!timer) return
  clearTimeout(timer)
  timer = null
  await send(currentSnapshot()).catch((e) => console.warn('Could not save preferences:', e))
}

/**
 * Stop syncing. If this browser holds someone's preferences, put them back to defaults (in memory
 * and localStorage). Safe to call when nobody was signed in: a pre-accounts install keeps its
 * preferences for the owner's first sign-in.
 */
export function endSettingsSession(): void {
  session++
  stopWatching()
  lastSent = ''
  if (!readOwner()) return
  resetLocalSettings()
  writeOwner(null)
}
