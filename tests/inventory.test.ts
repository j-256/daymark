import { describe, expect, it } from "vitest";
import {
  consumptionFor,
  formatQuantity,
  parseQuantity,
  stockBalances,
} from "../src/client/inventory";
import type { Entry, Operation, Tracker } from "../src/shared/model";
import { validateOperation } from "../src/shared/validation";

const stock = { name: "Medication", unit: "tablets", lowStock: 5000, archived: false };
const use = { itemId: "medication", quantity: 1000 };
const tracker: Tracker = {
  name: "Dose",
  category: "Health",
  slots: [{ id: "am", name: "Morning", time: "08:00" }],
  schedule: "daily",
  weekdays: [],
  pinned: true,
  archived: false,
  order: 0,
  inventory: use,
};
const op = (
  kind: Operation["kind"],
  key: string,
  value: Operation["value"],
  parents: string[] = [],
): Operation => ({
  id: crypto.randomUUID(),
  kind,
  key,
  value,
  parents,
  createdAt: "2026-10-25T08:00:00.000Z",
});
const item = () => op("inventory", "medication", stock);
const movement = (quantity: number) =>
  op("stock", crypto.randomUUID(), {
    itemId: "medication",
    quantity,
    reason: quantity < 0 ? "used" : "refill",
    note: "",
    day: "2026-10-25",
    deleted: false,
  });
const dose = (state: Entry["state"] = "confirmed") =>
  op("entry", "dose/2026-10-25/am", {
    state,
    note: "",
    occurredAt: null,
    ...(state === "confirmed" ? { inventory: use } : {}),
  });

describe("inventory quantities", () => {
  it("uses exact fractional units and rejects ambiguous or excessive values", () => {
    expect(parseQuantity("0.125")).toBe(125);
    expect(parseQuantity("1000000")).toBe(1000000000);
    expect(formatQuantity(1250)).toBe("1.25");
    expect(formatQuantity(-500)).toBe("-0.5");
    for (const value of ["", "NaN", "1e3", "0.0001", "-1", "1000000.001", "1,000"])
      expect(() => parseQuantity(value)).toThrow();
  });
  it("merges concurrent refills and counts retries once", () => {
    const a = movement(30000);
    const b = movement(60000);
    for (const operations of [
      [item(), a, b, a],
      [item(), b, a],
    ])
      expect(stockBalances(operations).get("medication")).toMatchObject({
        quantity: 90000,
        uncertain: false,
      });
  });
  it("deducts a confirmed slot once and restores stock when it is cleared", () => {
    const first = dose();
    expect(stockBalances([item(), movement(30000), first, first]).get("medication")?.quantity).toBe(
      29000,
    );
    const cleared = op("entry", first.key, { state: "unknown", note: "", occurredAt: null }, [
      first.id,
    ]);
    expect(
      stockBalances([item(), movement(30000), first, cleared]).get("medication")?.quantity,
    ).toBe(30000);
  });
  it("removes consumption when an extra is deleted and stock when a refill is undone", () => {
    const refill = movement(30000);
    const event = op("event", "extra", {
      trackerId: "dose",
      day: "2026-10-25",
      note: "",
      occurredAt: null,
      deleted: false,
      inventory: use,
    });
    const deleted = op("event", event.key, { ...event.value, deleted: true }, [event.id]);
    const undo = op("stock", refill.key, { ...refill.value, deleted: true }, [refill.id]);
    expect(stockBalances([item(), refill, event]).get("medication")?.quantity).toBe(29000);
    expect(stockBalances([item(), refill, event, deleted]).get("medication")?.quantity).toBe(30000);
    expect(stockBalances([item(), refill, event, deleted, undo]).get("medication")?.quantity).toBe(
      0,
    );
  });
  it("reports uncertain quantities until contradictory dose edits are resolved", () => {
    const confirmed = dose();
    const skipped = dose("skipped");
    const operations = [item(), movement(30000), confirmed, skipped];
    expect(stockBalances(operations).get("medication")?.uncertain).toBe(true);
    const resolved = op("entry", confirmed.key, confirmed.value, [confirmed.id, skipped.id]);
    expect(stockBalances([...operations, resolved]).get("medication")).toMatchObject({
      quantity: 29000,
      uncertain: false,
    });
  });
  it("keeps balances exact when a conflict changes only notes", () => {
    const first = dose();
    const second = op("entry", first.key, { ...first.value, note: "Other note" });
    expect(stockBalances([item(), movement(30000), first, second]).get("medication")).toMatchObject(
      { quantity: 29000, uncertain: false },
    );
  });
  it("retains archived supplies and reports stock movement conflicts", () => {
    const first = movement(30000);
    const other = op("stock", first.key, { ...first.value, quantity: 60000 });
    expect(
      stockBalances([
        op("inventory", "medication", { ...stock, archived: true }),
        first,
        other,
      ]).get("medication"),
    ).toMatchObject({ item: { archived: true }, uncertain: true });
  });
  it("preserves recorded use on notes or link changes without backfilling old confirmations", () => {
    const previous: Entry = { state: "confirmed", note: "", occurredAt: null, inventory: use };
    const changed = { ...tracker, inventory: { ...use, quantity: 2000 } };
    expect(consumptionFor(changed, previous, true)).toEqual(use);
    expect(consumptionFor(changed, { ...previous, inventory: undefined }, true)).toBeUndefined();
    expect(consumptionFor(changed, { ...previous, state: "unknown" }, true)).toEqual({
      itemId: "medication",
      quantity: 2000,
    });
    expect(consumptionFor(changed, previous, false)).toBeUndefined();
  });
});

describe("inventory validation", () => {
  it("preserves old operation shapes and accepts bounded inventory operations", () => {
    const old = op("entry", "dose/2026-10-25/am", {
      state: "confirmed",
      note: "",
      occurredAt: null,
    });
    expect(validateOperation(old)).toEqual(old);
    for (const value of [item(), movement(30000), dose(), op("tracker", "dose", tracker)])
      expect(validateOperation(value)).toEqual(value);
  });
  it("rejects invalid quantities and unauthorized consumption shapes", () => {
    for (const value of [
      op("inventory", "medication", { ...stock, lowStock: -1 }),
      movement(0),
      movement(0.5),
      movement(1000000001),
      op("entry", "dose/2026-10-25/am", {
        state: "skipped",
        note: "",
        occurredAt: null,
        inventory: use,
      }),
      op("entry", "dose/2026-10-25/am", {
        state: "confirmed",
        note: "",
        occurredAt: null,
        inventory: { ...use, quantity: 0 },
      }),
      op("inventory", "medication", { ...stock, unit: "" }),
    ])
      expect(() => validateOperation(value)).toThrow();
  });
});
