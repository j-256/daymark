import { PackagePlus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { message } from "../client/api";
import {
  formatQuantity,
  parseQuantity,
  type StockBalance,
  stockBalances,
} from "../client/inventory";
import type { Daymark } from "../client/useDaymark";
import {
  type Entry,
  type ExtraEvent,
  localDay,
  materialize,
  type StockMovement,
} from "../shared/model";
import { validateInventory } from "../shared/validation";
import { ErrorMessage, Sheet } from "./ui";

const HISTORY_PAGE_SIZE = 50;
const amountInput = { type: "text", inputMode: "decimal", maxLength: 24 } as const;
const movementNames = {
  opening: "Opening stock",
  refill: "Refill",
  used: "Used or discarded",
  adjustment: "Adjustment",
};
interface ItemEdit {
  balance: StockBalance;
  parents: string[];
}

export function Inventory({
  daymark,
  notify,
  review,
}: {
  daymark: Daymark;
  notify: (text: string) => void;
  review: () => void;
}) {
  const balances = useMemo(() => stockBalances(daymark.operations), [daymark.operations]);
  const records = useMemo(() => materialize(daymark.operations), [daymark.operations]);
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<ItemEdit | "new" | null>(null);
  const [change, setChange] = useState<{ id: string; used: boolean } | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const items = [...balances.values()]
    .filter((balance) => balance.item.archived === archived)
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
  return (
    <>
      <div className="page-title">
        <h1>Inventory</h1>
        <button type="button" className="secondary" onClick={() => setEdit("new")}>
          <Plus />
          Add medication
        </button>
      </div>
      {!items.length && (
        <p className="empty">
          {archived
            ? "No archived medications."
            : "Add a medication and its quantity on hand. Link a tracker to count doses automatically."}
        </p>
      )}
      <div className="stock-list">
        {items.map((balance) => {
          const { id, item, quantity, uncertain } = balance;
          const record = records.get(`inventory/${id}`);
          return (
            <article key={id} className="stock-card" aria-label={item.name}>
              <div className="stock-heading">
                <strong>{item.name}</strong>
                {!record ? (
                  <span className="stock-badge">Supply details missing</span>
                ) : uncertain ? (
                  <button type="button" className="text-button warning" onClick={review}>
                    Needs review
                  </button>
                ) : (
                  quantity <= item.lowStock && (
                    <span className="stock-badge">
                      {quantity <= 0 ? "Out of stock" : "Low stock"}
                    </span>
                  )
                )}
              </div>
              <p className="stock-quantity">
                {uncertain
                  ? "Quantity needs review"
                  : `${formatQuantity(quantity)} ${item.unit} left`}
              </p>
              {!record && (
                <p className="hint">Sync or import a complete backup to restore this supply.</p>
              )}
              <div className="stock-actions">
                {!item.archived && (
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Refill ${item.name}`}
                    onClick={() => setChange({ id, used: false })}
                  >
                    <PackagePlus />
                    Refill
                  </button>
                )}
                {!item.archived && (
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`Use or discard ${item.name}`}
                    onClick={() => setChange({ id, used: true })}
                  >
                    Use / discard
                  </button>
                )}
                <button
                  type="button"
                  className="text-button"
                  aria-label={`History for ${item.name}`}
                  onClick={() => setHistory(id)}
                >
                  History
                </button>
                {record?.value && (
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`Edit ${item.name}`}
                    onClick={() => setEdit({ balance, parents: record.heads.map((op) => op.id) })}
                  >
                    Edit
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          checked={archived}
          onChange={(event) => setArchived(event.target.checked)}
        />
        Show archived medications
      </label>
      {edit && (
        <MedicationForm
          daymark={daymark}
          item={edit === "new" ? undefined : edit}
          close={() => setEdit(null)}
          notify={notify}
        />
      )}
      {change && balances.has(change.id) && (
        <StockForm
          daymark={daymark}
          balance={balances.get(change.id) as StockBalance}
          used={change.used}
          close={() => setChange(null)}
          notify={notify}
        />
      )}
      {history && balances.has(history) && (
        <StockHistory
          daymark={daymark}
          balance={balances.get(history) as StockBalance}
          close={() => setHistory(null)}
          review={() => {
            setHistory(null);
            review();
          }}
        />
      )}
    </>
  );
}

function MedicationForm({
  daymark,
  item,
  close,
  notify,
}: {
  daymark: Daymark;
  item?: ItemEdit;
  close: () => void;
  notify: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title={item ? "Edit medication" : "Add medication"} close={close}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(event.currentTarget);
          try {
            const value = validateInventory({
              name: String(data.get("name")),
              unit: String(data.get("unit")),
              lowStock: parseQuantity(String(data.get("threshold"))),
              archived: data.get("archived") === "on",
            });
            if (item) await daymark.save("inventory", item.balance.id, value, item.parents);
            else {
              const id = crypto.randomUUID();
              const quantity = parseQuantity(String(data.get("quantity")));
              await daymark.saveBatch([
                { kind: "inventory", key: id, value, parents: [] },
                ...(quantity
                  ? [
                      {
                        kind: "stock" as const,
                        key: crypto.randomUUID(),
                        value: {
                          itemId: id,
                          quantity,
                          reason: "opening" as const,
                          day: localDay(),
                          note: "",
                          deleted: false,
                        },
                        parents: [],
                      },
                    ]
                  : []),
              ]);
            }
            notify(item ? "Medication updated" : "Medication added");
            close();
          } catch (error) {
            setError(message(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Medication name
          <input name="name" maxLength={80} required defaultValue={item?.balance.item.name} />
        </label>
        <label>
          Unit
          <input
            name="unit"
            maxLength={24}
            required
            readOnly={Boolean(item)}
            defaultValue={item?.balance.item.unit ?? "tablets"}
          />
        </label>
        <p className="hint">Use one consistent unit, such as tablets, capsules, or mL.</p>
        {!item && (
          <label>
            Quantity on hand
            <input {...amountInput} name="quantity" required defaultValue="0" />
          </label>
        )}
        <label>
          Low stock at
          <input
            {...amountInput}
            name="threshold"
            required
            defaultValue={formatQuantity(item?.balance.item.lowStock ?? 5000)}
          />
        </label>
        {item && (
          <label className="check-label">
            <input type="checkbox" name="archived" defaultChecked={item.balance.item.archived} />
            Archived
          </label>
        )}
        {item && (
          <p className="hint">
            Archiving preserves stock history and deductions from existing linked trackers.
          </p>
        )}
        <ErrorMessage text={error} />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving..." : "Save medication"}
        </button>
      </form>
    </Sheet>
  );
}

function StockForm({
  daymark,
  balance,
  used,
  close,
  notify,
}: {
  daymark: Daymark;
  balance: StockBalance;
  used: boolean;
  close: () => void;
  notify: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Sheet title={used ? "Use or discard stock" : "Record refill"} close={close}>
      <p className="muted">
        {balance.item.name} / {balance.item.unit}
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(event.currentTarget);
          try {
            const quantity = parseQuantity(String(data.get("quantity")));
            if (!quantity) throw new Error("Enter a quantity greater than zero");
            await daymark.save(
              "stock",
              crypto.randomUUID(),
              {
                itemId: balance.id,
                quantity: used ? -quantity : quantity,
                reason: used ? "used" : "refill",
                note: String(data.get("note")),
                day: String(data.get("day")),
                deleted: false,
              },
              [],
            );
            notify(used ? "Stock use recorded" : "Refill recorded");
            close();
          } catch (error) {
            setError(message(error));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Quantity
          <input {...amountInput} name="quantity" required />
        </label>
        <label>
          Date
          <input
            type="date"
            name="day"
            defaultValue={localDay()}
            min="1900-01-01"
            max={localDay()}
            required
          />
        </label>
        <label>
          Notes
          <input name="note" maxLength={2000} />
        </label>
        <ErrorMessage text={error} />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? "Saving..." : "Save stock change"}
        </button>
      </form>
    </Sheet>
  );
}

function StockHistory({
  daymark,
  balance,
  close,
  review,
}: {
  daymark: Daymark;
  balance: StockBalance;
  close: () => void;
  review: () => void;
}) {
  const [limit, setLimit] = useState(HISTORY_PAGE_SIZE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const records = [...materialize(daymark.operations).values()]
    .filter((record) =>
      record.heads.some((op) =>
        op.kind === "stock"
          ? (op.value as StockMovement).itemId === balance.id
          : (op.kind === "entry" || op.kind === "event") &&
            (op.value as Entry | ExtraEvent).inventory?.itemId === balance.id,
      ),
    )
    .sort((a, b) => {
      const day = (record: typeof a) =>
        record.kind === "entry"
          ? record.key.split("/")[1]
          : (record.heads[0].value as StockMovement | ExtraEvent).day;
      return (
        day(b).localeCompare(day(a)) || b.heads[0].createdAt.localeCompare(a.heads[0].createdAt)
      );
    });
  return (
    <Sheet title={`Stock history / ${balance.item.name}`} close={close}>
      <ErrorMessage text={error} />
      {!records.length && <p className="empty">No stock changes yet.</p>}
      <div className="stock-history">
        {records.slice(0, limit).map((record) => {
          const value = record.value ?? record.heads[0].value;
          const stock = record.kind === "stock" ? (value as StockMovement) : null;
          const activity = stock ? null : (value as Entry | ExtraEvent);
          const deleted = stock
            ? stock.deleted
            : activity && "deleted" in activity && activity.deleted;
          const quantity = stock ? stock.quantity : -(activity?.inventory?.quantity ?? 0);
          const day =
            record.kind === "entry"
              ? record.key.split("/")[1]
              : (value as StockMovement | ExtraEvent).day;
          return (
            <article className="stock-history-row" key={`${record.kind}/${record.key}`}>
              <div>
                <strong>
                  {stock ? movementNames[stock.reason] : "Dose"}
                  {deleted ? " / removed" : ""}
                </strong>
                <span>{day}</span>
              </div>
              {record.conflict ? (
                <button type="button" className="text-button" onClick={review}>
                  Review conflict
                </button>
              ) : (
                <p className="stock-change-amount">
                  {quantity > 0 ? "+" : ""}
                  {formatQuantity(quantity)} {balance.item.unit}
                </p>
              )}
              {"note" in value && value.note && <p className="muted">{value.note}</p>}
              {stock && !record.conflict && (
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await daymark.save(
                        "stock",
                        record.key,
                        { ...stock, deleted: !stock.deleted },
                        record.heads.map((op) => op.id),
                      );
                    } catch (error) {
                      setError(message(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {stock.deleted ? "Restore stock change" : "Undo stock change"}
                </button>
              )}
            </article>
          );
        })}
      </div>
      {records.length > limit && (
        <button
          type="button"
          className="secondary"
          onClick={() => setLimit((value) => value + HISTORY_PAGE_SIZE)}
        >
          Show more
        </button>
      )}
    </Sheet>
  );
}
