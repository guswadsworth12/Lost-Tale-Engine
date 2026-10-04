/**
 * A deterministic, shared "living world" clock. Everything here is a pure function of an absolute
 * day number (plus a seed id for weather/mood) — only `WorldCard.currentDay`/`currentPhaseIndex`
 * are actually stored; season, weekday, holiday, weather, and mood-of-day are all recomputed on
 * demand and always reproducible for the same inputs.
 *
 * A world can bring its own calendar (`WorldCard.calendar`, #51): a year count with an era, its own
 * months and their lengths, names for the seven weekdays, and holidays. Without one, the built-in
 * year below applies: four 28-day seasons and a holiday at each season's midpoint.
 */

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const
export type Season = (typeof SEASONS)[number]

export const DAYS_PER_SEASON = 28
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length // 112

export const PHASES = ['morning', 'afternoon', 'evening', 'night'] as const
export type DayPhase = (typeof PHASES)[number]

export const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
export type Weekday = (typeof WEEKDAYS)[number]

/** One fixed holiday per season, placed at each season's midpoint (day 14 of 28). */
const HOLIDAYS: Record<Season, { name: string; dayOfSeason: number }> = {
  spring: { name: 'First Bloom', dayOfSeason: 14 },
  summer: { name: 'Midsummer Night', dayOfSeason: 14 },
  autumn: { name: 'Lantern Festival', dayOfSeason: 14 },
  winter: { name: 'Long Night', dayOfSeason: 14 },
}

/** One month of a world's own calendar. Unset `season` follows where the month falls in the year. */
export interface CalendarMonth {
  name: string
  days: number
  season?: Season
}

/** A holiday in a world's own calendar: `month` indexes `WorldCalendar.months`, `day` is 1-based. */
export interface CalendarHoliday {
  name: string
  month: number
  day: number
}

/** A world's own calendar (`WorldCard.calendar`). Weeks stay seven days, so schedules keep working. */
export interface WorldCalendar {
  /** The year day 0 falls in. */
  startYear: number
  /** Written with the year: "X" makes "X792", "AC" makes "AC 792", or after it with `eraAfter`. */
  era?: string
  eraAfter?: boolean
  months: CalendarMonth[]
  /** Names for the seven days, Monday's slot first. Unset: Monday to Sunday. */
  weekdays?: string[]
  holidays?: CalendarHoliday[]
}

export const CALENDAR_LIMITS = { months: 24, monthDays: 100, yearDays: 1000, holidays: 60, name: 60, year: 1_000_000 }

export interface CalendarInfo {
  /** Day of the year, 0-based (the absolute day wrapped into the year). */
  day: number
  season: Season
  /** 1-28 on the built-in calendar; the day of the month on a world's own. */
  dayOfSeason: number
  /** The schedule weekday: always one of `WEEKDAYS`, whatever the world calls it. */
  weekday: Weekday
  /** What the world calls today. */
  weekdayName: string
  holiday?: string
  month: string
  monthIndex: number
  /** 1-based. */
  dayOfMonth: number
  monthDays: number
  /** Only a world's own calendar counts years. */
  year?: number
  yearLabel?: string
  custom: boolean
}

interface ResolvedCalendar {
  custom: boolean
  months: { name: string; days: number; season: Season; start: number }[]
  yearLength: number
  weekdays: string[]
  holidays: { name: string; dayOfYear: number }[]
  startYear: number
  era?: string
  eraAfter?: boolean
}

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

const BUILT_IN: ResolvedCalendar = {
  custom: false,
  months: SEASONS.map((season, i) => ({ name: capitalized(season), days: DAYS_PER_SEASON, season, start: i * DAYS_PER_SEASON })),
  yearLength: DAYS_PER_YEAR,
  weekdays: [...WEEKDAYS],
  holidays: SEASONS.map((season, i) => ({ name: HOLIDAYS[season].name, dayOfYear: i * DAYS_PER_SEASON + HOLIDAYS[season].dayOfSeason - 1 })),
  startYear: 0,
}

const resolvedCache = new WeakMap<WorldCalendar, ResolvedCalendar>()

