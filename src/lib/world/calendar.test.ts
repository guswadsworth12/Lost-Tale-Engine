import { describe, expect, it } from 'vitest'
import {
  ALL_HOLIDAYS,
  CALENDAR_LIMITS,
  WEEKDAYS,
  advanceForPassage,
  clockAfterNarration,
  dayForDate,
  detectTimePassages,
  formatCalendarDate,
  formatYear,
  holidaysOf,
  normalizeCalendar,
  yearLength,
  DAYS_PER_YEAR,
  activityPhase,
  advancePhase,
  daysUntilAnnualDate,
  describePresence,
  describeWeather,
  describeWorldMoment,
  getCalendarInfo,
  getCurrentActivity,
  getEnergyRemaining,
  getMaxEnergyForDay,
  getMoodOfDay,
  getWeather,
  detectNarratedPhase,
  isNightPhase,
  PHASES,
  resolveScheduledPresence,
  spendEnergy,
  WEATHER_KINDS,
  type ScheduleEntry,
} from './calendar'

describe('getCalendarInfo', () => {
  it('starts day 0 on spring, day-of-season 1, Monday, no holiday', () => {
    const info = getCalendarInfo(0)
    expect(info).toMatchObject({ day: 0, season: 'spring', dayOfSeason: 1, weekday: 'monday', holiday: undefined })
  })

  it('every season starts on a Monday', () => {
    for (const seasonStart of [0, 28, 56, 84]) {
      expect(getCalendarInfo(seasonStart).weekday).toBe('monday')
      expect(getCalendarInfo(seasonStart).dayOfSeason).toBe(1)
    }
  })

  it('places each season in order across the 112-day year', () => {
    expect(getCalendarInfo(0).season).toBe('spring')
    expect(getCalendarInfo(27).season).toBe('spring')
    expect(getCalendarInfo(28).season).toBe('summer')
    expect(getCalendarInfo(55).season).toBe('summer')
    expect(getCalendarInfo(56).season).toBe('autumn')
    expect(getCalendarInfo(83).season).toBe('autumn')
    expect(getCalendarInfo(84).season).toBe('winter')
    expect(getCalendarInfo(111).season).toBe('winter')
  })

  it('wraps past the end of the year back to spring day 0', () => {
    expect(getCalendarInfo(DAYS_PER_YEAR)).toEqual(getCalendarInfo(0))
    expect(getCalendarInfo(DAYS_PER_YEAR + 5)).toEqual(getCalendarInfo(5))
  })

  it('wraps negative day numbers correctly instead of producing a negative index', () => {
    expect(getCalendarInfo(-1)).toEqual(getCalendarInfo(DAYS_PER_YEAR - 1))
  })

  it('fires exactly one holiday per season, at the midpoint', () => {
    expect(getCalendarInfo(13).holiday).toBe('First Bloom')
    expect(getCalendarInfo(12).holiday).toBeUndefined()
    expect(getCalendarInfo(14).holiday).toBeUndefined()
    expect(getCalendarInfo(28 + 13).holiday).toBe('Midsummer Night')
    expect(getCalendarInfo(56 + 13).holiday).toBe('Lantern Festival')
    expect(getCalendarInfo(84 + 13).holiday).toBe('Long Night')
  })
})

describe('getWeather / getMoodOfDay', () => {
  it('is deterministic — the same day always produces the same result', () => {
    expect(getWeather('world-1', 40)).toBe(getWeather('world-1', 40))
    expect(getMoodOfDay('char-1', 40)).toBe(getMoodOfDay('char-1', 40))
  })

  it('varies by world/character id, not just by day', () => {
    const results = new Set(['world-a', 'world-b', 'world-c', 'world-d'].map((id) => getWeather(id, 10)))
    expect(results.size).toBeGreaterThan(1)
  })

  it('only ever returns a defined weather kind', () => {
    for (let day = 0; day < DAYS_PER_YEAR; day++) {
      expect(WEATHER_KINDS).toContain(getWeather('w', day))
    }
  })

  it('never picks snow in summer', () => {
    for (let day = 28; day < 56; day++) {
      for (let seed = 0; seed < 20; seed++) {
        expect(getWeather(`world-${seed}`, day)).not.toBe('snow')
      }
    }
  })
})

