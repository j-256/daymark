import { useCallback, useEffect, useRef, useState } from "react";
import { heads, type Kind, type Operation, type Value } from "../shared/model";
import { type Account, api } from "./api";
import { LOCAL_WORKSPACE_ID, type LocalChange, openStore, type Store } from "./storage";
import { SyncEngine, type SyncState } from "./sync";

const ACCOUNT_KEY = "daymark-last-account-v1";
const SYNC_INTERVAL = 30000;
const initialSync: SyncState = { status: "idle", pending: 0, message: "", lastSynced: null };
function cachedAccount(): Account | null {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNT_KEY) || "null");
  } catch {
    return null;
  }
}
export function useDaymark() {
  const [account, setAccount] = useState<Account | null>(cachedAccount);
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<Store | null>(null);
  const [snapshot, setSnapshot] = useState<{ accountId: string | null; values: Operation[] }>({
    accountId: null,
    values: [],
  });
  const workspaceId = account?.id ?? LOCAL_WORKSPACE_ID;
  const operations = snapshot.accountId === workspaceId ? snapshot.values : [];
  const [sync, setSync] = useState<SyncState>(initialSync);
  const [online, setOnline] = useState(navigator.onLine);
  const [failure, setFailure] = useState("");
  const engine = useRef<SyncEngine | null>(null);
  const activeAccount = useRef<string | null>(null);
  const sessionRequest = useRef(0);
  activeAccount.current = workspaceId;
  const refresh = useCallback(async (target: Store) => {
    const data = await target.list();
    if (activeAccount.current === target.accountId)
      setSnapshot({ accountId: target.accountId, values: data });
  }, []);
  const fetchSession = useCallback(async () => {
    const version = ++sessionRequest.current;
    const data = await api<{ account: Account; registrationOpen: boolean }>("/api/session");
    if (version !== sessionRequest.current) return data.account;
    try {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(data.account));
    } catch {}
    setAccount(data.account);
    return data.account;
  }, []);
  useEffect(() => {
    if (cachedAccount() && navigator.onLine) void fetchSession().catch(() => {});
    const connectivity = () => setOnline(navigator.onLine);
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    return () => {
      sessionRequest.current++;
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
    };
  }, [fetchSession]);
  useEffect(() => {
    setLoading(true);
    setSync(initialSync);
    let disposed = false;
    let opened: Store | undefined;
    let unsubscribe: (() => void) | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    const run = () => {
      if (navigator.onLine) void engine.current?.run().catch(() => {});
      else setSync((previous) => ({ ...previous, status: "offline" }));
    };
    const connectivity = () => {
      setOnline(navigator.onLine);
      run();
    };
    const focus = () => {
      if (!document.hidden) run();
    };
    void openStore(workspaceId)
      .then(async (value) => {
        if (disposed) {
          value.close();
          return;
        }
        opened = value;
        setStore(value);
        await refresh(value);
        if (disposed) return;
        setLoading(false);
        setFailure("");
        unsubscribe = value.subscribe(() => {
          if (!disposed) void refresh(value);
        });
        if (workspaceId === LOCAL_WORKSPACE_ID) return;
        const instance = new SyncEngine(value);
        instance.onState = (state) => {
          if (!disposed) setSync(state);
        };
        engine.current = instance;
        unsubscribe();
        unsubscribe = value.subscribe(() => {
          if (!disposed) {
            void refresh(value);
            void instance.refreshPending();
          }
        });
        window.addEventListener("online", connectivity);
        window.addEventListener("offline", connectivity);
        window.addEventListener("focus", focus);
        document.addEventListener("visibilitychange", focus);
        timer = setInterval(focus, SYNC_INTERVAL);
        await instance.refreshPending();
        run();
      })
      .catch(() => {
        if (!disposed) {
          setLoading(false);
          setFailure(
            "Browser storage could not be opened. Logging is unavailable until storage is restored.",
          );
        }
      });
    return () => {
      disposed = true;
      unsubscribe?.();
      clearInterval(timer);
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
      engine.current?.stop();
      engine.current = null;
      opened?.close();
    };
  }, [workspaceId, refresh]);
  const readyStore = () => {
    if (
      !store ||
      store.accountId !== workspaceId ||
      snapshot.accountId !== workspaceId ||
      activeAccount.current !== workspaceId
    )
      throw new Error("Browser storage is not ready for this account");
    return store;
  };
  const saveBatch = async (changes: LocalChange[]) => {
    const target = readyStore();
    const edits = await target.writeBatch(changes);
    await refresh(target);
    void engine.current?.refreshPending();
    if (navigator.onLine) void engine.current?.run().catch(() => {});
    return edits;
  };
  const save = async (kind: Kind, key: string, value: Value, parents?: string[]) => {
    const target = readyStore();
    const observed =
      parents ??
      heads(operations.filter((op) => op.kind === kind && op.key === key)).map((op) => op.id);
    const op = await target.write(kind, key, value, observed);
    await refresh(target);
    void engine.current?.refreshPending();
    if (navigator.onLine) void engine.current?.run().catch(() => {});
    return op;
  };
  const signIn = async (email: string, password: string) => {
    const previousWorkspace = activeAccount.current;
    await api("/api/auth/sign-in/email", { email, password });
    const signedIn = await fetchSession();
    setFailure("");
    if (signedIn.id === previousWorkspace && activeAccount.current === signedIn.id)
      void engine.current?.run().catch(() => {});
  };
  const signOut = async () => {
    sessionRequest.current++;
    await api("/api/auth/sign-out", {});
    try {
      localStorage.removeItem(ACCOUNT_KEY);
    } catch {}
    engine.current?.stop();
    setAccount(null);
    setSync(initialSync);
  };
  const matchingStore =
    store?.accountId === workspaceId && snapshot.accountId === workspaceId ? store : null;
  return {
    account,
    loading,
    operations: matchingStore ? operations : [],
    store: matchingStore,
    sync,
    online,
    failure,
    setFailure,
    save,
    saveBatch,
    signIn,
    signOut,
    synchronize: () => engine.current?.run(),
    refresh: () => (matchingStore ? refresh(matchingStore) : Promise.resolve()),
  };
}
export type Daymark = ReturnType<typeof useDaymark>;