/** The calendar a world plays on: its own (once it has a month), else the built-in one. */
function resolveCalendar(cal?: WorldCalendar | null): ResolvedCalendar {
  if (!cal?.months?.length) return BUILT_IN
  const cached = resolvedCache.get(cal)
  if (cached) return cached
  let start = 0
  const sized = cal.months.map((m) => {
    const days = Math.max(1, Math.round(m.days) || 1)
    const month = { name: m.name, days, start, season: m.season }
    start += days
    return month
  })
  const yearLength = start
  const months = sized.map((m) => ({
    ...m,
    // A month without its own season takes the quarter of the year its middle falls in.
    season: m.season ?? SEASONS[Math.min(3, Math.floor(((m.start + m.days / 2) / yearLength) * 4))],
  }))
  const weekdays = WEEKDAYS.map((id, i) => cal.weekdays?.[i]?.trim() || capitalized(id))
  const holidays = (cal.holidays ?? []).flatMap((h) => {
    const month = months[h.month]
    return month && h.day >= 1 && h.day <= month.days ? [{ name: h.name, dayOfYear: month.start + h.day - 1 }] : []
  })
  const resolved: ResolvedCalendar = { custom: true, months, yearLength, weekdays, holidays, startYear: cal.startYear ?? 1, era: cal.era?.trim() || undefined, eraAfter: cal.eraAfter }
  resolvedCache.set(cal, resolved)
  return resolved
}

const mod = (n: number, m: number) => ((n % m) + m) % m

/** "X792", "AC 792", "792 AC", or "Year 792". */
export function formatYear(year: number, cal?: Pick<WorldCalendar, 'era' | 'eraAfter'> | null): string {
  const era = cal?.era?.trim()
  if (!era) return `Year ${year}`
  if (cal?.eraAfter) return `${year} ${era}`
  return era.length === 1 ? `${era}${year}` : `${era} ${year}`
}

export function getCalendarInfo(day: number, cal?: WorldCalendar | null): CalendarInfo {
  const r = resolveCalendar(cal)
  const wrapped = mod(day, r.yearLength)
  const monthIndex = Math.max(0, r.months.findIndex((m) => wrapped >= m.start && wrapped < m.start + m.days))
  const month = r.months[monthIndex]
  const dayOfMonth = wrapped - month.start + 1
  // Weeks run straight through the years. On the built-in calendar every season starts on a Monday
  // (112 and 28 are multiples of 7), as it always has.
  const weekdayIndex = mod(day, 7)
  const holiday = r.holidays.filter((h) => h.dayOfYear === wrapped).map((h) => h.name).join(' & ') || undefined
  const year = r.custom ? r.startYear + Math.floor(day / r.yearLength) : undefined
  return {
    day: wrapped,
    season: month.season,
    dayOfSeason: dayOfMonth,
    weekday: WEEKDAYS[weekdayIndex],
    weekdayName: r.weekdays[weekdayIndex],
    holiday,
    month: month.name,
    monthIndex,
    dayOfMonth,
    monthDays: month.days,
    year,
    yearLabel: year === undefined ? undefined : formatYear(year, cal),
    custom: r.custom,
  }
}

/** Today as people would say it: "monday, spring (14/28)" built in, or "Monday, 14 Hearthmoon, X792". */
export function formatCalendarDate(info: CalendarInfo): string {
  if (!info.custom) return `${info.weekday}, ${info.season} (${info.dayOfSeason}/${info.monthDays})`
  return `${info.weekdayName}, ${info.dayOfMonth} ${info.month}, ${info.yearLabel}`
}

/** The date without the weekday, for compact panels: "spring day 14" built in, or "14 Hearthmoon, X792". */
export function formatShortDate(info: CalendarInfo): string {
  return info.custom ? `${info.dayOfMonth} ${info.month}, ${info.yearLabel}` : `${info.season} day ${info.dayOfSeason}`
}

/** A day of the year as a date without the weekday: "spring, day 14" or "14 Hearthmoon". */
export function formatDayOfYear(dayOfYear: number, cal?: WorldCalendar | null): string {
  const info = getCalendarInfo(dayOfYear, cal)
  return info.custom ? `${info.dayOfMonth} ${info.month}` : `${capitalized(info.season)}, day ${info.dayOfSeason}/${info.monthDays}`
}

/** How long a year is: 112 days built in. */
export function yearLength(cal?: WorldCalendar | null): number {
  return resolveCalendar(cal).yearLength
}

/** The months of the year, in order, with where each starts (day of the year). */
export function calendarMonths(cal?: WorldCalendar | null): { name: string; days: number; season: Season; start: number }[] {
  return resolveCalendar(cal).months
}

