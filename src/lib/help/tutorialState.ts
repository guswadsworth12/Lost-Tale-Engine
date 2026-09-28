import { useSyncExternalStore } from 'react'

/**
 * First-run tutorial bookkeeping. Deliberately browser-local (localStorage), not a server setting:
 * whether someone has seen the intro is a per-device convenience, and it isn't worth a schema
 * change. Every storage access is wrapped, because `localStorage` can be missing or throw (private
 * windows, blocked site data, a sandboxed preview). When it does, the state lives in memory for
 * the rest of the session, so "Not now" still sticks until reload.
 */

export const TUTORIAL_STORAGE_KEY = 'lost-tales.tutorial'
/** Bump when the guided intro changes enough that people who finished the old one should be offered the new one. */
export const TUTORIAL_VERSION = 1

export type IntroOutcome = 'completed' | 'skipped'

export interface TutorialState {
  /** The intro version this outcome applies to. */
  version: number
  intro: IntroOutcome | null
  updatedAt: number
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** `window.localStorage`, or null if there's no window or merely touching it throws. */
export function defaultTutorialStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    return null
  }
}

/** Parses a stored value. Anything malformed reads as "no state" rather than throwing. */
export function parseTutorialState(raw: string | null | undefined): TutorialState | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    const version = typeof record.version === 'number' && Number.isFinite(record.version) ? record.version : 0
    const intro = record.intro === 'completed' || record.intro === 'skipped' ? record.intro : null
    const updatedAt = typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0
    return { version, intro, updatedAt }
  } catch {
    return null
  }
}

export function readTutorialState(storage: StorageLike | null = defaultTutorialStorage()): TutorialState | null {
  if (!storage) return null
  try {
    return parseTutorialState(storage.getItem(TUTORIAL_STORAGE_KEY))
  } catch {
    return null
  }
}

/** Returns false when the write failed (the caller keeps the value in memory instead). */
export function writeTutorialState(state: TutorialState, storage: StorageLike | null = defaultTutorialStorage()): boolean {
  if (!storage) return false
  try {
    storage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function clearTutorialState(storage: StorageLike | null = defaultTutorialStorage()): boolean {
  if (!storage) return false
  try {
    storage.removeItem(TUTORIAL_STORAGE_KEY)
    return true
  } catch {
    return false
  }
}

/** Offer the intro when it has never been finished or skipped, or only an older version was. */
export function shouldOfferIntro(state: TutorialState | null, version = TUTORIAL_VERSION): boolean {
  return !state || state.intro === null || state.version < version
}

/**
 * Applies an outcome. A skip never overwrites a completion of the same version: replaying the tour
 * from Help and bailing halfway shouldn't read as "never finished it".
 */
export function withIntroOutcome(
  state: TutorialState | null,
  outcome: IntroOutcome,
  now: number,
  version = TUTORIAL_VERSION,
): TutorialState {
  if (outcome === 'skipped' && state?.intro === 'completed' && state.version >= version) return state
  return { version, intro: outcome, updatedAt: now }
}

export interface TutorialStore {
  getSnapshot(): TutorialState | null
  subscribe(listener: () => void): () => void
  markIntroDone(): void
  markIntroSkipped(): void
  reset(): void
}

/**
 * A tiny external store over one storage slot, so every component reading the tutorial state (the
 * first-run prompt, the tour, a Settings "Replay" button) sees the same value and re-renders together.
 * The snapshot is cached; `getSnapshot` returns the same object until something changes.
 */
export function createTutorialStore(
  getStorage: () => StorageLike | null = defaultTutorialStorage,
  now: () => number = Date.now,
): TutorialStore {
  let loaded = false
  let current: TutorialState | null = null
  const listeners = new Set<() => void>()

  const load = () => {
    if (loaded) return
    loaded = true
    current = readTutorialState(getStorage())
  }
  const emit = () => listeners.forEach((listener) => listener())
  const set = (next: TutorialState | null) => {
    current = next
    loaded = true
    if (next) writeTutorialState(next, getStorage())
    else clearTutorialState(getStorage())
    emit()
  }

  // Another tab finishing or resetting the tour. Registered lazily with the first subscriber.
  let detachStorageEvent: (() => void) | null = null
  const attachStorageEvent = () => {
    if (detachStorageEvent || typeof window === 'undefined') return
    const onStorage = (event: StorageEvent) => {
      if (event.key !== null && event.key !== TUTORIAL_STORAGE_KEY) return
      current = readTutorialState(getStorage())
      emit()
    }
    try {
      window.addEventListener('storage', onStorage)
      detachStorageEvent = () => window.removeEventListener('storage', onStorage)
    } catch {
      detachStorageEvent = null
    }
  }

  return {
    getSnapshot() {
      load()
      return current
    },
    subscribe(listener) {
      listeners.add(listener)
      attachStorageEvent()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0 && detachStorageEvent) {
          detachStorageEvent()
          detachStorageEvent = null
        }
      }
    },
    markIntroDone() {
      load()
      set(withIntroOutcome(current, 'completed', now()))
    },
    markIntroSkipped() {
      load()
      const next = withIntroOutcome(current, 'skipped', now())
      if (next !== current) set(next)
    },
    reset() {
      set(null)
    },
  }
}

/** The app-wide store behind `useTutorialState()`. */
export const tutorialStore: TutorialStore = createTutorialStore()

export function useTutorialState() {
  const state = useSyncExternalStore(tutorialStore.subscribe, tutorialStore.getSnapshot, tutorialStore.getSnapshot)
  return {
    state,
    shouldOfferIntro: shouldOfferIntro(state),
    markIntroDone: tutorialStore.markIntroDone,
    markIntroSkipped: tutorialStore.markIntroSkipped,
    /** Forget everything, so the first-run offer shows again. */
    reset: tutorialStore.reset,
  }
}
