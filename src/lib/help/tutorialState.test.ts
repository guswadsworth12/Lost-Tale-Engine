import { describe, expect, it, vi } from 'vitest'
import {
  TUTORIAL_STORAGE_KEY,
  TUTORIAL_VERSION,
  clearTutorialState,
  createTutorialStore,
  parseTutorialState,
  readTutorialState,
  shouldOfferIntro,
  withIntroOutcome,
  writeTutorialState,
  type StorageLike,
} from './tutorialState'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
  removeItem: () => {
    throw new Error('SecurityError')
  },
}

describe('tutorial state storage', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage()
    const state = { version: TUTORIAL_VERSION, intro: 'completed' as const, updatedAt: 123 }
    expect(writeTutorialState(state, storage)).toBe(true)
    expect(readTutorialState(storage)).toEqual(state)
    expect(clearTutorialState(storage)).toBe(true)
    expect(readTutorialState(storage)).toBeNull()
  })

  it('survives a storage that throws on every call', () => {
    expect(readTutorialState(throwingStorage)).toBeNull()
    expect(writeTutorialState({ version: 1, intro: 'skipped', updatedAt: 1 }, throwingStorage)).toBe(false)
    expect(clearTutorialState(throwingStorage)).toBe(false)
  })

  it('treats missing storage as empty', () => {
    expect(readTutorialState(null)).toBeNull()
    expect(writeTutorialState({ version: 1, intro: 'skipped', updatedAt: 1 }, null)).toBe(false)
  })

  it('reads malformed values as no state', () => {
    expect(parseTutorialState('not json')).toBeNull()
    expect(parseTutorialState('42')).toBeNull()
    expect(parseTutorialState('null')).toBeNull()
    expect(parseTutorialState('{"intro":"maybe"}')).toEqual({ version: 0, intro: null, updatedAt: 0 })
  })
})

describe('shouldOfferIntro', () => {
  it('offers until the current version is finished or skipped', () => {
    expect(shouldOfferIntro(null)).toBe(true)
    expect(shouldOfferIntro({ version: TUTORIAL_VERSION, intro: null, updatedAt: 0 })).toBe(true)
    expect(shouldOfferIntro({ version: TUTORIAL_VERSION, intro: 'completed', updatedAt: 0 })).toBe(false)
    expect(shouldOfferIntro({ version: TUTORIAL_VERSION, intro: 'skipped', updatedAt: 0 })).toBe(false)
    expect(shouldOfferIntro({ version: TUTORIAL_VERSION - 1, intro: 'completed', updatedAt: 0 })).toBe(true)
  })

  it('never downgrades a completion to a skip', () => {
    const done = withIntroOutcome(null, 'completed', 5)
    expect(withIntroOutcome(done, 'skipped', 9)).toBe(done)
    expect(withIntroOutcome(done, 'completed', 9)).toMatchObject({ intro: 'completed', updatedAt: 9 })
  })
})

describe('createTutorialStore', () => {
  it('persists outcomes and notifies subscribers', () => {
    const storage = memoryStorage()
    const store = createTutorialStore(() => storage, () => 1000)
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    expect(store.getSnapshot()).toBeNull()
    store.markIntroSkipped()
    expect(store.getSnapshot()).toEqual({ version: TUTORIAL_VERSION, intro: 'skipped', updatedAt: 1000 })
    expect(JSON.parse(storage.data.get(TUTORIAL_STORAGE_KEY)!)).toMatchObject({ intro: 'skipped' })

    store.markIntroDone()
    expect(store.getSnapshot()?.intro).toBe('completed')
    store.reset()
    expect(store.getSnapshot()).toBeNull()
    expect(storage.data.has(TUTORIAL_STORAGE_KEY)).toBe(false)
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
  })

  it('returns a stable snapshot between changes', () => {
    const storage = memoryStorage()
    storage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify({ version: TUTORIAL_VERSION, intro: 'completed', updatedAt: 1 }))
    const store = createTutorialStore(() => storage)
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('keeps working in memory when storage throws', () => {
    const store = createTutorialStore(() => throwingStorage, () => 7)
    expect(store.getSnapshot()).toBeNull()
    expect(() => store.markIntroSkipped()).not.toThrow()
    expect(store.getSnapshot()).toMatchObject({ intro: 'skipped' })
    expect(shouldOfferIntro(store.getSnapshot())).toBe(false)
    expect(() => store.reset()).not.toThrow()
    expect(store.getSnapshot()).toBeNull()
  })

  it('works with no storage at all (no window)', () => {
    const store = createTutorialStore(() => null)
    store.markIntroDone()
    expect(store.getSnapshot()?.intro).toBe('completed')
  })
})
