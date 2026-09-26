// Mirror of the database rules in app_private.day_type_for / count_working_days.
// The server is always the source of truth; this is used for instant previews
// (including when the phone is offline).
import { eachDay, isoDow } from './dates'

export type DayType = 'working_day' | 'off_day' | 'public_holiday'

export interface ScheduleVersion {
  effective_from: string
  working_days: number[]
}

export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]

export function workingDaysOn(schedules: ScheduleVersion[], date: string): number[] {
  let best: ScheduleVersion | undefined
  for (const s of schedules) {
    if (s.effective_from <= date && (!best || s.effective_from > best.effective_from)) best = s
  }
  return best ? best.working_days : DEFAULT_WORKING_DAYS
}

export function dayType(schedules: ScheduleVersion[], holidays: Set<string>, date: string): DayType {
  if (holidays.has(date)) return 'public_holiday'
  return workingDaysOn(schedules, date).includes(isoDow(date)) ? 'working_day' : 'off_day'
}

export function countWorkingDays(schedules: ScheduleVersion[], holidays: Set<string>, from: string, to: string): number {
  if (!from || !to || to < from) return 0
  return eachDay(from, to).filter((d) => dayType(schedules, holidays, d) === 'working_day').length
}

export type DayPortion = 'full' | 'half_am' | 'half_pm'

export function leaveDaysTaken(
  schedules: ScheduleVersion[],
  holidays: Set<string>,
  from: string,
  to: string,
  portion: DayPortion,
): number {
  const n = countWorkingDays(schedules, holidays, from, to)
  if (portion !== 'full') return n > 0 && from === to ? 0.5 : 0
  return n
}

export const DAY_TYPE_LABEL: Record<DayType, string> = {
  working_day: 'Working day',
  off_day: 'Off day',
  public_holiday: 'Public holiday',
}
