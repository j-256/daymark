import { useState } from "react";
import { PATTERN_RANGES, summarizePattern } from "../client/patterns";
import { localDay, shiftDay } from "../shared/model";
import type { TrackerItem } from "./TrackerForm";
import type { Records, TrackerRow } from "./Views";

const dateLabel = (day: string) =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
export function Patterns({
  items,
  rows,
  records,
}: {
  items: TrackerItem[];
  rows: TrackerRow[];
  records: Records;
}) {
  const [range, setRange] = useState<number>(28);
  const last = localDay();
  const first = shiftDay(last, 1 - range);
  const days = Array.from({ length: range }, (_, index) => shiftDay(first, index));
  return (
    <>
      <div className="page-title">
        <h1>Patterns</h1>
      </div>
      <div className="pattern-controls">
        <label>
          Range
          <select
            aria-label="Patterns range"
            value={range}
            onChange={(event) => setRange(Number(event.target.value))}
          >
            {PATTERN_RANGES.map((value) => (
              <option value={value} key={value}>
                Last {value} days
              </option>
            ))}
          </select>
        </label>
        <p className="range-caption">
          {dateLabel(first)} to {dateLabel(last)}
        </p>
      </div>
      {!items.length && <p className="empty">Your history will appear here as you log.</p>}
      {items.map((item) => {
        const summary = summarizePattern(records, item.id, first, last);
        const slotRows = rows.filter(
          (row) => row.trackerId === item.id && (!row.retired || summary.slots.has(row.slot.id)),
        );
        const latest = summary.completedDays.at(-1);
        return (
          <article className="pattern" key={item.id} aria-label={`Patterns for ${item.value.name}`}>
            <div className="pattern-heading">
              <div>
                <h2>{item.value.name}</h2>
                <p className="item-meta">
                  {latest
                    ? `Latest in range: ${dateLabel(latest)}`
                    : "No completed days in this range"}
                </p>
              </div>
              <strong>
                {summary.confirmed}
                <small>confirmed</small>
              </strong>
            </div>
            <svg
              className="history-chart"
              preserveAspectRatio="none"
              viewBox={`0 0 ${range * 12} 18`}
              role="img"
              aria-label={`${item.value.name}, ${first} to ${last}: ${summary.confirmed} confirmed slots, ${summary.skipped} skipped slots, ${summary.extra} extra occurrences`}
            >
              {days.map((day, index) => {
                const value = summary.days.get(day);
                return (
                  <rect
                    key={day}
                    x={index * 12}
                    y={1}
                    width={9}
                    height={14}
                    rx={2}
                    className={
                      value?.conflicts
                        ? "chart-conflict"
                        : value?.confirmed || value?.extra
                          ? "chart-confirmed"
                          : value?.skipped
                            ? "chart-skipped"
                            : "chart-unknown"
                    }
                  >
                    <title>
                      {day}: {value?.confirmed ?? 0} confirmed, {value?.skipped ?? 0} skipped,{" "}
                      {value?.extra ?? 0} extra
                      {value?.conflicts ? `, ${value.conflicts} unresolved` : ""}
                    </title>
                  </rect>
                );
              })}
            </svg>
            <div className="pattern-footer">
              <span>
                {summary.skipped} skipped / {summary.extra} extra
              </span>
              <span>
                {summary.averageGap === null
                  ? "Gap: not enough history"
                  : `Average gap: ${summary.averageGap.toLocaleString(undefined, { maximumFractionDigits: 1 })}d`}
              </span>
            </div>
            <table className="slot-summary">
              <caption>Slot breakdown</caption>
              <thead>
                <tr>
                  <th scope="col">Slot</th>
                  <th scope="col">Confirmed</th>
                  <th scope="col">Skipped</th>
                </tr>
              </thead>
              <tbody>
                {slotRows.map((row) => {
                  const value = summary.slots.get(row.slot.id);
                  return (
                    <tr key={row.slot.id}>
                      <td>
                        {row.slot.name || "Any time"}
                        {row.retired && <span className="item-meta">Retired slot</span>}
                        {Boolean(value?.conflicts) && (
                          <span className="item-meta">{value?.conflicts} unresolved</span>
                        )}
                      </td>
                      <td>{value?.confirmed ?? 0}</td>
                      <td>{value?.skipped ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {summary.conflicts > 0 && (
              <p className="hint">
                {summary.conflicts} unresolved record{summary.conflicts === 1 ? "" : "s"} excluded
                from totals.
              </p>
            )}
            <details className="pattern-method">
              <summary>How these numbers work</summary>
              <p>
                Counts use saved slots and extra logs within the selected range. Unknown days are
                unrecorded, not skipped. Conflicting records are excluded until resolved.
              </p>
              <p>
                Average gap measures calendar days between consecutive completed days in this range.
                Several logs on one day count as one completed day. At least two completed days are
                needed.
              </p>
              {summary.gaps.length > 0 && (
                <p>
                  Latest gaps:{" "}
                  {summary.gaps
                    .slice(-8)
                    .map((gap) => `${gap}d`)
                    .join(", ")}
                </p>
              )}
            </details>
          </article>
        );
      })}
    </>
  );
}