/** The absolute day for a date on a world's own calendar (or a built-in "year" counted from 0). */
export function dayForDate(cal: WorldCalendar | null | undefined, date: { year: number; monthIndex: number; dayOfMonth: number }): number {
  const r = resolveCalendar(cal)
  const month = r.months[Math.max(0, Math.min(r.months.length - 1, date.monthIndex))]
  const dayOfMonth = Math.max(1, Math.min(month.days, Math.round(date.dayOfMonth)))
  return (date.year - r.startYear) * r.yearLength + month.start + dayOfMonth - 1
}

/** Every named holiday's fixed day-of-year (0–111), derived from `HOLIDAYS` — exported so a
 *  calendar view can list them without recomputing the season/day math itself. */
export const ALL_HOLIDAYS: { name: string; dayOfYear: number }[] = BUILT_IN.holidays

/** A world's holidays by day of the year: its own, or the built-in four. */
export function holidaysOf(cal?: WorldCalendar | null): { name: string; dayOfYear: number }[] {
  return resolveCalendar(cal).holidays
}

/** Days from `day` until the next occurrence of `targetDayOfYear` (a day-of-year) — `0` means
 *  today, wrapping forward through the year otherwise. Shared by birthdays, commitment
 *  anniversaries, and holidays alike — each is just "a day-of-year to count down to." A target
 *  past the end of a shorter custom year wraps into it. */
export function daysUntilAnnualDate(day: number, targetDayOfYear: number, cal?: WorldCalendar | null): number {
  const length = yearLength(cal)
  const todayOfYear = getCalendarInfo(day, cal).day
  return mod(mod(targetDayOfYear, length) - todayOfYear, length)
}

/**
 * A calendar as sent by an editor or a pack, made safe to store: names trimmed and capped, months
 * and days within `CALENDAR_LIMITS`, exactly seven weekday names or none, holidays that land on a
 * real day. Undefined when there's no usable month, which means the built-in calendar.
 */
export function normalizeCalendar(raw: unknown): WorldCalendar | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const value = raw as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, CALENDAR_LIMITS.name) : '')
  let total = 0
  const months: CalendarMonth[] = []
  for (const m of Array.isArray(value.months) ? value.months.slice(0, CALENDAR_LIMITS.months) : []) {
    if (!m || typeof m !== 'object') continue
    const month = m as Record<string, unknown>
    const name = text(month.name)
    const days = typeof month.days === 'number' && Number.isFinite(month.days) ? Math.round(month.days) : 0
    if (!name || days < 1) continue
    const capped = Math.min(days, CALENDAR_LIMITS.monthDays, CALENDAR_LIMITS.yearDays - total)
    if (capped < 1) break
    total += capped
    const season = SEASONS.includes(month.season as Season) ? (month.season as Season) : undefined
    months.push({ name, days: capped, ...(season ? { season } : {}) })
  }
  if (!months.length) return undefined
  const startYear = typeof value.startYear === 'number' && Number.isFinite(value.startYear)
    ? Math.max(-CALENDAR_LIMITS.year, Math.min(CALENDAR_LIMITS.year, Math.round(value.startYear)))
    : 1
  const era = text(value.era)
  const weekdayNames = Array.isArray(value.weekdays) ? value.weekdays.map(text) : []
  const weekdays = weekdayNames.length === 7 && weekdayNames.some(Boolean) ? weekdayNames : undefined
  const holidays: CalendarHoliday[] = []
  for (const h of Array.isArray(value.holidays) ? value.holidays.slice(0, CALENDAR_LIMITS.holidays) : []) {
    if (!h || typeof h !== 'object') continue
    const holiday = h as Record<string, unknown>
    const name = text(holiday.name)
    const month = typeof holiday.month === 'number' ? Math.round(holiday.month) : -1
    const day = typeof holiday.day === 'number' ? Math.round(holiday.day) : 0
    if (name && months[month] && day >= 1 && day <= months[month].days) holidays.push({ name, month, day })
  }
  return {
    startYear,
    ...(era ? { era } : {}),
    ...(era && value.eraAfter === true ? { eraAfter: true } : {}),
    months,
    ...(weekdays ? { weekdays } : {}),
    ...(holidays.length ? { holidays } : {}),
  }
}

export const WEATHER_KINDS = ['clear', 'rain', 'storm', 'overcast', 'snow', 'wind', 'fog'] as const
export type WeatherKind = (typeof WEATHER_KINDS)[number]