describe('describeWeather', () => {
  it('has a display string for every weather kind', () => {
    for (const kind of WEATHER_KINDS) {
      expect(describeWeather(kind)).toBeTruthy()
    }
  })
})

describe('advancePhase', () => {
  it('steps through morning -> afternoon -> evening -> night within the same day', () => {
    let state = { day: 5, phaseIndex: 0 }
    for (let i = 1; i < PHASES.length; i++) {
      state = advancePhase(state.day, state.phaseIndex)
      expect(state).toEqual({ day: 5, phaseIndex: i })
    }
  })

  it('rolls over to the next day at morning after night', () => {
    expect(advancePhase(5, PHASES.length - 1)).toEqual({ day: 6, phaseIndex: 0 })
  })
})

describe('isNightPhase', () => {
  it('reads morning and afternoon as day', () => {
    expect(isNightPhase(PHASES.indexOf('morning'))).toBe(false)
    expect(isNightPhase(PHASES.indexOf('afternoon'))).toBe(false)
  })

  it('reads evening and night as night', () => {
    expect(isNightPhase(PHASES.indexOf('evening'))).toBe(true)
    expect(isNightPhase(PHASES.indexOf('night'))).toBe(true)
  })

  it('defaults to day when unset', () => {
    expect(isNightPhase(undefined)).toBe(false)
  })
})

describe('getMaxEnergyForDay', () => {
  it('gives 3 actions on a weekday', () => {
    for (const day of [0, 1, 2, 3, 4]) expect(getMaxEnergyForDay(day)).toBe(3)
  })

  it('gives 4 actions on a weekend', () => {
    expect(getMaxEnergyForDay(5)).toBe(4) // Saturday
    expect(getMaxEnergyForDay(6)).toBe(4) // Sunday
  })
})

describe('getEnergyRemaining', () => {
  it('starts the day at the full weekday allowance', () => {
    expect(getEnergyRemaining(0, 0)).toBe(3)
  })

  it('counts down as the phase advances', () => {
    expect(getEnergyRemaining(0, 1)).toBe(2)
    expect(getEnergyRemaining(0, 2)).toBe(1)
  })

  it('floors at 0 rather than going negative', () => {
    expect(getEnergyRemaining(0, 3)).toBe(0)
    expect(getEnergyRemaining(0, 10)).toBe(0)
  })

  it('reflects the weekend bonus action at night', () => {
    expect(getEnergyRemaining(5, 3)).toBe(1)
  })
})

describe('spendEnergy', () => {
  it('steps the phase forward normally while energy remains', () => {
    expect(spendEnergy(0, 0)).toEqual({ day: 0, phaseIndex: 1, slept: false })
    expect(spendEnergy(0, 1)).toEqual({ day: 0, phaseIndex: 2, slept: false })
  })

  it('forces a rollover to next morning once a weekday runs out at night', () => {
    // Monday evening (phase 2), remaining energy 1 — this spend reaches night with 0 left,
    // so it should roll straight on rather than stranding the world at night with nothing to do.
    expect(spendEnergy(0, 2)).toEqual({ day: 1, phaseIndex: 0, slept: true })
  })

  it("lets a weekend's bonus action be spent at night, rolling over naturally", () => {
    // Saturday night (phase 3) still has 1 energy left (weekend max 4) — advancePhase's own
    // night -> next-morning wraparound already lands exactly on the rollover, no forcing needed.
    expect(spendEnergy(5, 3)).toEqual({ day: 6, phaseIndex: 0, slept: true })
  })

  it('never leaves the day sitting at a phase with 0 energy remaining', () => {
    let state = { day: 0, phaseIndex: 0 }
    for (let i = 0; i < 3; i++) {
      const result = spendEnergy(state.day, state.phaseIndex)
      state = { day: result.day, phaseIndex: result.phaseIndex }
      if (i < 2) expect(result.slept).toBe(false)
    }
    expect(state).toEqual({ day: 1, phaseIndex: 0 })
    expect(getEnergyRemaining(state.day, state.phaseIndex)).toBe(3)
  })
})

