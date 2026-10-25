import { Plus, X } from "lucide-react";
import { useState } from "react";
import { message } from "../client/api";
import { formatQuantity, parseQuantity, stockBalances } from "../client/inventory";
import type { Daymark } from "../client/useDaymark";
import type { Slot, Tracker } from "../shared/model";
import { validateTracker } from "../shared/validation";
import { ErrorMessage, Sheet } from "./ui";

export interface TrackerItem {
  id: string;
  value: Tracker;
  parents: string[];
}
export function TrackerForm({
  daymark,
  item,
  close,
  notify,
}: {
  daymark: Daymark;
  item?: TrackerItem;
  close: () => void;
  notify: (text: string) => void;
}) {
  const [slots, setSlots] = useState<Slot[]>(
    item?.value.slots ?? [{ id: "default", name: "", time: "" }],
  );
  const [schedule, setSchedule] = useState<Tracker["schedule"]>(item?.value.schedule ?? "daily");
  const [weekdays, setWeekdays] = useState(item?.value.weekdays ?? [1, 2, 3, 4, 5]);
  const [inventoryId, setInventoryId] = useState(item?.value.inventory?.itemId ?? "");
  const [amount, setAmount] = useState(formatQuantity(item?.value.inventory?.quantity ?? 1000));
  const supplies = [...stockBalances(daymark.operations).values()].filter(
    (stock) => !stock.item.archived || stock.id === inventoryId,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const changeSlot = (id: string, patch: Partial<Slot>) =>
    setSlots((previous) => previous.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));
  return (
    <Sheet title={item ? "Edit tracker" : "Add tracker"} close={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          setBusy(true);
          const data = new FormData(event.currentTarget);
          try {
            const value = validateTracker({
              name: String(data.get("name")),
              ...(inventoryId
                ? { inventory: { itemId: inventoryId, quantity: parseQuantity(amount) } }
                : {}),
              category: String(data.get("category")),
              schedule,
              weekdays,
              slots,
              pinned: data.get("pinned") === "on",
              archived: item?.value.archived ?? false,
              order:
                item?.value.order ??
                daymark.operations.filter((op) => op.kind === "tracker").length,
            });
            await daymark.save(
              "tracker",
              item?.id ?? crypto.randomUUID(),
              value,
              item?.parents ?? [],
            );
            notify(item ? "Tracker updated" : "Tracker added");
            close();
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Tracker name
          <input
            name="name"
            maxLength={80}
            required
            defaultValue={item?.value.name}
            placeholder="Pills, shower, change sheets..."
          />
        </label>
        <label>
          Category
          <input
            name="category"
            list="categories"
            maxLength={40}
            defaultValue={item?.value.category ?? "Personal"}
          />
        </label>
        <datalist id="categories">
          <option value="Health" />
          <option value="Personal care" />
          <option value="Home" />
        </datalist>
        <label>
          Schedule
          <select
            value={schedule}
            onChange={(event) => setSchedule(event.target.value as Tracker["schedule"])}
          >
            <option value="daily">Daily</option>
            <option value="weekdays">Selected weekdays</option>
            <option value="weekly">Any day this week</option>
            <option value="as-needed">As needed</option>
          </select>
        </label>
        {schedule === "weekdays" && (
          <fieldset>
            <legend>Days</legend>
            <div className="weekday-choices">
              {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
                (label, index) => (
                  <label key={label} className="weekday-choice">
                    <input
                      type="checkbox"
                      aria-label={label}
                      checked={weekdays.includes(index)}
                      onChange={() =>
                        setWeekdays((previous) =>
                          previous.includes(index)
                            ? previous.filter((day) => day !== index)
                            : [...previous, index],
                        )
                      }
                    />
                    <span>{label[0]}</span>
                  </label>
                ),
              )}
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend>Daily slots</legend>
          <p className="hint">Keep one slot, or add named times such as morning and evening.</p>
          {slots.map((slot, index) => (
            <div className="slot-fields" key={slot.id}>
              <label>
                Slot name {index + 1}
                <input
                  maxLength={40}
                  value={slot.name}
                  placeholder="Any time"
                  onChange={(event) => changeSlot(slot.id, { name: event.target.value })}
                />
              </label>
              <label>
                Time {index + 1}
                <input
                  type="time"
                  value={slot.time}
                  onChange={(event) => changeSlot(slot.id, { time: event.target.value })}
                />
              </label>
              {slots.length > 1 && (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={`Remove slot ${index + 1}`}
                  onClick={() =>
                    setSlots((previous) => previous.filter((other) => other.id !== slot.id))
                  }
                >
                  <X />
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            className="text-button"
            disabled={slots.length >= 8}
            onClick={() =>
              setSlots((previous) => [...previous, { id: crypto.randomUUID(), name: "", time: "" }])
            }
          >
            <Plus />
            Add time slot
          </button>
        </fieldset>
        <fieldset>
          <legend>Stock tracking (optional)</legend>
          <label>
            Inventory item
            <select value={inventoryId} onChange={(event) => setInventoryId(event.target.value)}>
              <option value="">Don't track stock</option>
              {supplies.map((stock) => (
                <option key={stock.id} value={stock.id}>
                  {stock.item.name}
                  {stock.item.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          {inventoryId && (
            <label>
              Quantity per occurrence
              <input
                type="text"
                inputMode="decimal"
                maxLength={24}
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </label>
          )}
          <p className="hint">
            Each newly confirmed slot or extra log deducts this amount. Earlier entries keep their
            recorded stock use.
          </p>
        </fieldset>
        <label className="check-label">
          <input type="checkbox" name="pinned" defaultChecked={item?.value.pinned ?? true} />
          Show in Today
        </label>
        <ErrorMessage text={error} />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving..." : "Save tracker"}
        </button>
      </form>
    </Sheet>
  );
}