/** Repeating an entry biases the pick toward it — a cheap weighting without a separate weight table. */
const WEATHER_BY_SEASON: Record<Season, WeatherKind[]> = {
  spring: ['clear', 'rain', 'rain', 'overcast', 'wind'],
  summer: ['clear', 'clear', 'clear', 'storm', 'overcast'],
  autumn: ['clear', 'wind', 'rain', 'fog', 'overcast'],
  winter: ['clear', 'clear', 'snow', 'storm', 'fog'],
}

const WEATHER_DESCRIPTIONS: Record<WeatherKind, string> = {
  clear: 'clear and mild',
  rain: 'raining steadily',
  storm: 'stormy',
  overcast: 'gray and overcast',
  snow: 'snowing',
  wind: 'blustery and windy',
  fog: 'thick with fog',
}

export function describeWeather(kind: WeatherKind): string {
  return WEATHER_DESCRIPTIONS[kind]
}

/** A tiny deterministic hash -> [0,1) generator, so the same seed always produces the same pick. */
export function seededFraction(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/** Exported for `world/ambientEvents.ts` — the same "deterministic seeded pick" primitive, shared rather than re-implemented. */
export function pickFrom<T>(options: T[], seed: string): T {
  const idx = Math.min(options.length - 1, Math.floor(seededFraction(seed) * options.length))
  return options[idx]
}

/** Deterministic per-world-per-day weather — same day always reads the same, browsable ahead of time. */
export function getWeather(worldId: string, day: number, cal?: WorldCalendar | null): WeatherKind {
  const info = getCalendarInfo(day, cal)
  return pickFrom(WEATHER_BY_SEASON[info.season], `weather:${worldId}:${info.day}`)
}

const MOODS = [
  'upbeat',
  'tired',
  'a little anxious',
  'content',
  'irritable',
  'wistful',
  'restless',
  'unusually cheerful',
]

/** Deterministic per-character-per-day mood — nudges tone, never dictates it (see ROADMAP.md 10a). */
export function getMoodOfDay(characterId: string, day: number): string {
  const info = getCalendarInfo(day)
  return pickFrom(MOODS, `mood:${characterId}:${info.day}`)
}

/** Whether a phase index reads as "night" for lighting purposes (evening counts as night too — dusk
 *  is closer to a night scene than a daylit one). Undefined/out-of-range defaults to day, matching a
 *  world that's never advanced its clock. */
export function isNightPhase(phaseIndex: number | undefined): boolean {
  const phase = PHASES[phaseIndex ?? -1]
  return phase === 'evening' || phase === 'night'
}

/** Advances the clock by one phase, rolling over to the next day after night. */
export function advancePhase(day: number, phaseIndex: number): { day: number; phaseIndex: number } {
  const next = phaseIndex + 1
  if (next >= PHASES.length) return { day: day + 1, phaseIndex: 0 }
  return { day, phaseIndex: next }
}

/** The day's action pool — 3 actions on a weekday, 4 on a weekend. Never stored, derived on demand. */
export function getMaxEnergyForDay(day: number): number {
  const { weekday } = getCalendarInfo(day)
  return weekday === 'saturday' || weekday === 'sunday' ? 4 : 3
}

/** How many actions are left today — floors at 0 rather than going negative once the day's spent. */
export function getEnergyRemaining(day: number, phaseIndex: number): number {
  return Math.max(0, getMaxEnergyForDay(day) - phaseIndex)
}

export interface EnergySpendResult {
  day: number
  phaseIndex: number
  /** True when this spend used the day's last action and the clock rolled straight to next morning ("Sleep"). */
  slept: boolean
}

/** Spends one action: steps the phase forward, then rolls straight to next morning if that step used up today's last action, rather than leaving the world sitting at a phase with nothing left to do. */
export function spendEnergy(day: number, phaseIndex: number): EnergySpendResult {
  const stepped = advancePhase(day, phaseIndex)
  if (stepped.day !== day) return { ...stepped, slept: true }
  if (getEnergyRemaining(stepped.day, stepped.phaseIndex) > 0) return { ...stepped, slept: false }
  return { ...advancePhase(stepped.day, stepped.phaseIndex), slept: true }
}

/** Time the story says has passed: whole days skipped, then a part of the day to land on, then more parts. */
export interface TimePassage {
  days: number
  phase?: DayPhase
  phases?: number
}

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, few: 3, several: 3, couple: 2 }
const countOf = (word: string) => NUMBER_WORDS[word.toLowerCase()] ?? (Number(word) || 1)

