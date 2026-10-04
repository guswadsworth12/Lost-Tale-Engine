import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { NumberField, SelectField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import {
  ALL_HOLIDAYS, CALENDAR_LIMITS, DAYS_PER_SEASON, SEASONS, WEEKDAYS, formatYear, getCalendarInfo, yearLength,
  type CalendarHoliday, type CalendarMonth, type Season, type WorldCalendar,
} from '@/lib/world/calendar'

const capitalized = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Where a world starts when it switches to its own calendar: the built-in year, renamed to taste from there. */
export function starterCalendar(): WorldCalendar {
  return {
    startYear: 1,
    months: SEASONS.map((season) => ({ name: capitalized(season), days: DAYS_PER_SEASON, season })),
    holidays: ALL_HOLIDAYS.map((h) => ({ name: h.name, month: Math.floor(h.dayOfYear / DAYS_PER_SEASON), day: (h.dayOfYear % DAYS_PER_SEASON) + 1 })),
  }
}

const iconButton = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-elevated hover:text-text disabled:opacity-40'

/**
 * A world's own calendar (#51): the year and its era, the months and their lengths, names for the
 * seven weekdays, and holidays. Off, the world keeps the built-in 112-day year.
 */
export function CalendarEditor({ value, onChange }: { value: WorldCalendar | undefined; onChange: (next: WorldCalendar | undefined) => void }) {
  if (!value) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-text-muted">This world uses the built-in year: four seasons of 28 days, Monday to Sunday, and a holiday in each season.</p>
        <Button onClick={() => onChange(starterCalendar())}>Use this world's own calendar</Button>
      </div>
    )
  }
  const set = (patch: Partial<WorldCalendar>) => onChange({ ...value, ...patch })
  const months = value.months
  const holidays = value.holidays ?? []
  const total = yearLength(value)
  const setMonth = (i: number, patch: Partial<CalendarMonth>) => set({ months: months.map((m, j) => (j === i ? { ...m, ...patch } : m)) })
  // Holidays point at months by position, so moving or removing a month carries them along.
  const moveMonth = (i: number, by: -1 | 1) => {
    const j = i + by
    if (j < 0 || j >= months.length) return
    const next = [...months]
    ;[next[i], next[j]] = [next[j], next[i]]
    set({ months: next, holidays: holidays.map((h) => ({ ...h, month: h.month === i ? j : h.month === j ? i : h.month })) })
  }
  const removeMonth = (i: number) => set({
    months: months.filter((_, j) => j !== i),
    holidays: holidays.filter((h) => h.month !== i).map((h) => ({ ...h, month: h.month > i ? h.month - 1 : h.month })),
  })
  const setHoliday = (i: number, patch: Partial<CalendarHoliday>) => set({ holidays: holidays.map((h, j) => (j === i ? { ...h, ...patch } : h)) })
  const weekdays = value.weekdays ?? []
  const firstDay = getCalendarInfo(0, value)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-medium text-text">Year</h3>
        <div className="grid gap-x-3 sm:grid-cols-3">
          <NumberField label="Year the clock starts in" step={1} value={value.startYear}
            onChange={(e) => set({ startYear: Math.round(Number(e.target.value) || 0) })} />
          <TextField label="Era (optional)" maxLength={CALENDAR_LIMITS.name} placeholder="X, AC, Year of the Crow…" value={value.era ?? ''}
            onChange={(e) => set({ era: e.target.value || undefined })} />
          <SelectField label="Era goes" value={value.eraAfter ? 'after' : 'before'} disabled={!value.era?.trim()}
            onChange={(e) => set({ eraAfter: e.target.value === 'after' || undefined })}>
            <option value="before">Before the year</option>
            <option value="after">After the year</option>
          </SelectField>
        </div>
        <p className="text-xs text-text-muted">Shown as <span className="text-text">{formatYear(value.startYear, value)}</span>. Day 1 of the clock is {firstDay.dayOfMonth} {firstDay.month}, {firstDay.yearLabel}.</p>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-text">Months <span className="font-normal text-text-muted">· {total} days a year</span></h3>
        <div className="space-y-2">
          {months.map((month, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-bg-sunken p-3">
              <TextField label="Name" className="min-w-[10rem] flex-1" maxLength={CALENDAR_LIMITS.name} value={month.name}
                onChange={(e) => setMonth(i, { name: e.target.value })} />
              <NumberField label="Days" className="w-24" min={1} max={CALENDAR_LIMITS.monthDays} step={1} value={month.days}
                onChange={(e) => setMonth(i, { days: Math.max(1, Math.min(CALENDAR_LIMITS.monthDays, Math.round(Number(e.target.value) || 1))) })} />
              <SelectField label="Season" className="w-36" value={month.season ?? ''}
                onChange={(e) => setMonth(i, { season: (e.target.value || undefined) as Season | undefined })}>
                <option value="">From its place</option>
                {SEASONS.map((s) => <option key={s} value={s}>{capitalized(s)}</option>)}
              </SelectField>
              <div className="mb-3 flex">
                <button type="button" className={iconButton} aria-label={`Move ${month.name || 'month'} earlier`} disabled={i === 0} onClick={() => moveMonth(i, -1)}><ArrowUp size={15} /></button>
                <button type="button" className={iconButton} aria-label={`Move ${month.name || 'month'} later`} disabled={i === months.length - 1} onClick={() => moveMonth(i, 1)}><ArrowDown size={15} /></button>
                <button type="button" className={iconButton} aria-label={`Remove ${month.name || 'month'}`} disabled={months.length === 1} onClick={() => removeMonth(i)}><X size={15} /></button>
              </div>
            </div>
          ))}
        </div>
        <Button className="mt-2 flex items-center gap-1.5" disabled={months.length >= CALENDAR_LIMITS.months || total >= CALENDAR_LIMITS.yearDays}
          onClick={() => set({ months: [...months, { name: `Month ${months.length + 1}`, days: 30 }] })}>
          <Plus size={14} /> Add month
        </Button>
        <p className="mt-1 text-xs text-text-muted">Seasons set the weather. Up to {CALENDAR_LIMITS.months} months and {CALENDAR_LIMITS.yearDays} days a year.</p>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium text-text">Days of the week</h3>
        <p className="mb-2 text-xs text-text-muted">Weeks stay seven days, so characters' schedules keep working; name them anything. The last two are the weekend.</p>
        <div className="grid gap-x-3 sm:grid-cols-4">
          {WEEKDAYS.map((id, i) => (
            <TextField key={id} label={capitalized(id)} maxLength={CALENDAR_LIMITS.name} placeholder={capitalized(id)} value={weekdays[i] ?? ''}
              onChange={(e) => {
                const next = WEEKDAYS.map((_, j) => (j === i ? e.target.value : weekdays[j] ?? ''))
                set({ weekdays: next.some((n) => n.trim()) ? next : undefined })
              }} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium text-text">Holidays</h3>
        <div className="space-y-2">
          {holidays.map((holiday, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-bg-sunken p-3">
              <TextField label="Name" className="min-w-[10rem] flex-1" maxLength={CALENDAR_LIMITS.name} value={holiday.name}
                onChange={(e) => setHoliday(i, { name: e.target.value })} />
              <SelectField label="Month" className="w-40" value={holiday.month}
                onChange={(e) => {
                  const month = Number(e.target.value)
                  setHoliday(i, { month, day: Math.min(holiday.day, months[month]?.days ?? 1) })
                }}>
                {months.map((m, j) => <option key={j} value={j}>{m.name || `Month ${j + 1}`}</option>)}
              </SelectField>
              <NumberField label="Day" className="w-24" min={1} max={months[holiday.month]?.days ?? 1} step={1} value={holiday.day}
                onChange={(e) => setHoliday(i, { day: Math.max(1, Math.min(months[holiday.month]?.days ?? 1, Math.round(Number(e.target.value) || 1))) })} />
              <div className="mb-3">
                <button type="button" className={iconButton} aria-label={`Remove ${holiday.name || 'holiday'}`} onClick={() => set({ holidays: holidays.filter((_, j) => j !== i) })}><X size={15} /></button>
              </div>
            </div>
          ))}
        </div>
        <Button className="mt-2 flex items-center gap-1.5" disabled={holidays.length >= CALENDAR_LIMITS.holidays}
          onClick={() => set({ holidays: [...holidays, { name: 'New holiday', month: 0, day: 1 }] })}>
          <Plus size={14} /> Add holiday
        </Button>
      </div>

      <Button variant="secondary" onClick={() => onChange(undefined)}>Go back to the built-in calendar</Button>
    </div>
  )
}
