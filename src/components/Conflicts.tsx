import { useState } from "react";
import { message } from "../client/api";
import type { Daymark } from "../client/useDaymark";
import type { Entry, ExtraEvent, RecordState, Tracker, Value } from "../shared/model";
import { ErrorMessage, Sheet, StatusIcon } from "./ui";

function describeValue(value: Value): string {
  if ("state" in value) return value.state;
  if ("name" in value) return value.archived ? `Archive ${value.name}` : value.name;
  return value.deleted ? "Delete occurrence" : "Keep occurrence";
}
export function Conflicts({
  records,
  trackers,
  daymark,
  close,
  notify,
}: {
  records: RecordState[];
  trackers: Map<string, Tracker>;
  daymark: Daymark;
  close: () => void;
  notify: (text: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const conflict = records[0];
  if (!conflict)
    return (
      <Sheet title="All conflicts resolved" close={close}>
        <p>Every saved edit is accounted for.</p>
        <button className="primary" type="button" onClick={close}>
          Done
        </button>
      </Sheet>
    );
  const trackerId =
    conflict.kind === "entry"
      ? conflict.key.split("/")[0]
      : conflict.kind === "event"
        ? (conflict.heads[0].value as ExtraEvent).trackerId
        : conflict.key;
  const slotId = conflict.key.split("/")[2];
  const slot =
    trackers.get(trackerId)?.slots.find((slot) => slot.id === slotId) ??
    daymark.operations
      .filter((op) => op.kind === "tracker" && op.key === trackerId)
      .flatMap((op) => (op.value as Tracker).slots)
      .find((slot) => slot.id === slotId);
  const name =
    trackers.get(trackerId)?.name ?? (conflict.heads[0].value as Tracker).name ?? "Activity";
  return (
    <Sheet title="Review conflicting edits" close={close}>
      <p className="muted">Both versions were saved. Choose what this entry should show.</p>
      <h3>{name}</h3>
      {conflict.kind === "entry" && (
        <p className="hint">
          {conflict.key.split("/")[1]} / {slot?.name || "Daily slot"}
        </p>
      )}
      <div className="conflict-choices">
        {conflict.heads.map((op) => (
          <article className="conflict-choice" key={op.id}>
            <div className="choice-title">
              {"state" in op.value && <StatusIcon state={(op.value as Entry).state} />}
              <strong>{describeValue(op.value)}</strong>
            </div>
            {"note" in op.value && (
              <>
                {"day" in op.value && <p>{op.value.day}</p>}
                <p>
                  Occurrence time:{" "}
                  {op.value.occurredAt ? (
                    <time dateTime={op.value.occurredAt}>
                      {new Date(op.value.occurredAt).toLocaleString(undefined, {
                        timeZoneName: "short",
                      })}
                    </time>
                  ) : (
                    "Not recorded"
                  )}
                </p>
                <p>{op.value.note || "No notes"}</p>
              </>
            )}
            {"slots" in op.value && (
              <dl className="conflict-fields">
                <dt>Category</dt>
                <dd>{op.value.category || "Personal"}</dd>
                <dt>Schedule</dt>
                <dd>
                  {
                    {
                      daily: "Daily",
                      weekdays: "Selected weekdays",
                      weekly: "Any day this week",
                      "as-needed": "As needed",
                    }[op.value.schedule]
                  }
                  {op.value.schedule === "weekdays"
                    ? ` / ${op.value.weekdays.map((day) => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day]).join(", ")}`
                    : ""}
                </dd>
                <dt>Slots</dt>
                <dd>
                  {op.value.slots.map((slot) => (
                    <p key={slot.id}>
                      {slot.name || "Any time"} / {slot.time || "No time"}
                      {daymark.operations.some(
                        (entry) =>
                          entry.kind === "entry" &&
                          entry.key.startsWith(`${trackerId}/`) &&
                          entry.key.endsWith(`/${slot.id}`),
                      )
                        ? " / Has recorded history"
                        : ""}
                    </p>
                  ))}
                </dd>
                <dt>Show in Today</dt>
                <dd>{op.value.pinned ? "Yes" : "No"}</dd>
                <dt>Quick-list order</dt>
                <dd>{op.value.order}</dd>
                <dt>Archived</dt>
                <dd>{op.value.archived ? "Yes" : "No"}</dd>
              </dl>
            )}
            <p className="hint">Recorded {new Date(op.createdAt).toLocaleString()}</p>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await daymark.save(
                    conflict.kind,
                    conflict.key,
                    op.value,
                    conflict.heads.map((head) => head.id),
                  );
                  notify("Conflict resolved");
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Keep {describeValue(op.value)}
            </button>
          </article>
        ))}
      </div>
      <ErrorMessage text={error} />
      <p className="hint">The edit history keeps both versions.</p>
    </Sheet>
  );
}