/** Phrases that move time on, as opposed to merely naming a time ("good night", "this morning"). */
const PASSAGE_CUES: { re: RegExp; passage: (m: RegExpExecArray) => TimePassage }[] = [
  { re: /\b(?:a |an |the )?(\w+)?\s?(?:days?) later\b/gi, passage: (m) => ({ days: m[1] ? countOf(m[1]) : 1 }) },
  { re: /\b(?:a |the )?(\w+)?\s?weeks? later\b/gi, passage: (m) => ({ days: 7 * (m[1] ? countOf(m[1]) : 1), phase: 'morning' }) },
  { re: /\b(?:the )?(?:next|following) week\b/gi, passage: () => ({ days: 7, phase: 'morning' }) },
  { re: /\b(?:the )?(?:next|following) (morning|afternoon|evening|night)\b/gi, passage: (m) => ({ days: 1, phase: m[1].toLowerCase() as DayPhase }) },
  { re: /\b(?:the )?(?:next|following) day\b|\bthe day after\b|\bthe morning after\b/gi, passage: () => ({ days: 1, phase: 'morning' }) },
  { re: /\b(?:later )?(?:that|the same) (morning|afternoon|evening|night)\b/gi, passage: (m) => ({ days: 0, phase: m[1].toLowerCase() as DayPhase }) },
  { re: /\blater that day\b/gi, passage: () => ({ days: 0, phases: 1 }) },
  { re: /\b(?:by|at|come) (?:dawn|daybreak|first light|sunrise)\b/gi, passage: () => ({ days: 0, phase: 'morning' }) },
  { re: /\b(?:by|at|come) (?:noon|midday)\b/gi, passage: () => ({ days: 0, phase: 'afternoon' }) },
  { re: /\b(?:by|at|come) (?:dusk|sunset|sundown|nightfall|twilight)\b/gi, passage: () => ({ days: 0, phase: 'evening' }) },
  { re: /\b(?:by|at|come) midnight\b/gi, passage: () => ({ days: 0, phase: 'night' }) },
  { re: /\b(?:a few |several |some |many |two |three )?hours (?:later|pass|go by|slip by|crawl by)\b|\b(?:an|one) hour later\b/gi, passage: () => ({ days: 0, phases: 1 }) },
]

/**
 * The passages of time narration describes, in the order it describes them ("That night… The next
 * morning…"). Only phrases that move time count, and never inside "quoted speech", so a character
 * saying "see you tomorrow night" doesn't move the clock. Empty when time doesn't pass.
 */
export function detectTimePassages(text: string | null | undefined): TimePassage[] {
  if (!text?.trim()) return []
  // Spoken lines don't move time; blanked rather than removed so positions stay put.
  const narration = text.replace(/"[^"]*"|“[^”]*”/g, (q) => ' '.repeat(q.length))
  const found: { index: number; end: number; passage: TimePassage }[] = []
  for (const cue of PASSAGE_CUES) {
    cue.re.lastIndex = 0
    for (let m = cue.re.exec(narration); m; m = cue.re.exec(narration)) {
      found.push({ index: m.index, end: m.index + m[0].length, passage: cue.passage(m) })
    }
  }
  found.sort((a, b) => a.index - b.index || b.end - a.end)
  const kept: typeof found = []
  for (const f of found) if (!kept.length || f.index >= kept[kept.length - 1].end) kept.push(f)
  return kept.map((f) => f.passage)
}

/** Where the clock lands after a passage: never backwards; naming an earlier part of the day means tomorrow. */
export function advanceForPassage(day: number, phaseIndex: number, passage: TimePassage): { day: number; phaseIndex: number } {
  let next = { day: day + Math.max(0, passage.days), phaseIndex }
  if (passage.phase) {
    const target = PHASES.indexOf(passage.phase)
    if (passage.days > 0) next.phaseIndex = target
    else if (target < phaseIndex) next = { day: next.day + 1, phaseIndex: target }
    else next.phaseIndex = target
  }
  for (let i = 0; i < (passage.phases ?? 0); i++) next = advancePhase(next.day, next.phaseIndex)
  return next
}

