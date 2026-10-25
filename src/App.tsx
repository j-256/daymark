import {
  CalendarDays,
  ChartNoAxesCombined,
  CloudCheck,
  CloudOff,
  LayoutGrid,
  ListChecks,
  Package,
  Plus,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { message } from "./client/api";
import { applyAppearance, preference, THEME_KEY } from "./client/appearance";
import { consumptionFor, stockBalances } from "./client/inventory";
import { applyLayout, LAYOUT_KEY, type Layout, layoutPreference } from "./client/layout";
import { type MoveDirection, reorderChanges } from "./client/ordering";
import { useDaymark } from "./client/useDaymark";
import { Admin } from "./components/Admin";
import { Conflicts } from "./components/Conflicts";
import { EntryForm, type EntrySelection } from "./components/EntryForm";
import { HistoryDetails } from "./components/HistoryDetails";
import { Inventory } from "./components/Inventory";
import { Login } from "./components/Login";
import { Patterns } from "./components/Patterns";
import { QuickSettings } from "./components/QuickSettings";
import { Settings, type Theme } from "./components/Settings";
import { TrackerForm, type TrackerItem } from "./components/TrackerForm";
import { ErrorMessage, Sheet } from "./components/ui";
import {
  entryRecord,
  selectionFor,
  statusFor,
  Today,
  type TrackerRow,
  Trackers,
  Weeks,
} from "./components/Views";
import { type Entry, entryKey, localDay, materialize, type Tracker } from "./shared/model";

type Tab = "today" | "weeks" | "patterns" | "trackers" | "inventory" | "settings";
interface Toast {
  text: string;
  undo?: () => Promise<void>;
}
export function App() {
  const daymark = useDaymark();
  const [tab, setTab] = useState<Tab>("today");
  const [theme, setTheme] = useState<Theme>(preference);
  const [layout, setLayout] = useState<Layout>(layoutPreference);
  const [trackerEdit, setTrackerEdit] = useState<TrackerItem | "new" | null>(null);
  const [entryEdit, setEntryEdit] = useState<EntrySelection | null>(null);
  const [history, setHistory] = useState<{ trackerId: string; day: string } | null>(null);
  const [review, setReview] = useState(false);
  const [syncDetails, setSyncDetails] = useState(false);
  const [extraPicker, setExtraPicker] = useState(false);
  const [login, setLogin] = useState(false);
  const [archived, setArchived] = useState(false);
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState("");
  const [orderingBusy, setOrderingBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const records = useMemo(() => materialize(daymark.operations), [daymark.operations]);
  const balances = useMemo(() => stockBalances(daymark.operations), [daymark.operations]);
  const lowStock = [...balances.values()].filter(
    (balance) =>
      !balance.item.archived && !balance.uncertain && balance.quantity <= balance.item.lowStock,
  );
  const conflicts = [...records.values()].filter((record) => record.conflict);
  const allTrackers: TrackerItem[] = [...records.values()]
    .filter((record) => record.kind === "tracker" && record.value)
    .map((record) => ({
      id: record.key,
      value: record.value as Tracker,
      parents: record.heads.map((op) => op.id),
    }))
    .sort((a, b) => a.value.order - b.value.order || a.value.name.localeCompare(b.value.name));
  const activeTrackers = allTrackers.filter((item) => !item.value.archived);
  const visibleTrackers = activeTrackers.filter(
    (item) => !category || item.value.category === category,
  );
  const rows: TrackerRow[] = visibleTrackers.flatMap((item) =>
    item.value.slots.map((slot) => ({ trackerId: item.id, tracker: item.value, slot })),
  );
  const historyRows: TrackerRow[] = [...rows];
  for (const item of visibleTrackers) {
    const activeIds = new Set(item.value.slots.map((slot) => slot.id));
    const retired = new Set<string>();
    for (const record of records.values())
      if (record.kind === "entry" && record.key.startsWith(`${item.id}/`)) {
        const slotId = record.key.split("/")[2];
        if (!activeIds.has(slotId)) retired.add(slotId);
      }
    for (const id of retired) {
      const old = daymark.operations
        .filter((op) => op.kind === "tracker" && op.key === item.id)
        .flatMap((op) => (op.value as Tracker).slots)
        .find((slot) => slot.id === id);
      historyRows.push({
        trackerId: item.id,
        tracker: item.value,
        slot: old ?? { id, name: "Retired", time: "" },
        retired: true,
      });
    }
  }
  const trackersById = new Map(allTrackers.map((item) => [item.id, item.value]));
  useLayoutEffect(() => {
    const update = () => applyLayout(layout);
    update();
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {}
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [layout]);
  useEffect(() => {
    applyAppearance(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
    const media = matchMedia("(prefers-color-scheme: dark)");
    const change = () => applyAppearance(theme);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, [theme]);
  useEffect(() => {
    if (!daymark.account?.id && daymark.loading) return;
    setTrackerEdit(null);
    setEntryEdit(null);
    setHistory(null);
    setReview(false);
    setSyncDetails(false);
    setExtraPicker(false);
    setLogin(false);
    setToast(null);
    setCategory("");
    setTab(location.hash === "#settings" ? "settings" : "today");
    if (!daymark.loading && location.hash === "#settings")
      window.history.replaceState(null, "", location.pathname + location.search);
  }, [daymark.account?.id, daymark.loading]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = (text: string) => setToast({ text });
  const mark = async (row: TrackerRow, day: string, cycle: boolean) => {
    const key = entryKey(row.trackerId, day, row.slot.id);
    if (busy === key) return;
    const state = statusFor(records, row, day);
    if (state === "conflict") {
      setReview(true);
      return;
    }
    const previous = (entryRecord(records, row, day)?.value as Entry | null) ?? {
      state: "unknown" as const,
      note: "",
      occurredAt: null,
    };
    const next = cycle
      ? state === "unknown"
        ? "confirmed"
        : state === "confirmed"
          ? "skipped"
          : "unknown"
      : state === "confirmed"
        ? "unknown"
        : "confirmed";
    const inventory = consumptionFor(row.tracker, previous, next === "confirmed");
    setBusy(key);
    try {
      const op = await daymark.save(
        "entry",
        key,
        {
          state: next,
          ...(inventory ? { inventory } : {}),
          note: previous.note,
          occurredAt: next === "confirmed" && day === localDay() ? new Date().toISOString() : null,
        },
        entryRecord(records, row, day)?.heads.map((head) => head.id) ?? [],
      );
      setToast({
        text: `${row.tracker.name}: ${next}`,
        undo: async () => {
          await daymark.save("entry", key, previous, [op.id]);
          setToast(null);
        },
      });
    } catch (e) {
      notify(`Not saved: ${message(e)}`);
    } finally {
      setBusy("");
    }
  };
  const editEntry = (value: EntrySelection) => {
    if (value.extra) setExtraPicker(true);
    else setEntryEdit(value);
  };
  const updateTracker = async (item: TrackerItem, patch: Partial<Tracker>) => {
    try {
      await daymark.save("tracker", item.id, { ...item.value, ...patch }, item.parents);
      notify(patch.archived ? "Tracker archived. History is preserved." : "Tracker updated");
    } catch (e) {
      notify(message(e));
    }
  };
  const moveTracker = async (id: string, direction: MoveDirection) => {
    if (orderingBusy) return;
    const changes = reorderChanges(
      allTrackers.filter((item) => item.value.archived === archived),
      id,
      direction,
    );
    if (!changes.length) return;
    const name = allTrackers.find((item) => item.id === id)?.value.name ?? "Tracker";
    setOrderingBusy(true);
    try {
      await daymark.saveBatch(changes);
      notify(`${name} moved ${direction}`);
    } catch (error) {
      notify(`Order not saved: ${message(error)}`);
    } finally {
      setOrderingBusy(false);
    }
  };
  const syncLabel = !daymark.online
    ? `Offline${daymark.sync.pending ? ` / ${daymark.sync.pending}` : ""}`
    : daymark.sync.status === "synced"
      ? "Synced"
      : daymark.sync.status === "auth"
        ? "Sign in"
        : daymark.sync.status === "error"
          ? "Sync issue"
          : "Syncing";
  const common = { rows, records, busy, mark, edit: editEntry, review: () => setReview(true) };
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Daymark home">
          <LayoutGrid />
          Daymark
        </a>
        {daymark.account && (
          <button
            type="button"
            className={`sync-chip${daymark.sync.status === "error" || daymark.sync.status === "auth" ? " attention" : ""}`}
            data-testid="sync-status"
            onClick={() => setSyncDetails(true)}
          >
            {!daymark.online ? (
              <CloudOff />
            ) : daymark.sync.status === "synced" ? (
              <CloudCheck />
            ) : (
              <RefreshCw className={daymark.sync.status === "syncing" ? "spin" : ""} />
            )}
            <span>{syncLabel}</span>
          </button>
        )}
        {daymark.account && (
          <button
            className="icon-button"
            type="button"
            aria-label="Add tracker"
            onClick={() => setTrackerEdit("new")}
          >
            <Plus />
          </button>
        )}
        <QuickSettings
          theme={theme}
          setTheme={setTheme}
          layout={layout}
          setLayout={setLayout}
          canSync={Boolean(daymark.store && daymark.online)}
          syncing={daymark.sync.status === "syncing"}
          sync={() => void daymark.synchronize()?.catch((error) => notify(message(error)))}
          canOpenSettings={Boolean(daymark.account)}
          allSettings={() => {
            if (location.pathname === "/admin" || location.pathname.startsWith("/admin/"))
              location.assign("/#settings");
            else setTab("settings");
          }}
        />
      </header>
      {location.pathname === "/admin" || location.pathname.startsWith("/admin/") ? (
        <Admin daymark={daymark} />
      ) : daymark.loading && !daymark.account ? (
        <main className="view">
          <p className="empty">Opening Daymark...</p>
        </main>
      ) : !daymark.account ? (
        <main className="view">
          <Login signIn={daymark.signIn} registrationOpen={daymark.registrationOpen} />
        </main>
      ) : !daymark.store ? (
        <main className="view">
          <p className="empty">Opening your local history...</p>
          <ErrorMessage text={daymark.failure} />
        </main>
      ) : (
        <>
          <main className="view" id={tab} key={tab}>
            <div className="view-content">
              <ErrorMessage text={daymark.failure} />
              {conflicts.length > 0 && (
                <button
                  className="conflict-banner"
                  type="button"
                  aria-label={`Review ${conflicts.length} conflicting edits`}
                  onClick={() => setReview(true)}
                >
                  <TriangleAlert />
                  <span>
                    {conflicts.length} conflicting edit{conflicts.length === 1 ? "" : "s"} to review
                  </span>
                </button>
              )}
              {tab !== "settings" &&
                tab !== "trackers" &&
                tab !== "inventory" &&
                activeTrackers.length > 1 && (
                  <div className="filter-row">
                    <select
                      aria-label="Filter category"
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                    >
                      <option value="">All categories</option>
                      {[...new Set(activeTrackers.map((item) => item.value.category))].map(
                        (value) => (
                          <option value={value} key={value}>
                            {value || "Personal"}
                          </option>
                        ),
                      )}
                    </select>
                  </div>
                )}
              {tab === "today" && lowStock.length > 0 && (
                <button type="button" className="stock-notice" onClick={() => setTab("inventory")}>
                  {lowStock.length} medication{lowStock.length === 1 ? "" : "s"} low on stock
                </button>
              )}
              {tab === "inventory" && (
                <Inventory daymark={daymark} notify={notify} review={() => setReview(true)} />
              )}
              {tab === "today" && <Today {...common} add={() => setTrackerEdit("new")} />}
              {tab === "weeks" && (
                <Weeks
                  {...common}
                  rows={historyRows}
                  details={(row, day) => setHistory({ trackerId: row.trackerId, day })}
                />
              )}
              {tab === "patterns" && (
                <Patterns items={visibleTrackers} rows={historyRows} records={records} />
              )}
              {tab === "trackers" && (
                <>
                  <Trackers
                    items={allTrackers.filter((item) => item.value.archived === archived)}
                    archived={archived}
                    add={() => setTrackerEdit("new")}
                    edit={setTrackerEdit}
                    update={updateTracker}
                    move={moveTracker}
                    moving={orderingBusy}
                  />
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={archived}
                      onChange={(event) => setArchived(event.target.checked)}
                    />
                    Show archived trackers
                  </label>
                </>
              )}
              {tab === "settings" && (
                <Settings
                  daymark={daymark}
                  theme={theme}
                  setTheme={setTheme}
                  layout={layout}
                  setLayout={setLayout}
                  notify={notify}
                />
              )}
            </div>
          </main>
          <nav className="tabs" aria-label="Main navigation">
            {(
              [
                { id: "today", label: "Today", icon: ListChecks },
                { id: "weeks", label: "Weeks", icon: CalendarDays },
                { id: "patterns", label: "Patterns", icon: ChartNoAxesCombined },
                { id: "inventory", label: "Inventory", icon: Package },
                { id: "trackers", label: "Trackers", icon: LayoutGrid },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                aria-current={tab === item.id ? "page" : undefined}
                onClick={() => setTab(item.id)}
              >
                <item.icon />
                {item.label}
              </button>
            ))}
          </nav>
        </>
      )}
      {toast && daymark.account && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => void toast.undo?.().catch((e) => notify(message(e)))}
            >
              Undo
            </button>
          )}
        </div>
      )}
      {trackerEdit && (
        <TrackerForm
          daymark={daymark}
          item={trackerEdit === "new" ? undefined : trackerEdit}
          close={() => setTrackerEdit(null)}
          notify={notify}
        />
      )}
      {history && !entryEdit && !review && (
        <HistoryDetails
          trackerId={history.trackerId}
          rows={historyRows.filter((row) => row.trackerId === history.trackerId)}
          records={records}
          day={history.day}
          selectDay={(day) => setHistory({ ...history, day })}
          edit={setEntryEdit}
          review={() => setReview(true)}
          close={() => setHistory(null)}
        />
      )}
      {entryEdit && (
        <EntryForm
          daymark={daymark}
          selection={entryEdit}
          close={() => setEntryEdit(null)}
          notify={notify}
        />
      )}
      {review && (
        <Conflicts
          daymark={daymark}
          records={conflicts}
          trackers={trackersById}
          close={() => setReview(false)}
          notify={notify}
        />
      )}
      {extraPicker && (
        <Sheet title="Log another occurrence" close={() => setExtraPicker(false)}>
          {activeTrackers.map((item) => (
            <button
              className="list-action"
              key={item.id}
              type="button"
              onClick={() => {
                setExtraPicker(false);
                setEntryEdit({
                  ...selectionFor(
                    records,
                    { trackerId: item.id, tracker: item.value, slot: item.value.slots[0] },
                    localDay(),
                  ),
                  extra: true,
                  value: { state: "confirmed", note: "", occurredAt: new Date().toISOString() },
                });
              }}
            >
              {item.value.name}
            </button>
          ))}
        </Sheet>
      )}
      {syncDetails && (
        <Sheet title="Sync status" close={() => setSyncDetails(false)}>
          <p>
            {daymark.online
              ? daymark.sync.status === "synced"
                ? "All local edits have reached the server."
                : "Your edits are saved on this browser."
              : "You're offline. Keep logging; edits will sync when connected."}
          </p>
          <p className="muted">
            {daymark.sync.pending} pending edit{daymark.sync.pending === 1 ? "" : "s"}
          </p>
          {daymark.sync.message && <p className="notice">{daymark.sync.message}</p>}
          {daymark.sync.lastSynced && (
            <p className="hint">
              Last synced {new Date(daymark.sync.lastSynced).toLocaleTimeString()}
            </p>
          )}
          {daymark.sync.status === "auth" ? (
            <>
              <button
                className="primary"
                type="button"
                onClick={() => {
                  setSyncDetails(false);
                  setLogin(true);
                }}
              >
                Sign in to Daymark
              </button>
              <a className="list-action" href="/?access-login=1">
                Refresh Access sign-in
              </a>
            </>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!daymark.online}
              onClick={() => void daymark.synchronize()?.catch(() => {})}
            >
              Sync now
            </button>
          )}
        </Sheet>
      )}
      {login && (
        <Sheet title="Resume syncing" close={() => setLogin(false)}>
          <Login signIn={daymark.signIn} registrationOpen={false} close={() => setLogin(false)} />
        </Sheet>
      )}
    </div>
  );
}
