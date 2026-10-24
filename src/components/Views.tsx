import { Archive, ChevronLeft, ChevronRight, MoreHorizontal, Plus, RotateCcw } from "lucide-react";
import { useState } from "react";
import {
  dayDistance,
  due,
  type Entry,
  type ExtraEvent,
  entryKey,
  localDay,
  type RecordState,
  type Slot,
  type Status,
  shiftDay,
  type Tracker,
  weekStart,
} from "../shared/model";
import type { EntrySelection } from "./EntryForm";
import type { TrackerItem } from "./TrackerForm";
import { StatusButton, StatusIcon } from "./ui";

export interface TrackerRow {
  trackerId: string;
  tracker: Tracker;
  slot: Slot;
  retired?: boolean;
}
export type Records = Map<string, RecordState>;
export const entryRecord = (records: Records, row: TrackerRow, day: string) =>
  records.get(`entry/${entryKey(row.trackerId, day, row.slot.id)}`);
export const statusFor = (records: Records, row: TrackerRow, day: string): Status | "conflict" => {
  const record = entryRecord(records, row, day);
  return record?.conflict ? "conflict" : ((record?.value as Entry | undefined)?.state ?? "unknown");
};
export function selectionFor(records: Records, row: TrackerRow, day: string): EntrySelection {
  const record = entryRecord(records, row, day);
  return {
    trackerId: row.trackerId,
    tracker: row.tracker,
    slot: row.slot,
    day,
    value: (record?.value as Entry) ?? { state: "unknown", note: "", occurredAt: null },
    parents: record?.heads.map((op) => op.id) ?? [],
  };
}
function lastDone(records: Records, trackerId: string): string | null {
  const dates: string[] = [];
  for (const record of records.values()) {
    if (
      record.kind === "entry" &&
      record.key.startsWith(`${trackerId}/`) &&
      (record.value as Entry | null)?.state === "confirmed"
    )
      dates.push(record.key.split("/")[1]);
    if (record.kind === "event" && record.value) {
      const event = record.value as ExtraEvent;
      if (event.trackerId === trackerId && !event.deleted) dates.push(event.day);
    }
  }
  return dates.sort().at(-1) ?? null;
}
function ago(day: string | null): string {
  if (!day) return "No confirmed history";
  const distance = dayDistance(day, localDay());
  return distance === 0 ? "Today" : distance === 1 ? "Yesterday" : `${distance} days ago`;
}

function todayRecordDay(records: Records, row: TrackerRow, today: string): string {
  if (row.tracker.schedule !== "weekly") return today;
  const first = weekStart(today);
  const days = [...records.values()]
    .filter(
      (record) =>
        record.kind === "entry" &&
        record.key.startsWith(`${row.trackerId}/`) &&
        record.key.endsWith(`/${row.slot.id}`),
    )
    .filter((record) => {
      const day = record.key.split("/")[1];
      return (
        day >= first &&
        day <= today &&
        (record.conflict || (record.value as Entry | null)?.state === "confirmed")
      );
    })
    .sort((a, b) => Number(b.conflict) - Number(a.conflict) || b.key.localeCompare(a.key));
  return days[0]?.key.split("/")[1] ?? today;
}

