import type { ExtraEvent, RecordState } from "../shared/model";

export function extraRecords(
  records: Map<string, RecordState>,
  trackerId: string,
  day: string,
): RecordState[] {
  return [...records.values()]
    .filter((record) => {
      if (record.kind !== "event") return false;
      return record.heads.some((op) => {
        const value = op.value as ExtraEvent;
        return value.trackerId === trackerId && value.day === day && !value.deleted;
      });
    })
    .sort((a, b) => {
      const time = (record: RecordState) =>
        (record.value as ExtraEvent | null)?.occurredAt ?? record.heads[0].createdAt;
      return time(a).localeCompare(time(b)) || a.key.localeCompare(b.key);
    });
}
