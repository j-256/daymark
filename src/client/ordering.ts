import type { Tracker } from "../shared/model";
import type { LocalChange } from "./storage";

export type MoveDirection = "up" | "down";
interface OrderedTracker {
  id: string;
  value: Tracker;
  parents: string[];
}
export interface TrackerChange extends LocalChange {
  kind: "tracker";
  value: Tracker;
}
export function reorderChanges(
  items: OrderedTracker[],
  id: string,
  direction: MoveDirection,
): TrackerChange[] {
  const index = items.findIndex((item) => item.id === id);
  const target = index + (direction === "up" ? -1 : 1);
  if (index < 0 || target < 0 || target >= items.length) return [];
  const reordered = [...items];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  return reordered.flatMap((item, order) =>
    item.value.order === order
      ? []
      : [
          {
            kind: "tracker" as const,
            key: item.id,
            value: { ...item.value, order },
            parents: [...item.parents],
          },
        ],
  );
}
