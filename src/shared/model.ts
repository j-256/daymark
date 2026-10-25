export const SYNC_PROTOCOL = "2";
export const SYNC_PROTOCOL_HEADER = "X-Daymark-Sync";
export const STATUSES = ["unknown", "confirmed", "skipped"] as const;
export type Status = (typeof STATUSES)[number];
export type Kind = "tracker" | "entry" | "event" | "inventory" | "stock";
export interface Slot {
  id: string;
  name: string;
  time: string;
}
export interface InventoryUse {
  itemId: string;
  quantity: number;
}
export interface InventoryItem {
  name: string;
  unit: string;
  lowStock: number;
  archived: boolean;
}
export interface StockMovement {
  itemId: string;
  quantity: number;
  reason: "opening" | "refill" | "used" | "adjustment";
  note: string;
  day: string;
  deleted: boolean;
}
export interface Tracker {
  inventory?: InventoryUse;
  name: string;
  category: string;
  slots: Slot[];
  schedule: "daily" | "weekdays" | "weekly" | "as-needed";
  weekdays: number[];
  pinned: boolean;
  archived: boolean;
  order: number;
}
export interface Entry {
  inventory?: InventoryUse;
  state: Status;
  note: string;
  occurredAt: string | null;
}
export interface ExtraEvent {
  inventory?: InventoryUse;
  trackerId: string;
  day: string;
  occurredAt: string | null;
  note: string;
  deleted: boolean;
}
export type Value = Tracker | Entry | ExtraEvent | InventoryItem | StockMovement;
export interface Operation {
  id: string;
  kind: Kind;
  key: string;
  parents: string[];
  value: Value;
  createdAt: string;
}
export interface RecordState<T = Value> {
  kind: Kind;
  key: string;
  heads: Operation[];
  conflict: boolean;
  value: T | null;
}
export const recordKey = (op: Pick<Operation, "kind" | "key">) => `${op.kind}/${op.key}`;

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function heads(operations: Operation[]): Operation[] {
  const unique = new Map(operations.map((op) => [op.id, op]));
  const superseded = new Set<string>();
  for (const op of unique.values()) {
    for (const parent of op.parents) {
      const previous = unique.get(parent);
      if (previous && recordKey(previous) === recordKey(op)) superseded.add(parent);
    }
  }
  return [...unique.values()]
    .filter((op) => !superseded.has(op.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function materialize(operations: Operation[]): Map<string, RecordState> {
  const groups = new Map<string, Operation[]>();
  for (const op of operations) {
    const key = recordKey(op);
    const group = groups.get(key) ?? [];
    group.push(op);
    groups.set(key, group);
  }
  return new Map(
    [...groups].map(([key, ops]) => {
      const versions = heads(ops);
      const values = new Set(versions.map((op) => canonical(op.value)));
      return [
        key,
        {
          kind: ops[0].kind,
          key: ops[0].key,
          heads: versions,
          conflict: values.size > 1,
          value: values.size === 1 ? versions[0].value : null,
        },
      ];
    }),
  );
}

export function operation(
  operations: Operation[],
  kind: Kind,
  key: string,
  value: Value,
): Operation {
  return {
    id: crypto.randomUUID(),
    kind,
    key,
    value,
    parents: heads(operations.filter((op) => op.kind === kind && op.key === key)).map(
      (op) => op.id,
    ),
    createdAt: new Date().toISOString(),
  };
}

export function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftDay(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return localDay(date);
}

export function weekStart(day: string): string {
  const weekday = new Date(`${day}T12:00:00`).getDay();
  return shiftDay(day, -((weekday + 6) % 7));
}

export function dayDistance(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export const entryKey = (trackerId: string, day: string, slotId: string) =>
  `${trackerId}/${day}/${slotId}`;

export function due(tracker: Tracker, day: string): boolean {
  if (tracker.schedule === "as-needed") return false;
  if (tracker.schedule === "weekdays")
    return tracker.weekdays.includes(new Date(`${day}T12:00:00`).getDay());
  return true;
}
