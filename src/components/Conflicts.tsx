import { useState } from "react";
import { message } from "../client/api";
import type { Daymark } from "../client/useDaymark";
import type { Entry, RecordState, Tracker, Value } from "../shared/model";
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
  const trackerId = conflict.kind === "entry" ? conflict.key.split("/")[0] : conflict.key;
  const name =
    trackers.get(trackerId)?.name ?? (conflict.heads[0].value as Tracker).name ?? "Activity";
  return (
    <Sheet title="Review conflicting edits" close={close}>
      <p className="muted">Both versions were saved. Choose what this entry should show.</p>
      <h3>{name}</h3>
      {conflict.kind === "entry" && <p className="hint">{conflict.key.split("/")[1]}</p>}
      <div className="conflict-choices">
        {conflict.heads.map((op) => (
          <article className="conflict-choice" key={op.id}>
            <div className="choice-title">
              {"state" in op.value && <StatusIcon state={(op.value as Entry).state} />}
              <strong>{describeValue(op.value)}</strong>
            </div>
            {"note" in op.value && op.value.note && <p>{op.value.note}</p>}
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