/** The clock after everything `text` narrates, or undefined when no time passes. */
export function clockAfterNarration(day: number, phaseIndex: number, text: string | null | undefined): { day: number; phaseIndex: number } | undefined {
  const passages = detectTimePassages(text)
  if (!passages.length) return undefined
  const next = passages.reduce((clock, p) => advanceForPassage(clock.day, clock.phaseIndex, p), { day, phaseIndex })
  return next.day === day && next.phaseIndex === phaseIndex ? undefined : next
}

/** Where an action taken *right now* actually happens, as distinct from `spendEnergy`'s return value, which jumps straight to next morning once a day's last action forces a rollover. */
export function activityPhase(day: number, phaseIndex: number): { day: number; phaseIndex: number } {
  const stepped = advancePhase(day, phaseIndex)
  // Day already wrapped — the activity happened in the original phase, not the next-morning value `stepped` jumped to.
  if (stepped.day !== day) return { day, phaseIndex }
  return stepped
}

export interface WeatherPreferences {
  loves?: WeatherKind[]
  hates?: WeatherKind[]
}

/** A short, deterministic, model-facing line describing "right now" in this world for this character. */
export function describeWorldMoment(opts: {
  worldId: string
  characterId: string
  day: number
  phaseIndex: number
  weatherPreferences?: WeatherPreferences
  calendar?: WorldCalendar | null
}): string {
  const info = getCalendarInfo(opts.day, opts.calendar)
  const phase = PHASES[Math.max(0, Math.min(PHASES.length - 1, opts.phaseIndex))]
  const weather = getWeather(opts.worldId, opts.day, opts.calendar)
  const mood = getMoodOfDay(opts.characterId, opts.day)
  const holidayNote = info.holiday ? ` — today is ${info.holiday}` : ''
  const weatherNote = opts.weatherPreferences?.loves?.includes(weather)
    ? ' (a kind of weather {{char}} loves)'
    : opts.weatherPreferences?.hates?.includes(weather)
      ? ' (a kind of weather {{char}} dislikes)'
      : ''
  const when = info.custom ? `${formatCalendarDate(info)}, in ${info.season}` : `a ${info.season} ${info.weekday}`
  return `It's ${phase} on ${when}${holidayNote}. The weather is ${describeWeather(weather)}${weatherNote}. {{char}} is feeling ${mood} today.`
}

export type PresenceStatus = 'available' | 'busy' | 'sleeping' | 'traveling'

/** One routine slot in a character's week — a flat list of slots, no recurrence rules beyond "every day" vs specific weekdays. */
export interface ScheduleEntry {
  id: string
  /** Which weekdays this applies to — unset/empty means every day. */
  days?: Weekday[]
  phase: DayPhase
  status: PresenceStatus
  activity: string
  location?: string
}

/** What a character is doing right now: a day-specific entry beats an "every day" one; no schedule or no matching slot defaults to available. */
export function getCurrentActivity(
  schedule: ScheduleEntry[] | undefined,
  day: number,
  phaseIndex: number,
): { status: PresenceStatus; activity?: string; location?: string } {
  if (!schedule?.length) return { status: 'available' }
  const info = getCalendarInfo(day)
  const phase = PHASES[Math.max(0, Math.min(PHASES.length - 1, phaseIndex))]
  const forPhase = schedule.filter((e) => e.phase === phase)
  const entry = forPhase.find((e) => e.days?.includes(info.weekday)) ?? forPhase.find((e) => !e.days?.length)
  if (!entry) return { status: 'available' }
  return { status: entry.status, activity: entry.activity, location: entry.location }
}

/** Time-of-day words in narration, mapped to a phase — longest/most-specific patterns first so
 *  "late at night" beats "late". Only whole-phrase matches on word boundaries count. */
