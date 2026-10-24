import { expect, it } from "vitest";
import { reorderChanges } from "../src/client/ordering";
import type { Tracker } from "../src/shared/model";

const value: Tracker = {
  name: "Item",
  category: "Home",
  slots: [{ id: "default", name: "", time: "" }],
  weekdays: [],
  schedule: "daily",
  pinned: true,
  archived: false,
  order: 0,
};
const item = (id: string, order: number) => ({
  id,
  value: { ...value, name: id, order },
  parents: [`${id}-observed`],
});
it("moves exactly one position even when saved ranks are tied", () => {
  const items = [item("a", 1), item("b", 1), item("c", 1)];
  const changes = reorderChanges(items, "c", "up");
  const ranks = new Map(items.map((item) => [item.id, item.value.order]));
  for (const change of changes) ranks.set(change.key, change.value.order);
  expect(
    [...items]
      .sort((a, b) => (ranks.get(a.id) ?? 0) - (ranks.get(b.id) ?? 0))
      .map((item) => item.id),
  ).toEqual(["a", "c", "b"]);
  for (const change of changes) {
    expect(change.parents).toEqual([`${change.key}-observed`]);
    expect(change.value.category).toBe("Home");
  }
});
it("uses bounded ranks for extreme inputs and never mutates source versions", () => {
  const items = [item("a", -1000000), item("b", 1000000)];
  const changes = reorderChanges(items, "b", "up");
  expect(changes.map((change) => [change.key, change.value.order])).toEqual([
    ["b", 0],
    ["a", 1],
  ]);
  expect(items[0].value.order).toBe(-1000000);
});
it("does nothing at a boundary or for a missing tracker", () => {
  const items = [item("a", 0), item("b", 1)];
  expect(reorderChanges(items, "a", "up")).toEqual([]);
  expect(reorderChanges(items, "b", "down")).toEqual([]);
  expect(reorderChanges(items, "missing", "up")).toEqual([]);
});
