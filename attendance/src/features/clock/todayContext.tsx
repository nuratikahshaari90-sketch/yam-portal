// Extra context for the clock screen. Leave and trips are filled in by
// later stages; until then these return nothing.
import type { Trip } from '../../lib/types'

export function useTodayContext(_staffId: string, _date: string, _key: string) {
  return { leaveToday: null as string | null, tripsToday: [] as Trip[] }
}

export function OutstationPicker(_props: { trips: Trip[]; value: string | null; onChange: (id: string | null) => void }) {
  return null
}

/** Map of date -> leave type name for approved leave in a range (filled in by the leave stage). */
export function useLeaveDays(_staffId: string, _from: string, _to: string): Map<string, string> {
  return new Map()
}
