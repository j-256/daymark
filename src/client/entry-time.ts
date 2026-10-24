import { localDay } from "../shared/model";

export type TimeChoice = "earlier" | "later";
export function localInstants(day: string, time: string): string[] {
  if (!time) return [];
  const first = new Date(`${day}T${time}:00`);
  const matches = (value: Date) =>
    localDay(value) === day && value.toTimeString().slice(0, 5) === time;
  if (!Number.isFinite(first.getTime()) || !matches(first))
    throw new Error("That local time does not exist on this date");
  const values = [first.toISOString()];
  const MAX_OVERLAP_MINUTES = 180;
  for (let minute = 1; minute <= MAX_OVERLAP_MINUTES; minute++) {
    const candidate = new Date(first.getTime() + minute * 60000);
    if (matches(candidate)) values.push(candidate.toISOString());
  }
  return values;
}
export function savedInstant(
  original: string | null,
  changed: boolean,
  day: string,
  time: string,
  choice: TimeChoice,
): string | null {
  if (!changed) return original;
  const values = localInstants(day, time);
  return (choice === "later" ? values.at(-1) : values[0]) ?? null;
}
