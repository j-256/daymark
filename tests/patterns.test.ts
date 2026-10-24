import { expect, it } from "vitest";
import { summarizePattern } from "../src/client/patterns";
import { type Entry, type ExtraEvent, materialize, type Operation } from "../src/shared/model";

function entry(day: string, slot = "morning", state: Entry["state"] = "confirmed"): Operation {
  return {
    id: crypto.randomUUID(),
    kind: "entry",
    key: `tracker/${day}/${slot}`,
    parents: [],
    createdAt: new Date().toISOString(),
    value: { state, note: "", occurredAt: null },
  };
}
function extra(day: string, deleted = false): Operation {
  return {
    id: crypto.randomUUID(),
    kind: "event",
    key: crypto.randomUUID(),
    parents: [],
    createdAt: new Date().toISOString(),
    value: { trackerId: "tracker", day, note: "", occurredAt: null, deleted },
  };
}
it("limits all totals and gaps to inclusive selected calendar days", () => {
  const records = materialize([
    entry("2026-09-01"),
    entry("2026-10-18"),
    entry("2026-10-18", "evening"),
    entry("2026-10-21"),
    entry("2026-10-24", "evening"),
    entry("2026-10-25"),
    extra("2026-10-21"),
    extra("2026-10-20", true),
  ]);
  const summary = summarizePattern(records, "tracker", "2026-10-18", "2026-10-24");
  expect(summary.confirmed).toBe(4);
  expect(summary.extra).toBe(1);
  expect(summary.completedDays).toEqual(["2026-10-18", "2026-10-21", "2026-10-24"]);
  expect(summary.gaps).toEqual([3, 3]);
  expect(summary.averageGap).toBe(3);
  expect(summary.slots.get("evening")?.confirmed).toBe(2);
});
it("keeps unknowns and conflicts separate from recorded completion and includes retired slot history", () => {
  const confirmed = entry("2026-10-19");
  const skipped = {
    ...confirmed,
    id: crypto.randomUUID(),
    value: { ...(confirmed.value as Entry), state: "skipped" as const },
  };
  const event = extra("2026-10-20");
  const eventConflict = {
    ...event,
    id: crypto.randomUUID(),
    value: { ...(event.value as ExtraEvent), deleted: true },
  };
  const summary = summarizePattern(
    materialize([
      confirmed,
      skipped,
      event,
      eventConflict,
      entry("2026-10-21", "retired", "skipped"),
      entry("2026-10-22", "morning", "unknown"),
    ]),
    "tracker",
    "2026-10-18",
    "2026-10-24",
  );
  expect(summary.conflicts).toBe(2);
  expect(summary.confirmed).toBe(0);
  expect(summary.extra).toBe(0);
  expect(summary.skipped).toBe(1);
  expect(summary.slots.get("retired")?.skipped).toBe(1);
  expect(summary.slots.get("morning")?.unknown).toBe(1);
  expect(summary.averageGap).toBeNull();
  expect(summary.completedDays).toEqual([]);
});
it("reports no gap for empty or single-completion ranges", () => {
  expect(summarizePattern(new Map(), "tracker", "2026-10-18", "2026-10-24").averageGap).toBeNull();
  expect(
    summarizePattern(materialize([extra("2026-10-20")]), "tracker", "2026-10-18", "2026-10-24")
      .averageGap,
  ).toBeNull();
});
