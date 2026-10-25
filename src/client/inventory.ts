import {
  canonical,
  type Entry,
  type ExtraEvent,
  type InventoryItem,
  type InventoryUse,
  materialize,
  type Operation,
  type StockMovement,
  type Tracker,
} from "../shared/model";
import { MAX_QUANTITY, QUANTITY_SCALE } from "../shared/validation";

export function parseQuantity(input: string): number {
  const text = input.trim();
  if (text.length > 24 || !/^(?:\d+(?:\.\d{1,3})?|\.\d{1,3})$/.test(text))
    throw new Error("Enter a quantity with up to three decimal places");
  const [whole, fraction = ""] = text.split(".");
  const amount = Number(whole) * QUANTITY_SCALE + Number(fraction.padEnd(3, "0"));
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_QUANTITY)
    throw new Error("Quantity must be between 0 and 1,000,000");
  return amount;
}
export function formatQuantity(amount: number): string {
  const absolute = Math.abs(amount);
  const fraction = String(absolute % QUANTITY_SCALE)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${amount < 0 ? "-" : ""}${Math.floor(absolute / QUANTITY_SCALE)}${fraction ? `.${fraction}` : ""}`;
}
export function consumptionFor(
  tracker: Tracker,
  previous: Entry | ExtraEvent | undefined,
  confirmed: boolean,
): InventoryUse | undefined {
  if (!confirmed) return undefined;
  if (previous && ("state" in previous ? previous.state === "confirmed" : !previous.deleted))
    return previous.inventory;
  return tracker.inventory;
}
export interface StockBalance {
  id: string;
  item: InventoryItem;
  quantity: number;
  uncertain: boolean;
}
export function stockBalances(operations: Operation[]): Map<string, StockBalance> {
  const records = materialize(operations);
  const result = new Map<string, StockBalance>();
  for (const record of records.values()) {
    if (record.kind !== "inventory") continue;
    result.set(record.key, {
      id: record.key,
      item: (record.value ?? record.heads[0].value) as InventoryItem,
      quantity: 0,
      uncertain: record.conflict,
    });
  }
  const ensure = (id: string) => {
    let balance = result.get(id);
    if (!balance) {
      balance = {
        id,
        item: { name: "Missing supply", unit: "units", lowStock: 0, archived: true },
        quantity: 0,
        uncertain: true,
      };
      result.set(id, balance);
    }
    return balance;
  };
  for (const record of records.values()) {
    if (!["stock", "entry", "event"].includes(record.kind)) continue;
    const deltas = record.heads.map((op) => {
      if (op.kind === "stock") {
        const value = op.value as StockMovement;
        return value.deleted ? null : { itemId: value.itemId, quantity: value.quantity };
      }
      const value = op.value as Entry | ExtraEvent;
      const active = "state" in value ? value.state === "confirmed" : !value.deleted;
      return active && value.inventory
        ? { itemId: value.inventory.itemId, quantity: -value.inventory.quantity }
        : null;
    });
    if (new Set(deltas.map(canonical)).size > 1) {
      for (const delta of deltas) if (delta) ensure(delta.itemId).uncertain = true;
    } else if (deltas[0]) {
      ensure(deltas[0].itemId).quantity += deltas[0].quantity;
    }
  }
  return result;
}
