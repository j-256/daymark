import { useEffect, useRef, useState } from "react";
import { LIMITS } from "../shared/validation";
import { message } from "./api";
import { backupDownload } from "./backup";
import { backupReminder, type Protection, storageProtection } from "./recovery";
import type { Recovery, Store } from "./storage";
import type { Daymark } from "./useDaymark";

const REFRESH_INTERVAL = 60000;
const DOWNLOAD_RELEASE_DELAY = 60000;
export function useRecovery(daymark: Daymark, notify: (text: string) => void) {
  const target = daymark.store;
  const active = useRef(target);
  const mounted = useRef(true);
  active.current = target;
  const [checkpoint, setCheckpoint] = useState<{ target: Store; value: Recovery } | null>(null);
  const [protection, setProtection] = useState<Protection | "checking">("checking");
  const [protectionRequested, setProtectionRequested] = useState(false);
  const [action, setAction] = useState<{ target: Store; busy: boolean; error: string } | null>(
    null,
  );
  const [rescue, setRescue] = useState<{ target: Store; text: string } | null>(null);
  const [now, setNow] = useState(Date.now);
  const current = (store: Store) => mounted.current && active.current === store;

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    void storageProtection(navigator.storage).then((value) => {
      if (!disposed) setProtection(value);
    });
    return () => {
      disposed = true;
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!target) return;
    let disposed = false;
    let version = 0;
    const refresh = () => {
      const request = ++version;
      void target.recovery().then((value) => {
        if (!disposed && version === request) setCheckpoint({ target, value });
      });
    };
    refresh();
    const unsubscribe = target.subscribe(refresh);
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, REFRESH_INTERVAL);
    window.addEventListener("focus", tick);
    return () => {
      disposed = true;
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("focus", tick);
    };
  }, [target]);

  async function perform(work: (store: Store) => Promise<void>) {
    if (!target || (action?.target === target && action.busy)) return;
    setAction({ target, busy: true, error: "" });
    try {
      await work(target);
    } catch (error) {
      if (current(target)) setAction({ target, busy: false, error: message(error) });
      return;
    }
    if (current(target)) setAction({ target, busy: false, error: "" });
  }

  function download(text: string, raw = false) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `daymark-${raw ? "raw-history-" : ""}${new Date().toISOString().replaceAll(":", "-")}.json`;
    document.body.appendChild(link);
    try {
      link.click();
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_RELEASE_DELAY);
    }
    notify(
      raw
        ? "Raw history download requested"
        : "Download requested. Open the saved file with Check backup.",
    );
  }

  async function read(file: File) {
    if (file.size > LIMITS.backup) throw new Error("Backup exceeds the 20 MB import limit");
    return JSON.parse(await file.text()) as unknown;
  }
  const recovery = checkpoint?.target === target ? checkpoint.value : null;
  return {
    recovery,
    count: daymark.operations.length,
    protection,
    protectionRequested,
    busy: !target || (action?.target === target && action.busy),
    error: action?.target === target ? action.error : "",
    reminder: Boolean(recovery && backupReminder(recovery, daymark.operations.length, now)),
    hasRescue: rescue?.target === target,
    protect: () =>
      perform(async (store) => {
        const value = await storageProtection(navigator.storage, true);
        if (current(store)) {
          setProtection(value);
          setProtectionRequested(true);
        }
      }),
    exportBackup: () =>
      perform(async (store) => {
        setRescue(null);
        const prepared = backupDownload(await store.backup());
        if (!current(store)) return;
        if (!prepared.restorable) {
          setRescue({ target: store, text: prepared.text });
          throw new Error(
            "History exceeds normal restore limits. Download raw history to preserve it for assisted recovery.",
          );
        }
        download(prepared.text);
      }),
    downloadRescue: () => {
      if (rescue && current(rescue.target)) download(rescue.text, true);
    },
    check: (file: File) =>
      perform(async (store) => {
        const input = await read(file);
        if (!current(store)) return;
        const checked = await store.checkBackup(input);
        if (!current(store)) return;
        notify(
          checked.missing
            ? `Backup valid; ${checked.missing} ${checked.missing === 1 ? "change missing" : "changes missing"}. Export a new copy.`
            : checked.recorded
              ? "Backup checked. All changes included."
              : checked.total
                ? "Backup checked, but reminder status could not be saved."
                : "Backup valid. This workspace has no history to check.",
        );
      }),
    importBackup: (file: File, allowDifferentWorkspace: boolean) =>
      perform(async (store) => {
        const input = await read(file);
        if (!current(store)) return;
        const count = await store.importBackup(input, { allowDifferentWorkspace });
        if (!current(store)) return;
        await daymark.refresh();
        if (!current(store)) return;
        void daymark.synchronize()?.catch(() => {});
        notify(`${count} edits imported`);
      }),
    postpone: () =>
      perform(async (store) => {
        await store.postponeBackup();
        if (current(store)) setNow(Date.now());
      }),
  };
}
export type RecoveryControls = ReturnType<typeof useRecovery>;
