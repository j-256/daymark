import { describe, expect, it } from "vitest";
import { heads, materialize, type Operation, operation } from "../src/shared/model";
import { validateOperation } from "../src/shared/validation";

const entry = (id: string, parents: string[], state = "confirmed", time = "2026-10-24T08:00:00Z") =>
  ({
    id,
    kind: "entry",
    key: "tracker/2026-10-24/morning",
    parents,
    value: { state, note: "", occurredAt: null },
    createdAt: time,
  }) as Operation;
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";

describe("causal records", () => {
  it("merges independent records without timestamp replacement", () => {
    const a = entry(A, []);
    const b = { ...entry(B, [], "skipped"), key: "other/2026-10-24/default" };
    expect(materialize([a, b]).size).toBe(2);
  });
  it("preserves contradictory concurrent edits in either arrival order", () => {
    const a = entry(A, [], "confirmed", "2030-01-01T00:00:00Z");
    const b = entry(B, [], "skipped", "2020-01-01T00:00:00Z");
    for (const ops of [
      [a, b],
      [b, a],
    ])
      expect(materialize(ops).get(`${a.kind}/${a.key}`)?.conflict).toBe(true);
  });
  it("resolves observed heads while retaining audit history", () => {
    const a = entry(A, []);
    const b = entry(B, [], "skipped");
    const c = entry(C, [A, B], "unknown");
    expect(heads([c, b, a])).toEqual([c]);
    expect(materialize([a, b, c]).get(`entry/${a.key}`)?.value).toEqual(c.value);
  });
  it("does not turn an out-of-order parent into a resurrected head", () => {
    const a = entry(A, []);
    const b = entry(B, [A], "skipped");
    expect(heads([b, a])).toEqual([b]);
  });
  it("coalesces equal concurrent values and tolerates identical retries", () => {
    const a = entry(A, []);
    const b = entry(B, []);
    const record = materialize([a, b, a]).get(`entry/${a.key}`);
    expect(record?.conflict).toBe(false);
    expect(record?.heads).toHaveLength(2);
  });
  it("only supersedes parents from the same record", () => {
    const a = entry(A, []);
    const b = { ...entry(B, [A]), key: "other/2026-10-24/default" };
    expect(materialize([a, b]).get(`entry/${a.key}`)?.heads).toEqual([a]);
  });
  it("creates edits with every observed head as a parent", () => {
    const ops = [entry(A, []), entry(B, [], "skipped")];
    expect(operation(ops, "entry", ops[0].key, ops[0].value).parents.sort()).toEqual([A, B]);
  });
});

describe("operation validation", () => {
  it("accepts canonical bounded entries", () =>
    expect(validateOperation(entry(A, []))).toEqual(entry(A, [])));
  it.each([
    { id: "bad" },
    { key: "tracker/2026-02-30/morning" },
    { parents: [A] },
    { value: { state: "done" } },
    { value: { state: "confirmed", note: "x".repeat(2001), occurredAt: null } },
    { createdAt: "yesterday" },
    { kind: "settings" },
    { arbitrary: "ignored?" },
  ])("rejects malformed or unbounded input %j", (patch) => {
    expect(() => validateOperation({ ...entry(A, []), ...patch })).toThrow();
  });
});
