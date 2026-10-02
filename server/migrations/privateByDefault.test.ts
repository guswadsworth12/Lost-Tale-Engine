import { describe, expect, it, vi } from 'vitest'
import { makePrivateByDefault, planPrivateByDefault, type OwnedTable } from './privateByDefault.ts'

type Row = Record<string, unknown>
const SEED = 'a0000000-0000-4000-8000-000000000001'
const empty = (): Record<OwnedTable, Row[]> => ({
  worlds: [], characters: [], world_info_books: [], personas: [],
  chats: [], stories: [], presets: [], themes: [], instruct_templates: [], assistant_threads: [],
})

describe('making an install private by default', () => {
  it('turns every default share private to its owner, and gives ownerless rows to the site owner', () => {
    const rows = empty()
    rows.worlds = [
      { id: 'w1', visibility: 'shared', ownerUserId: 'bea' },
      { id: 'w2' },
      { id: 'w3', visibility: 'private', ownerUserId: 'bea' },
    ]
    rows.characters = [{ id: 'c1', visibility: 'shared' }]
    expect(planPrivateByDefault(rows, 'site', new Set())).toEqual([
      { table: 'worlds', id: 'w1', patch: { visibility: 'private' } },
      { table: 'worlds', id: 'w2', patch: { visibility: 'private', ownerUserId: 'site' } },
      { table: 'characters', id: 'c1', patch: { visibility: 'private', ownerUserId: 'site' } },
    ])
  })

  it('keeps the bundled starter content shared', () => {
    const rows = empty()
    rows.worlds = [{ id: SEED }, { id: 'mine', visibility: 'shared' }]
    expect(planPrivateByDefault(rows, 'site', new Set([SEED]))).toEqual([
      { table: 'worlds', id: SEED, patch: { visibility: 'shared' } },
      { table: 'worlds', id: 'mine', patch: { visibility: 'private', ownerUserId: 'site' } },
    ])
  })

  it('gives ownerless stories and personal records to the site owner, and leaves others alone', () => {
    const rows = empty()
    rows.chats = [{ id: 'old' }, { id: 'beas', ownerUserId: 'bea' }]
    rows.assistant_threads = [{ id: 't' }]
    expect(planPrivateByDefault(rows, 'site', new Set())).toEqual([
      { table: 'chats', id: 'old', patch: { ownerUserId: 'site' } },
      { table: 'assistant_threads', id: 't', patch: { ownerUserId: 'site' } },
    ])
    // Before anyone has signed up there is no one to give them to: they fall to the site owner later.
    expect(planPrivateByDefault(rows, undefined, new Set())).toEqual([])
  })

  it('runs once, backing up first, so a later deliberate share is never undone', () => {
    let done = false
    const rows: Record<string, Row[]> = { worlds: [{ id: 'w', visibility: 'shared', ownerUserId: 'site' }] }
    const update = vi.fn((table: OwnedTable, id: string, patch: Row) => Object.assign(rows[table].find((r) => r.id === id)!, patch))
    const backup = vi.fn()
    const deps = {
      list: (table: OwnedTable) => rows[table] ?? [],
      update,
      siteOwnerId: () => 'site',
      sharedSeedIds: new Set<string>(),
      done: () => done,
      markDone: () => { done = true },
      backup,
      transaction: (fn: () => void) => fn(),
      log: () => {},
    }
    makePrivateByDefault(deps)
    expect(backup).toHaveBeenCalledOnce()
    expect(rows.worlds[0].visibility).toBe('private')
    // The owner shares it again; the next start leaves that alone.
    rows.worlds[0].visibility = 'shared'
    makePrivateByDefault(deps)
    expect(rows.worlds[0].visibility).toBe('shared')
    expect(update).toHaveBeenCalledOnce()
  })
})