describe('activityPhase', () => {
  it('matches spendEnergy exactly when nothing forces a rollover', () => {
    expect(activityPhase(0, 0)).toEqual({ day: 0, phaseIndex: 1 })
    expect(activityPhase(0, 1)).toEqual({ day: 0, phaseIndex: 2 })
  })

  it('recovers the Night phase a forced weekday rollover discards', () => {
    // Same Monday-evening spend as spendEnergy's own test above: spendEnergy(0, 2) jumps straight
    // to { day: 1, phaseIndex: 0 } with no trace that the activity happened at Night — this is the
    // one place that phase is recoverable.
    expect(spendEnergy(0, 2)).toEqual({ day: 1, phaseIndex: 0, slept: true })
    expect(activityPhase(0, 2)).toEqual({ day: 0, phaseIndex: 3 })
  })

  it("keeps a weekend's bonus action grounded at Night, not next morning", () => {
    // spendEnergy(5, 3) also rolls to { day: 6, phaseIndex: 0 } — but here the activity started
    // *at* Night (phase 3 was the caller's own phase), not a phase advancePhase stepped into.
    expect(spendEnergy(5, 3)).toEqual({ day: 6, phaseIndex: 0, slept: true })
    expect(activityPhase(5, 3)).toEqual({ day: 5, phaseIndex: 3 })
  })
})

describe('describeWorldMoment', () => {
  it('mentions the phase, season, weekday, and mood', () => {
    const line = describeWorldMoment({ worldId: 'w1', characterId: 'c1', day: 0, phaseIndex: 0 })
    expect(line).toContain('morning')
    expect(line).toContain('spring')
    expect(line).toContain('monday')
    expect(line).toMatch(/feeling .+ today/)
  })

  it('mentions the holiday on a holiday day', () => {
    const line = describeWorldMoment({ worldId: 'w1', characterId: 'c1', day: 13, phaseIndex: 0 })
    expect(line).toContain('First Bloom')
  })

  it('notes a loved weather kind without dictating the scene', () => {
    // Find a day where this world's weather actually is 'clear', then assert the note appears.
    let day = 0
    while (getWeather('w-loves-clear', day) !== 'clear' && day < DAYS_PER_YEAR) day++
    const line = describeWorldMoment({
      worldId: 'w-loves-clear',
      characterId: 'c1',
      day,
      phaseIndex: 0,
      weatherPreferences: { loves: ['clear'] },
    })
    expect(line).toContain('loves')
  })

  it('omits the preference note when the weather is neither loved nor hated', () => {
    const line = describeWorldMoment({
      worldId: 'w1',
      characterId: 'c1',
      day: 0,
      phaseIndex: 0,
      weatherPreferences: { loves: ['snow'], hates: ['storm'] },
    })
    expect(line).not.toContain('loves')
    expect(line).not.toContain('dislikes')
  })
})

