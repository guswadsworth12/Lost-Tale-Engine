import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startTestServer, type TestServer } from './httpTestServer.ts'

let t: TestServer
let owner = ''

beforeAll(async () => {
  t = await startTestServer('world-calendar-http')
  owner = await t.setupOwner('cal_owner', 'cal-owner-password')
})

afterAll(async () => {
  await t?.close()
})

describe("a world's own calendar over HTTP (#51)", () => {
  it('saves a cleaned calendar and the advance-time switch, and clears them again', async () => {
    const world = (await t.call('/api/worlds', 'POST', { cookie: owner, body: {
      name: 'Fiore', description: '', lorebook: { entries: [] },
      calendar: {
        startYear: 792, era: ' X ', months: [{ name: 'Hearthmoon', days: 30 }, { name: '  ', days: 10 }, { name: 'Frostfall', days: 500 }],
        holidays: [{ name: 'Roadlight Festival', month: 1, day: 14 }, { name: 'Nope', month: 0, day: 31 }],
        weekdays: ['a', 'b'],
      },
      advanceClockInPlay: true,
    } })).body
    expect(world.calendar).toEqual({
      startYear: 792, era: 'X',
      months: [{ name: 'Hearthmoon', days: 30 }, { name: 'Frostfall', days: 100 }],
      holidays: [{ name: 'Roadlight Festival', month: 1, day: 14 }],
    })
    expect(world.advanceClockInPlay).toBe(true)

    const cleared = await t.call(`/api/worlds/${world.id}`, 'PUT', { cookie: owner, body: { calendar: null, advanceClockInPlay: false } })
    expect(cleared.status).toBe(200)
    expect(cleared.body.calendar).toBeUndefined()
    expect(cleared.body.advanceClockInPlay).toBeUndefined()
  })

  it('keeps a birthday past day 111 for a longer year', async () => {
    const bea = (await t.call('/api/characters', 'POST', { cookie: owner, body: { card: { name: 'Bea' }, birthday: 300 } })).body
    expect(bea.birthday).toBe(300)
  })
})