const PHASE_CUES: { re: RegExp; phase: DayPhase }[] = [
  { re: /\b(?:the )?(?:next|following) morning\b/i, phase: 'morning' },
  { re: /\b(?:that|the) (?:same )?night\b/i, phase: 'night' },
  { re: /\b(?:later )?that evening\b/i, phase: 'evening' },
  { re: /\b(?:the )?(?:next|following) day\b/i, phase: 'morning' },
  { re: /\bearly (?:the )?next\b/i, phase: 'morning' },
  { re: /\b(?:at )?(?:day ?break|dawn|sunrise|first light)\b/i, phase: 'morning' },
  { re: /\b(?:this |early |mid[- ]?|late )?morning\b/i, phase: 'morning' },
  { re: /\b(?:before|after) (?:first )?class(?:es)?\b/i, phase: 'morning' },
  { re: /\b(?:at |around |over )?(?:lunch(?:time)?|noon|midday)\b/i, phase: 'afternoon' },
  { re: /\b(?:this |early |mid[- ]?|late )?afternoon\b/i, phase: 'afternoon' },
  { re: /\bafter (?:school|work|classes?)\b/i, phase: 'afternoon' },
  { re: /\b(?:at |around )?(?:dusk|sunset|sundown|nightfall|twilight)\b/i, phase: 'evening' },
  { re: /\b(?:this |early |mid[- ]?|late )?evening\b/i, phase: 'evening' },
  { re: /\b(?:at |around |by )?(?:night ?time|midnight|the small hours)\b/i, phase: 'night' },
  { re: /\b(?:this |late |deep in the )?night\b/i, phase: 'night' },
  { re: /\bafter (?:dark|midnight)\b/i, phase: 'night' },
]

/** A time-of-day the text explicitly narrates ("the next morning", "at lunch", "that night"), or
 *  undefined when nothing time-anchoring is said. First-match wins on the ordered list above, so a
 *  message that only mentions time once resolves cleanly; a rambling one takes its earliest cue. */
export function detectNarratedPhase(text: string | null | undefined): DayPhase | undefined {
  if (!text?.trim()) return undefined
  let earliest: { index: number; phase: DayPhase } | undefined
  for (const { re, phase } of PHASE_CUES) {
    const m = text.match(re)
    if (m?.index !== undefined && (!earliest || m.index < earliest.index)) earliest = { index: m.index, phase }
  }
  return earliest?.phase
}

/** Case-insensitive, whitespace-tolerant "these name the same place" check — an exact match or
 *  either string containing the other ("Library" vs "School Library"). */
function locationsOverlap(a: string, b: string): boolean {
  const x = a.trim().toLowerCase()
  const y = b.trim().toLowerCase()
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}

/**
 * Presence for the prompt, reconciling the frozen world clock against an already-established scene.
 * `WorldCard.currentDay`/`currentPhaseIndex` only ever advance by explicit user action, so a chat
 * that opens with a greeting placing the character somewhere would otherwise be prompted the whole
 * session with a schedule slot ("busy — in class", or "free at her apartment") that contradicts the
 * scene the greeting set. The established scene owns *where* the character is; the schedule only
 * still owns their status/activity, and only when it doesn't fight the scene:
 *  - clock slot's own location matches the scene → keep it wholesale (its activity is real colour)
 *  - scene sits at a spot some other `available` slot covers → use that slot instead
 *  - scene is somewhere the schedule doesn't describe → keep only the status, drop the stale
 *    activity/location (a genuine busy/asleep/traveling conflict still surfaces as friction)
 */
export function resolveScheduledPresence(
  schedule: ScheduleEntry[] | undefined,
  day: number,
  phaseIndex: number,
  sceneLocation: string | null | undefined,
): { status: PresenceStatus; activity?: string; location?: string } {
  const clockActivity = getCurrentActivity(schedule, day, phaseIndex)
  const loc = sceneLocation?.trim()
  if (!loc || !schedule?.length) return clockActivity
  if (clockActivity.location && locationsOverlap(clockActivity.location, loc)) return clockActivity
  const sceneSlot = schedule.find((e) => e.status === 'available' && e.location && locationsOverlap(e.location, loc))
  if (sceneSlot) return { status: 'available', activity: sceneSlot.activity, location: sceneSlot.location }
  return { status: clockActivity.status }
}

const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  available: 'free',
  busy: 'busy',
  sleeping: 'asleep',
  traveling: 'traveling',
}

export function presenceLabel(status: PresenceStatus): string {
  return PRESENCE_LABELS[status]
}

/** A short, deterministic, model-facing line describing what a character is doing right now — merged alongside describeWorldMoment's weather/mood line, not a replacement for it. */
export function describePresence(presence: { status: PresenceStatus; activity?: string; location?: string }): string {
  const where = presence.location ? ` at ${presence.location}` : ''
  if (!presence.activity) return `{{char}} is currently ${presenceLabel(presence.status)}.`
  return `{{char}} is currently ${presenceLabel(presence.status)} — ${presence.activity}${where}.`
}
