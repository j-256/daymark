import {
  type Entry,
  type ExtraEvent,
  type Kind,
  type Operation,
  STATUSES,
  type Tracker,
} from "./model";

export const LIMITS = Object.freeze({
  batch: 40,
  body: 262144,
  note: 2000,
  name: 80,
  parents: 100,
  slots: 8,
  backup: 20000000,
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER = /^[a-zA-Z0-9_-]{1,80}$/;
export class ValidationError extends Error {}
function invalid(): never {
  throw new ValidationError("Invalid or unbounded data");
}
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : invalid();
const exact = (o: Record<string, unknown>, fields: string[]) => {
  if (Object.keys(o).some((k) => !fields.includes(k)) || fields.some((k) => !(k in o))) invalid();
};
const string = (v: unknown, max: number, min = 0): string =>
  typeof v === "string" && v.length >= min && v.length <= max && !v.includes("\0") ? v : invalid();
export const identifier = (v: unknown): string =>
  typeof v === "string" && IDENTIFIER.test(v) ? v : invalid();
const bool = (v: unknown): boolean => (typeof v === "boolean" ? v : invalid());
export function validDay(v: unknown): string {
  const day = string(v, 10, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) ||
    new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day ||
    day < "1900-01-01" ||
    day > "2200-12-31"
  )
    invalid();
  return day;
}
const timestamp = (v: unknown): string => {
  const s = string(v, 40, 20);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) && Number.isFinite(Date.parse(s)) ? s : invalid();
};
const occurred = (v: unknown): string | null => (v === null ? null : timestamp(v));

export function validateTracker(v: unknown): Tracker {
  const o = object(v);
  exact(o, ["name", "category", "slots", "schedule", "weekdays", "pinned", "archived", "order"]);
  if (!["daily", "weekdays", "weekly", "as-needed"].includes(o.schedule as string)) invalid();
  if (!Array.isArray(o.slots) || !o.slots.length || o.slots.length > LIMITS.slots) invalid();
  const slots = o.slots.map((value) => {
    const slot = object(value);
    exact(slot, ["id", "name", "time"]);
    const time = string(slot.time, 5);
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) invalid();
    return { id: identifier(slot.id), name: string(slot.name, 40), time };
  });
  if (new Set(slots.map((s) => s.id)).size !== slots.length) invalid();
  if (
    !Array.isArray(o.weekdays) ||
    o.weekdays.length > 7 ||
    o.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)
  )
    invalid();
  if (o.schedule === "weekdays" && !o.weekdays.length) invalid();
  if (typeof o.order !== "number" || !Number.isFinite(o.order) || Math.abs(o.order) > 1000000)
    invalid();
  return {
    name: string(o.name, LIMITS.name, 1).trim() || invalid(),
    category: string(o.category, 40),
    slots,
    schedule: o.schedule as Tracker["schedule"],
    weekdays: [...new Set(o.weekdays as number[])],
    pinned: bool(o.pinned),
    archived: bool(o.archived),
    order: o.order,
  };
}

export function validateOperation(value: unknown): Operation {
  const o = object(value);
  exact(o, ["id", "kind", "key", "parents", "value", "createdAt"]);
  const id = string(o.id, 36, 36);
  if (!UUID.test(id)) invalid();
  if (!["tracker", "entry", "event"].includes(o.kind as string)) invalid();
  const kind = o.kind as Kind;
  const key = string(o.key, 200, 1);
  const createdAt = timestamp(o.createdAt);
  if (
    !Array.isArray(o.parents) ||
    o.parents.length > LIMITS.parents ||
    o.parents.some((p) => typeof p !== "string" || !UUID.test(p) || p === id) ||
    new Set(o.parents).size !== o.parents.length
  )
    invalid();
  let validated: Tracker | Entry | ExtraEvent;
  if (kind === "tracker") {
    identifier(key);
    validated = validateTracker(o.value);
  } else if (kind === "entry") {
    const parts = key.split("/");
    if (parts.length !== 3) invalid();
    identifier(parts[0]);
    validDay(parts[1]);
    identifier(parts[2]);
    const e = object(o.value);
    exact(e, ["state", "note", "occurredAt"]);
    if (!STATUSES.includes(e.state as Entry["state"])) invalid();
    validated = {
      state: e.state as Entry["state"],
      note: string(e.note, LIMITS.note),
      occurredAt: occurred(e.occurredAt),
    };
  } else {
    identifier(key);
    const e = object(o.value);
    exact(e, ["trackerId", "day", "occurredAt", "note", "deleted"]);
    validated = {
      trackerId: identifier(e.trackerId),
      day: validDay(e.day),
      occurredAt: occurred(e.occurredAt),
      note: string(e.note, LIMITS.note),
      deleted: bool(e.deleted),
    };
  }
  return { id, kind, key, parents: o.parents as string[], value: validated, createdAt };
}
