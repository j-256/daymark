import { expect, it } from "vitest";
import { extraRecords } from "../src/client/history";
import { materialize, type Operation } from "../src/shared/model";

const day = "2026-10-24";
function extra(patch = {}, parents: string[] = []): Operation {
  return {
    id: crypto.randomUUID(),
    kind: "event",
    key: "extra",
    parents,
    value: {
      trackerId: "tracker",
      day,
      occurredAt: null,
      note: "After swimming",
      deleted: false,
      ...patch,
    },
    createdAt: new Date().toISOString(),
  };
}
it("selects a tracker's day extras without counting deleted or unrelated events", () => {
  const original = extra();
  const deleted = extra({ deleted: true }, [original.id]);
  const other = extra({ trackerId: "other" });
  other.key = "other";
  const yesterday = extra({ day: "2026-10-23" });
  yesterday.key = "yesterday";
  const active = extra();
  active.key = "active";
  expect(
    extraRecords(materialize([original, deleted, other, yesterday, active]), "tracker", day).map(
      (record) => record.key,
    ),
  ).toEqual(["active"]);
});
it("keeps a conflicting extra visible for review instead of presenting it as confirmed", () => {
  const first = extra();
  const second = extra({ deleted: true });
  const records = extraRecords(materialize([first, second]), "tracker", day);
  expect(records).toHaveLength(1);
  expect(records[0].conflict).toBe(true);
  expect(records[0].value).toBeNull();
});