describe('getCurrentActivity', () => {
  it('defaults to available with no schedule at all', () => {
    expect(getCurrentActivity(undefined, 0, 0)).toEqual({ status: 'available' })
    expect(getCurrentActivity([], 0, 0)).toEqual({ status: 'available' })
  })

  it('defaults to available when nothing matches the current phase', () => {
    const schedule: ScheduleEntry[] = [{ id: '1', phase: 'night', status: 'sleeping', activity: 'Asleep' }]
    // day 0 is a Monday; phaseIndex 0 is morning — the entry above only covers night.
    expect(getCurrentActivity(schedule, 0, 0)).toEqual({ status: 'available' })
  })

  it('matches an "every day" entry (no days set) for the right phase', () => {
    const schedule: ScheduleEntry[] = [
      { id: '1', phase: 'morning', status: 'busy', activity: 'Opening the bakery', location: 'Bakery' },
    ]
    expect(getCurrentActivity(schedule, 0, 0)).toEqual({
      status: 'busy',
      activity: 'Opening the bakery',
      location: 'Bakery',
    })
  })

  it('a day-specific entry beats an "every day" entry for the same phase', () => {
    const schedule: ScheduleEntry[] = [
      { id: '1', phase: 'morning', status: 'busy', activity: 'Opening the bakery' },
      { id: '2', phase: 'morning', status: 'traveling', activity: 'Market day in the city', days: ['monday'] },
    ]
    // day 0 is a Monday.
    expect(getCurrentActivity(schedule, 0, 0).activity).toBe('Market day in the city')
    // day 1 is a Tuesday — falls back to the every-day entry.
    expect(getCurrentActivity(schedule, 1, 0).activity).toBe('Opening the bakery')
  })

  it('does not match a day-specific entry on a day it does not cover', () => {
    const schedule: ScheduleEntry[] = [
      { id: '1', phase: 'evening', status: 'busy', activity: 'Weekend shift', days: ['saturday', 'sunday'] },
    ]
    // day 0 (Monday) isn't in the entry's days, and there's no every-day fallback.
    expect(getCurrentActivity(schedule, 0, 2)).toEqual({ status: 'available' })
  })
})

describe('detectNarratedPhase', () => {
  it('returns undefined when nothing time-anchoring is said', () => {
    expect(detectNarratedPhase('She shelves a book and does not look up.')).toBeUndefined()
    expect(detectNarratedPhase('')).toBeUndefined()
    expect(detectNarratedPhase(undefined)).toBeUndefined()
  })

  it('reads an explicit day jump as the next morning', () => {
    expect(detectNarratedPhase('The next morning. Rain again.')).toBe('morning')
    expect(detectNarratedPhase('*The following day, I catch her at the gate.*')).toBe('morning')
  })

  it('maps lunch / after-school cues to afternoon', () => {
    expect(detectNarratedPhase('At lunch, on the covered rooftop.')).toBe('afternoon')
    expect(detectNarratedPhase('After school she is still at the same table.')).toBe('afternoon')
  })

  it('maps dusk / that evening to evening, and that night / after dark to night', () => {
    expect(detectNarratedPhase('Later that evening, the library has emptied out.')).toBe('evening')
    expect(detectNarratedPhase('We talk until late that night.')).toBe('night')
    expect(detectNarratedPhase('It is well after dark by the time we leave.')).toBe('night')
  })

  it('takes the earliest cue when a message mentions time more than once', () => {
    expect(detectNarratedPhase('The next morning was slow; by that night nothing had changed.')).toBe('morning')
  })
})

describe('resolveScheduledPresence', () => {
  // Mirrors the shipped Sumire seed: weekday mornings are "busy — In class", weekday evenings are
  // "free — Home ... at Her apartment", and one afternoon slot is "free ... at School Library".
  const schedule: ScheduleEntry[] = [
    { id: 'classes', days: ['monday', 'tuesday'], phase: 'morning', status: 'busy', activity: 'In class', location: 'Sakura Hill High School' },
    { id: 'mwf-lib', days: ['monday'], phase: 'afternoon', status: 'available', activity: 'At her library table', location: 'School Library' },
    { id: 'evening-home', phase: 'evening', status: 'available', activity: 'Home with a light novel', location: 'Her apartment' },
  ]

  it('keeps the clock slot wholesale when no scene location is set', () => {
    expect(resolveScheduledPresence(schedule, 0, 0, undefined)).toEqual(getCurrentActivity(schedule, 0, 0))
    expect(resolveScheduledPresence(schedule, 0, 0, '  ')).toMatchObject({ status: 'busy', activity: 'In class' })
  })

  it('keeps the clock slot wholesale when its own location already matches the scene', () => {
    // day 0 (Monday) afternoon — the library slot, and the scene is the library.
    expect(resolveScheduledPresence(schedule, 0, 1, 'Library')).toEqual({
      status: 'available',
      activity: 'At her library table',
      location: 'School Library',
    })
  })

  it('trusts an established scene that matches a different available slot over the frozen busy clock', () => {
    const resolved = resolveScheduledPresence(schedule, 0, 0, 'Library')
    expect(resolved).toEqual({ status: 'available', activity: 'At her library table', location: 'School Library' })
  })

  it('trusts the scene-matching slot over an available clock slot that points somewhere else', () => {
    // day 0 (Monday) evening — clock says "Home ... at Her apartment", but the scene is the library.
    expect(resolveScheduledPresence(schedule, 0, 2, 'Library')).toEqual({
      status: 'available',
      activity: 'At her library table',
      location: 'School Library',
    })
  })

  it('drops the stale activity/location but keeps the status when the scene is somewhere the schedule never describes', () => {
    // Busy clock + a scene the schedule can't place → status only, and the busy-conflict friction still fires downstream.
    expect(resolveScheduledPresence(schedule, 0, 0, 'the train station')).toEqual({ status: 'busy' })
    // Available clock + an unlisted scene spot → "free", no contradicting apartment/activity clause.
    expect(resolveScheduledPresence(schedule, 0, 2, 'the rooftop')).toEqual({ status: 'available' })
  })
})

