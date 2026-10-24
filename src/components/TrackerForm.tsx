import { Plus, X } from "lucide-react";
import { useState } from "react";
import { message } from "../client/api";
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
              category: String(data.get("category")),
              schedule,
              weekdays,
              slots,
              pinned: data.get("pinned") === "on",
              archived: item?.value.archived ?? false,
              order: Number(data.get("order")),
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
        <label>
          Quick-list order
          <input
            name="order"
            type="number"
            min={-1000000}
            max={1000000}
            step="any"
            required
            defaultValue={
              item?.value.order ?? daymark.operations.filter((op) => op.kind === "tracker").length
            }
          />
        </label>
        <p className="hint">Lower numbers appear first.</p>
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