interface Common {
  rows: TrackerRow[];
  records: Records;
  busy: string;
  mark: (row: TrackerRow, day: string, cycle: boolean) => Promise<void>;
  edit: (selection: EntrySelection) => void;
  review: () => void;
}
export function Today({
  rows,
  records,
  busy,
  mark,
  edit,
  review,
  add,
}: Common & { add: () => void }) {
  const today = localDay();
  const pinned = rows.filter((row) => row.tracker.pinned && !row.retired);
  const scheduled = pinned.filter((row) => due(row.tracker, today));
  const confirmed = scheduled.filter(
    (row) => statusFor(records, row, todayRecordDay(records, row, today)) === "confirmed",
  ).length;
  let category: string | null = null;
  return (
    <>
      <div className="page-title">
        <h1>Today</h1>
        <span className="date">
          {new Date(`${today}T12:00:00`).toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
          })}
        </span>
      </div>
      <div className="summary">
        <strong>
          {confirmed}/{scheduled.length}
        </strong>
        <span>scheduled slots confirmed</span>
      </div>
      {!pinned.length && (
        <div className="empty">
          <h2>Start with one tracker</h2>
          <p>Pills, showers, chores. Log what matters to you.</p>
          <button type="button" className="primary" onClick={add}>
            <Plus />
            Add tracker
          </button>
        </div>
      )}
      <div className="quick-list">
        {pinned.map((row) => {
          const heading = category !== row.tracker.category;
          category = row.tracker.category;
          const recordDay = todayRecordDay(records, row, today);
          const state = statusFor(records, row, recordDay);
          const value = entryRecord(records, row, recordDay)?.value as Entry | null;
          const label =
            row.slot.name || row.slot.time
              ? [row.slot.name, row.slot.time].filter(Boolean).join(" / ")
              : ago(lastDone(records, row.trackerId));
          return (
            <div key={`${row.trackerId}/${row.slot.id}`}>
              {heading && <h2 className="section-label">{category || "Personal"}</h2>}
              <div className="log-row">
                <button
                  type="button"
                  className="item-copy"
                  onClick={() =>
                    state === "conflict" ? review() : edit(selectionFor(records, row, recordDay))
                  }
                >
                  <span className="item-name">{row.tracker.name}</span>
                  <span className="item-meta">
                    {row.tracker.schedule === "weekly"
                      ? [
                          row.slot.name,
                          row.slot.time,
                          "This week",
                          ago(lastDone(records, row.trackerId)),
                        ]
                          .filter(Boolean)
                          .join(" / ")
                      : label}
                    {state === "confirmed" && value?.occurredAt
                      ? ` / ${new Date(value.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : ""}
                  </span>
                </button>
                <StatusButton
                  state={state}
                  label={`${row.tracker.name}${row.slot.name ? ` / ${row.slot.name}` : ""}${row.tracker.schedule === "weekly" ? " / this week" : ""}`}
                  day={recordDay}
                  disabled={busy === entryKey(row.trackerId, recordDay, row.slot.id)}
                  onClick={() => {
                    if (state === "conflict") review();
                    else void mark(row, recordDay, false);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {pinned.length > 0 && (
        <button
          className="text-button extra-action"
          type="button"
          onClick={() => edit({ ...selectionFor(records, pinned[0], today), extra: true })}
        >
          <Plus />
          Log another occurrence
        </button>
      )}
      <p className="hint">Unknown is unrecorded. Skipped is an explicit choice.</p>
    </>
  );
}

export function Weeks({ rows, records, busy, mark, edit, review }: Common) {
  const today = localDay();
  const [start, setStart] = useState(weekStart(today));
  const [count, setCount] = useState(1);
  const [selected, setSelected] = useState(today);
  const range = (day: string) => {
    const options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
    return `${new Date(`${day}T12:00:00`).toLocaleDateString(undefined, options)} - ${new Date(`${shiftDay(day, 6)}T12:00:00`).toLocaleDateString(undefined, options)}`;
  };
  return (
    <>
      <div className="page-title">
        <h1>Weeks</h1>
        <span className="date">Tap a day to cycle</span>
      </div>
      <div className="week-controls">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous week"
          onClick={() => setStart(shiftDay(start, -7))}
        >
          <ChevronLeft />
        </button>
        <label className="week-date">
          <span>{range(start)}</span>
          <input
            type="date"
            aria-label="Jump to week"
            value={start}
            max={today}
            min="1900-01-01"
            onChange={(event) => {
              if (event.target.value) setStart(weekStart(event.target.value));
            }}
          />
        </label>
        <button
          type="button"
          className="icon-button"
          aria-label="Next week"
          disabled={start >= weekStart(today)}
          onClick={() => setStart(shiftDay(start, 7))}
        >
          <ChevronRight />
        </button>
        <select
          aria-label="Weeks shown"
          value={count}
          onChange={(event) => setCount(Number(event.target.value))}
        >
          <option value={1}>1 week</option>
          <option value={3}>3 weeks</option>
        </select>
      </div>
      <div className="legend">
        <span>
          <StatusIcon state="unknown" />
          Unknown
        </span>
        <span className="good">
          <StatusIcon state="confirmed" />
          Confirmed
        </span>
        <span>
          <StatusIcon state="skipped" />
          Skipped
        </span>
      </div>
      {!rows.length && <p className="empty">Add a tracker to start your history.</p>}
      {Array.from({ length: count }, (_, week) => {
        const first = shiftDay(start, -7 * week);
        const days = Array.from({ length: 7 }, (_, index) => shiftDay(first, index));
        const focus = days.includes(selected) ? selected : first;
        return (
          <section className="week-block" key={first}>
            {count > 1 && <h2>{range(first)}</h2>}
            <div className="day-heads">
              {days.map((day, index) => (
                <button
                  type="button"
                  className={`day-head${day === today ? " current" : ""}${day === selected ? " selected" : ""}`}
                  key={day}
                  disabled={day > today}
                  aria-label={`Select ${day} for details`}
                  aria-pressed={day === selected}
                  onClick={() => setSelected(day)}
                >
                  <span>{["M", "T", "W", "T", "F", "S", "S"][index]}</span>
                  <b>{new Date(`${day}T12:00:00`).getDate()}</b>
                </button>
              ))}
            </div>
            {rows.map((row) => (
              <div className="week-row" key={`${row.trackerId}/${row.slot.id}`}>
                <div className="week-label">
                  <button
                    type="button"
                    className="row-name"
                    onClick={() =>
                      statusFor(records, row, focus) === "conflict"
                        ? review()
                        : edit(selectionFor(records, row, focus))
                    }
                  >
                    {row.tracker.name}
                    {row.slot.name ? ` / ${row.slot.name}` : ""}
                  </button>
                  <span>
                    {row.retired ? "Retired slot" : row.slot.time || row.tracker.category}
                  </span>
                </div>
                <div className="week-cells">
                  {days.map((day) => {
                    const state = statusFor(records, row, day);
                    return (
                      <StatusButton
                        key={day}
                        weekly
                        state={state}
                        label={row.tracker.name}
                        day={day}
                        disabled={day > today || busy === entryKey(row.trackerId, day, row.slot.id)}
                        onClick={() => {
                          if (state === "conflict") review();
                          else void mark(row, day, true);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        );
      })}
      <p className="hint">Select a date above, then a tracker name to edit time and notes.</p>
    </>
  );
}

export function Patterns({ items, records }: { items: TrackerItem[]; records: Records }) {
  const today = localDay();
  const days = Array.from({ length: 28 }, (_, i) => shiftDay(today, i - 27));
  return (
    <>
      <div className="page-title">
        <h1>Patterns</h1>
        <span className="date">Last 28 days</span>
      </div>
      {!items.length && <p className="empty">Your history will appear here as you log.</p>}
      {items.map((item) => {
        const byDay = new Map<string, { confirmed: number; skipped: number; extra: number }>();
        for (const record of records.values()) {
          if (!record.value) continue;
          if (record.kind === "entry" && record.key.startsWith(`${item.id}/`)) {
            const day = record.key.split("/")[1];
            const entry = record.value as Entry;
            const row = byDay.get(day) ?? { confirmed: 0, skipped: 0, extra: 0 };
            if (entry.state === "confirmed") row.confirmed++;
            if (entry.state === "skipped") row.skipped++;
            byDay.set(day, row);
          }
          if (record.kind === "event") {
            const event = record.value as ExtraEvent;
            if (event.trackerId === item.id && !event.deleted) {
              const row = byDay.get(event.day) ?? { confirmed: 0, skipped: 0, extra: 0 };
              row.extra++;
              byDay.set(event.day, row);
            }
          }
        }
        const confirmed = days.reduce((n, day) => n + (byDay.get(day)?.confirmed ?? 0), 0);
        const skipped = days.reduce((n, day) => n + (byDay.get(day)?.skipped ?? 0), 0);
        const extras = days.reduce((n, day) => n + (byDay.get(day)?.extra ?? 0), 0);
        const completedDays = [...byDay]
          .filter(([, row]) => row.confirmed + row.extra > 0)
          .map(([day]) => day)
          .sort();
        const intervals = completedDays
          .slice(1)
          .map((day, i) => dayDistance(completedDays[i], day));
        const average = intervals.length
          ? Math.round((intervals.reduce((a, b) => a + b, 0) / intervals.length) * 10) / 10
          : null;
        return (
          <article className="pattern" key={item.id}>
            <div className="pattern-heading">
              <div>
                <h2>{item.value.name}</h2>
                <p className="item-meta">Last done: {ago(lastDone(records, item.id))}</p>
              </div>
              <strong>
                {confirmed}
                <small>confirmed</small>
              </strong>
            </div>
            <svg
              className="history-chart"
              viewBox="0 0 336 18"
              role="img"
              aria-label={`${item.value.name}: ${confirmed} confirmed slots, ${skipped} skipped slots, ${extras} extra occurrences in the last 28 days`}
            >
              {days.map((day, index) => {
                const record = byDay.get(day);
                return (
                  <rect
                    key={day}
                    x={index * 12}
                    y={1}
                    width={9}
                    height={14}
                    rx={2}
                    className={
                      record?.confirmed || record?.extra
                        ? "chart-confirmed"
                        : record?.skipped
                          ? "chart-skipped"
                          : "chart-unknown"
                    }
                  >
                    <title>
                      {day}: {record?.confirmed ?? 0} confirmed, {record?.skipped ?? 0} skipped,{" "}
                      {record?.extra ?? 0} extra
                    </title>
                  </rect>
                );
              })}
            </svg>
            <div className="pattern-footer">
              <span>
                {skipped} skipped / {extras} extra
              </span>
              <span>{average === null ? "" : `Typical gap: ${average}d`}</span>
            </div>
          </article>
        );
      })}
      <p className="hint">
        Empty days are unknown. Counts show slots and extra occurrences separately.
      </p>
    </>
  );
}

export function Trackers({
  items,
  archived,
  add,
  edit,
  update,
}: {
  items: TrackerItem[];
  archived: boolean;
  add: () => void;
  edit: (item: TrackerItem) => void;
  update: (item: TrackerItem, patch: Partial<Tracker>) => Promise<void>;
}) {
  return (
    <>
      <div className="page-title">
        <h1>{archived ? "Archived" : "Trackers"}</h1>
        <button type="button" className="text-button" onClick={add}>
          <Plus />
          Add tracker
        </button>
      </div>
      {!items.length && (
        <p className="empty">
          {archived
            ? "No archived trackers."
            : "Add your first tracker. You can change its schedule and time slots later."}
        </p>
      )}
      {items.map((item) => (
        <div className="tracker-row" key={item.id}>
          <button type="button" className="item-copy" onClick={() => edit(item)}>
            <span className="item-name">{item.value.name}</span>
            <span className="item-meta">
              {item.value.category} / {item.value.slots.length} slot
              {item.value.slots.length === 1 ? "" : "s"} / {item.value.schedule}
            </span>
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`${archived ? "Restore" : "Archive"} ${item.value.name}`}
            onClick={() => void update(item, { archived: !archived })}
          >
            {archived ? <RotateCcw /> : <Archive />}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={`Edit ${item.value.name}`}
            onClick={() => edit(item)}
          >
            <MoreHorizontal />
          </button>
        </div>
      ))}
    </>
  );
}
