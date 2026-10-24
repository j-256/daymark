import { extraRecords } from "../client/history";
import { type Entry, type ExtraEvent, localDay } from "../shared/model";
import type { EntrySelection } from "./EntryForm";
import { Sheet, StatusIcon } from "./ui";
import { entryRecord, type Records, selectionFor, statusFor, type TrackerRow } from "./Views";

export function HistoryDetails({
  trackerId,
  rows,
  records,
  day,
  selectDay,
  edit,
  review,
  close,
}: {
  trackerId: string;
  rows: TrackerRow[];
  records: Records;
  day: string;
  selectDay: (day: string) => void;
  edit: (selection: EntrySelection) => void;
  review: () => void;
  close: () => void;
}) {
  const extras = extraRecords(records, trackerId, day);
  const first = rows[0];
  return (
    <Sheet title={first ? `History / ${first.tracker.name}` : "History"} close={close}>
      <label>
        History date
        <input
          type="date"
          value={day}
          min="1900-01-01"
          max={localDay()}
          onChange={(event) => {
            if (event.target.value && event.target.validity.valid) selectDay(event.target.value);
          }}
        />
      </label>
      {!first && (
        <p className="notice">
          This tracker is unavailable. Close history to review conflicting edits.
        </p>
      )}
      <div className="history-entries">
        {rows.map((row) => {
          const value = entryRecord(records, row, day)?.value as Entry | null;
          const state = statusFor(records, row, day);
          const name = row.slot.name || "Any time";
          return (
            <article className="history-entry" key={row.slot.id}>
              <div className="history-copy">
                <h3>
                  {name}
                  {row.retired ? " / Retired slot" : ""}
                </h3>
                <p className="history-state">
                  <StatusIcon state={state} />
                  {state === "conflict"
                    ? "Conflicting edits"
                    : state[0].toUpperCase() + state.slice(1)}
                  {value?.occurredAt && (
                    <time dateTime={value.occurredAt}>
                      {new Date(value.occurredAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                  )}
                </p>
                {value?.note && <p className="history-note">{value.note}</p>}
              </div>
              <button
                type="button"
                className="secondary compact"
                onClick={() =>
                  state === "conflict" ? review() : edit(selectionFor(records, row, day))
                }
              >
                {state === "conflict" ? "Review" : `Edit ${name}`}
              </button>
            </article>
          );
        })}
      </div>
      <section className="settings-section" aria-label="Extra occurrences">
        <h3>Extra occurrences</h3>
        {!extras.length && <p className="hint">No extra logs for this date.</p>}
        {extras.map((record) => {
          const value = record.value as ExtraEvent | null;
          return (
            <article className="history-extra" key={record.key}>
              {record.conflict ? (
                <button type="button" className="text-button" onClick={review}>
                  Review conflicting extra log
                </button>
              ) : (
                <>
                  <p className="muted">
                    {value?.occurredAt ? (
                      <time dateTime={value.occurredAt}>
                        {new Date(value.occurredAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    ) : (
                      "Time not recorded"
                    )}
                  </p>
                  <p className="history-note">{value?.note || "No notes"}</p>
                </>
              )}
            </article>
          );
        })}
        {first && (
          <div className="history-actions">
            <button
              className="text-button"
              type="button"
              onClick={() =>
                edit({
                  ...selectionFor(records, first, day),
                  extra: true,
                  value: {
                    state: "confirmed",
                    note: "",
                    occurredAt: day === localDay() ? new Date().toISOString() : null,
                  },
                })
              }
            >
              Log extra occurrence
            </button>
            {extras.some((record) => !record.conflict) && (
              <button
                className="text-button"
                type="button"
                onClick={() => edit(selectionFor(records, first, day))}
              >
                Manage extra logs
              </button>
            )}
          </div>
        )}
      </section>
    </Sheet>
  );
}
