import { useState } from "react";
import { message } from "../client/api";
import type { Daymark } from "../client/useDaymark";
import {
  type Entry,
  type ExtraEvent,
  entryKey,
  localDay,
  materialize,
  type Slot,
  type Status,
  type Tracker,
} from "../shared/model";
import { ErrorMessage, Sheet } from "./ui";

export interface EntrySelection {
  trackerId: string;
  tracker: Tracker;
  slot: Slot;
  day: string;
  value: Entry;
  parents: string[];
  extra?: boolean;
}
export function EntryForm({
  selection,
  daymark,
  close,
  notify,
}: {
  selection: EntrySelection;
  daymark: Daymark;
  close: () => void;
  notify: (text: string) => void;
}) {
  const [state, setState] = useState<Status>(selection.value.state);
  const [day, setDay] = useState(selection.day);
  const [extra, setExtra] = useState(selection.extra ?? false);
  const [time, setTime] = useState(
    selection.value.occurredAt
      ? new Date(selection.value.occurredAt).toTimeString().slice(0, 5)
      : "",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(selection.value.note);
  const occurrences = [...materialize(daymark.operations).values()].filter((record) => {
    const value = record.value as ExtraEvent | null;
    return (
      record.kind === "event" &&
      value &&
      !value.deleted &&
      value.trackerId === selection.trackerId &&
      value.day === day
    );
  });
  return (
    <Sheet title={selection.tracker.name} close={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setBusy(true);
          try {
            const occurredAt = time ? new Date(`${day}T${time}:00`).toISOString() : null;
            if (extra) {
              const value: ExtraEvent = {
                trackerId: selection.trackerId,
                day,
                occurredAt,
                note,
                deleted: false,
              };
              await daymark.save("event", crypto.randomUUID(), value, []);
            } else {
              const key = entryKey(selection.trackerId, day, selection.slot.id);
              await daymark.save(
                "entry",
                key,
                { state, note, occurredAt: state === "confirmed" ? occurredAt : null },
                selection.parents,
              );
            }
            notify(extra ? "Extra occurrence logged" : "Entry saved");
            close();
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="muted">
          {selection.slot.name || "Daily record"}
          {selection.slot.time ? ` / ${selection.slot.time}` : ""}
        </p>
        <label>
          Date
          <input
            type="date"
            readOnly={!extra}
            value={day}
            max={localDay()}
            min="1900-01-01"
            onChange={(event) => setDay(event.target.value)}
            required
          />
        </label>
        {!extra && (
          <label>
            Status
            <select value={state} onChange={(event) => setState(event.target.value as Status)}>
              <option value="unknown">Unknown</option>
              <option value="confirmed">Confirmed</option>
              <option value="skipped">Skipped</option>
            </select>
          </label>
        )}
        <label>
          Time (optional)
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <label>
          Notes
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={2000}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={extra}
            onChange={(event) => {
              setExtra(event.target.checked);
              if (!event.target.checked) setDay(selection.day);
            }}
          />
          Log an extra occurrence
        </label>
        <p className="hint">Extra occurrences are separate from the scheduled slot.</p>
        <ErrorMessage text={error} />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Saving..." : extra ? "Log occurrence" : "Save entry"}
        </button>
      </form>
      {occurrences.length > 0 && (
        <section className="settings-section" aria-label="Extra occurrences">
          <h3>Extra occurrences</h3>
          {occurrences.map((record) => {
            const value = record.value as ExtraEvent;
            return (
              <div key={record.key} className="occurrence">
                <p>
                  {value.occurredAt
                    ? new Date(value.occurredAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "Time not recorded"}
                </p>
                {value.note && <p>{value.note}</p>}
                <button
                  type="button"
                  className="text-button"
                  aria-label="Delete extra occurrence"
                  disabled={busy || record.conflict}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await daymark.save(
                        "event",
                        record.key,
                        { ...value, deleted: true },
                        record.heads.map((op) => op.id),
                      );
                      notify("Extra occurrence deleted");
                    } catch (e) {
                      setError(message(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </section>
      )}
    </Sheet>
  );
}
