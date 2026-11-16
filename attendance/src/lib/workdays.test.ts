import { describe, expect, it } from 'vitest'
import { countWorkingDays, dayType, leaveDaysTaken, type ScheduleVersion } from './workdays'
import { addMonths, endOfMonth, isoDow, klDate, startOfWeek } from './dates'

// Same data as the sample database: Kavitha moved to Wed-Sun on 1 Jul 2026.
const kavitha: ScheduleVersion[] = [
  { effective_from: '2000-01-01', working_days: [1, 2, 3, 4, 5] },
  { effective_from: '2026-07-01', working_days: [3, 4, 5, 6, 7] },
]
const farid: ScheduleVersion[] = [{ effective_from: '2000-01-01', working_days: [1, 2, 3, 4, 5] }]
const holidays = new Set(['2026-06-01', '2026-08-31', '2026-09-16'])

describe('dates', () => {
  it('uses Malaysian time for the calendar date', () => {
    // 5 pm UTC on 30 Sep is already 1 am on 1 Oct in Malaysia
    expect(klDate('2026-09-30T17:00:00Z')).toBe('2026-10-01')
  })
  it('knows weekdays, weeks and months', () => {
    expect(isoDow('2026-09-26')).toBe(6) // Saturday
    expect(startOfWeek('2026-09-26')).toBe('2026-09-21')
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01')
  })
})

describe('work schedules', () => {
  it('uses the schedule that applied on the date', () => {
    expect(dayType(kavitha, holidays, '2026-06-08')).toBe('working_day') // Mon, old schedule
    expect(dayType(kavitha, holidays, '2026-07-06')).toBe('off_day') // Mon, new schedule
    expect(dayType(kavitha, holidays, '2026-07-04')).toBe('working_day') // Sat, new schedule
  })
  it('treats public holidays as non-working', () => {
    expect(dayType(farid, holidays, '2026-09-16')).toBe('public_holiday')
    expect(countWorkingDays(farid, holidays, '2026-09-14', '2026-09-18')).toBe(4)
  })
  it('counts leave days against the person\'s own schedule', () => {
    expect(leaveDaysTaken(kavitha, holidays, '2026-07-01', '2026-07-07', 'full')).toBe(5)
    expect(leaveDaysTaken(farid, holidays, '2026-07-01', '2026-07-07', 'full')).toBe(5)
    expect(leaveDaysTaken(farid, holidays, '2026-09-22', '2026-09-22', 'half_am')).toBe(0.5)
    expect(leaveDaysTaken(farid, holidays, '2026-09-19', '2026-09-19', 'half_pm')).toBe(0) // Saturday
  })
})