describe('describePresence', () => {
  it('describes a plain status with no activity', () => {
    expect(describePresence({ status: 'sleeping' })).toBe('{{char}} is currently asleep.')
  })

  it('includes the activity and location when present', () => {
    expect(describePresence({ status: 'busy', activity: 'Opening the bakery', location: 'Bakery' })).toBe(
      '{{char}} is currently busy — Opening the bakery at Bakery.',
    )
  })

  it('includes the activity without a location clause when location is unset', () => {
    expect(describePresence({ status: 'traveling', activity: 'Heading to market' })).toBe(
      '{{char}} is currently traveling — Heading to market.',
    )
  })
})

describe('daysUntilAnnualDate', () => {
  it('is 0 when today already is the target day-of-year', () => {
    expect(daysUntilAnnualDate(15, 15)).toBe(0)
  })

  it('counts forward within the same year', () => {
    expect(daysUntilAnnualDate(10, 15)).toBe(5)
  })

  it('wraps forward across the year boundary rather than going negative', () => {
    // Target already passed this year (day 5) — counts forward to day 5 of *next* year instead.
    expect(daysUntilAnnualDate(110, 5)).toBe(DAYS_PER_YEAR - 110 + 5)
  })

  it('normalizes an absolute day far beyond one year the same as its wrapped equivalent', () => {
    expect(daysUntilAnnualDate(DAYS_PER_YEAR * 3 + 10, 15)).toBe(5)
  })
})

describe('ALL_HOLIDAYS', () => {
  it('lists exactly one holiday per season, each landing on its own actual holiday per getCalendarInfo', () => {
    expect(ALL_HOLIDAYS).toHaveLength(4)
    for (const holiday of ALL_HOLIDAYS) {
      expect(getCalendarInfo(holiday.dayOfYear).holiday).toBe(holiday.name)
    }
  })
})

