import { dayDistance, type Entry, type ExtraEvent, type RecordState } from "../shared/model";

export const PATTERN_RANGES = [7, 28, 90] as const;
export interface SlotTotals {
  confirmed: number;
  skipped: number;
  unknown: number;
  conflicts: number;
}
export interface DayTotals extends SlotTotals {
  extra: number;
}
const emptySlot = (): SlotTotals => ({ confirmed: 0, skipped: 0, unknown: 0, conflicts: 0 });
export function summarizePattern(
  records: Map<string, RecordState>,
  trackerId: string,
  first: string,
  last: string,
) {
  const days = new Map<string, DayTotals>();
  const slots = new Map<string, SlotTotals>();
  let confirmed = 0;
  let skipped = 0;
  let extra = 0;
  let conflicts = 0;
  const inside = (day: string) => day >= first && day <= last;
  const forDay = (day: string) => {
    let value = days.get(day);
    if (!value) {
      value = { ...emptySlot(), extra: 0 };
      days.set(day, value);
    }
    return value;
  };
  for (const record of records.values()) {
    if (record.kind === "entry") {
      const [owner, day, slotId] = record.key.split("/");
      if (owner !== trackerId || !inside(day)) continue;
      let slot = slots.get(slotId);
      if (!slot) {
        slot = emptySlot();
        slots.set(slotId, slot);
      }
      const daily = forDay(day);
      if (record.conflict) {
        conflicts++;
        slot.conflicts++;
        daily.conflicts++;
        continue;
      }
      const value = record.value as Entry | null;
      if (!value) continue;
      slot[value.state]++;
      daily[value.state]++;
      if (value.state === "confirmed") confirmed++;
      if (value.state === "skipped") skipped++;
    } else if (record.kind === "event") {
      if (record.conflict) {
        const matching = record.heads
          .map((op) => op.value as ExtraEvent)
          .filter((value) => value.trackerId === trackerId && inside(value.day));
        if (matching.length) {
          conflicts++;
          for (const day of new Set(matching.map((value) => value.day))) forDay(day).conflicts++;
        }
        continue;
      }
      const value = record.value as ExtraEvent | null;
      if (!value || value.deleted || value.trackerId !== trackerId || !inside(value.day)) continue;
      extra++;
      forDay(value.day).extra++;
    }
  }
  const completedDays = [...days]
    .filter(([, value]) => value.confirmed + value.extra > 0)
    .map(([day]) => day)
    .sort();
  const gaps = completedDays.slice(1).map((day, index) => dayDistance(completedDays[index], day));
  const averageGap = gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null;
  return { days, slots, confirmed, skipped, extra, conflicts, completedDays, gaps, averageGap };
}