describe('a world with its own calendar (#51)', () => {
  // A 12-month year of 30 days, written "X792", with renamed days and two holidays.
  const fiore = normalizeCalendar({
    startYear: 792,
    era: 'X',
    months: Array.from({ length: 12 }, (_, i) => ({ name: `Month ${i + 1}`, days: 30 })),
    weekdays: ['Moonday', 'Tideday', 'Windday', 'Thunderday', 'Fireday', 'Starday', 'Sunday'],
    holidays: [{ name: 'Roadlight Festival', month: 10, day: 14 }, { name: 'Nowhere', month: 2, day: 31 }],
  })!

  it('counts years with their era, months by name, and weeks straight through the year', () => {
    expect(yearLength(fiore)).toBe(360)
    expect(getCalendarInfo(0, fiore)).toMatchObject({ year: 792, yearLabel: 'X792', month: 'Month 1', dayOfMonth: 1, weekday: 'monday', weekdayName: 'Moonday', custom: true })
    const roadlight = dayForDate(fiore, { year: 792, monthIndex: 10, dayOfMonth: 14 })
    expect(getCalendarInfo(roadlight, fiore)).toMatchObject({ month: 'Month 11', dayOfMonth: 14, holiday: 'Roadlight Festival' })
    expect(getCalendarInfo(360, fiore)).toMatchObject({ year: 793, month: 'Month 1', dayOfMonth: 1 })
    // 360 isn't a multiple of 7, so the new year doesn't restart the week.
    expect(getCalendarInfo(360, fiore).weekday).toBe(WEEKDAYS[360 % 7])
    expect(formatCalendarDate(getCalendarInfo(roadlight, fiore))).toBe(`${getCalendarInfo(roadlight, fiore).weekdayName}, 14 Month 11, X792`)
    expect(daysUntilAnnualDate(0, holidaysOf(fiore)[0].dayOfYear, fiore)).toBe(roadlight)
  })

  it('cleans what it stores: real holidays only, seven weekday names or none, capped lengths', () => {
    expect(fiore.holidays).toEqual([{ name: 'Roadlight Festival', month: 10, day: 14 }])
    expect(normalizeCalendar({ months: [] })).toBeUndefined()
    expect(normalizeCalendar({ months: [{ name: 'Only', days: 5000 }] })!.months[0].days).toBe(CALENDAR_LIMITS.monthDays)
    expect(normalizeCalendar({ months: [{ name: 'A', days: 10 }], weekdays: ['One', 'Two'] })!.weekdays).toBeUndefined()
    expect(formatYear(12, { era: 'AC' })).toBe('AC 12')
    expect(formatYear(12, { era: 'AC', eraAfter: true })).toBe('12 AC')
    expect(formatYear(12, {})).toBe('Year 12')
  })

  it('leaves worlds without one exactly as they were', () => {
    expect(getCalendarInfo(15)).toMatchObject({ season: 'spring', dayOfSeason: 16, weekday: 'tuesday', custom: false })
    expect(formatCalendarDate(getCalendarInfo(13))).toBe('sunday, spring (14/28)')
    expect(holidaysOf()).toEqual(ALL_HOLIDAYS)
  })
})

describe('time the story says has passed (#51)', () => {
  it('moves forward on phrases that pass time, in the order they come', () => {
    expect(clockAfterNarration(4, 0, 'We part ways. That evening, the lanterns go up.')).toEqual({ day: 4, phaseIndex: 2 })
    expect(clockAfterNarration(4, 2, 'The next morning, rain.')).toEqual({ day: 5, phaseIndex: 0 })
    expect(clockAfterNarration(4, 1, 'That night we keep watch. The next morning we set out.')).toEqual({ day: 5, phaseIndex: 0 })
    expect(clockAfterNarration(4, 1, 'Two days later, the letter arrives.')).toEqual({ day: 6, phaseIndex: 1 })
    expect(clockAfterNarration(4, 3, 'Hours pass.')).toEqual({ day: 5, phaseIndex: 0 })
    // Naming an earlier part of the day means the next one, never going back.
    expect(clockAfterNarration(4, 3, 'By dawn the fog has lifted.')).toEqual({ day: 5, phaseIndex: 0 })
  })

  it('ignores speech, plain mentions of a time, and a time that is already now', () => {
    expect(clockAfterNarration(4, 0, '"See you the next morning," she says.')).toBeUndefined()
    expect(clockAfterNarration(4, 0, 'Good night. This morning was long.')).toBeUndefined()
    expect(clockAfterNarration(4, 2, 'That evening, nobody speaks.')).toBeUndefined()
    expect(detectTimePassages('I wave. “A week later,” I joke.')).toEqual([])
  })

  it('lands where a passage says from wherever the clock is', () => {
    expect(advanceForPassage(1, 2, { days: 0, phase: 'afternoon' })).toEqual({ day: 2, phaseIndex: 1 })
    expect(advanceForPassage(1, 2, { days: 7, phase: 'morning' })).toEqual({ day: 8, phaseIndex: 0 })
    expect(advanceForPassage(1, 2, { days: 0, phases: 1 })).toEqual({ day: 1, phaseIndex: 3 })
  })
})
