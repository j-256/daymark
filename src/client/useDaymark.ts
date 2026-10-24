import { useCallback, useEffect, useRef, useState } from "react";
import { heads, type Kind, type Operation, type Value } from "../shared/model";
import { type Account, api } from "./api";
import { openStore, type Store } from "./storage";
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
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<Store | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [sync, setSync] = useState<SyncState>(initialSync);
  const [online, setOnline] = useState(navigator.onLine);
  const [failure, setFailure] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const engine = useRef<SyncEngine | null>(null);
  const activeAccount = useRef<string | null>(null);
  activeAccount.current = account?.id ?? null;
  const refresh = useCallback(async (target: Store) => {
    const data = await target.list();
    if (activeAccount.current === target.accountId) setOperations(data);
  }, []);
  const fetchSession = useCallback(async () => {
    const data = await api<{ account: Account; registrationOpen: boolean }>("/api/session");
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(data.account));
    setAccount(data.account);
    setRegistrationOpen(data.registrationOpen);
    return data.account;
  }, []);
  useEffect(() => {
    let active = true;
    const cached = cachedAccount();
    if (cached) setAccount(cached);
    Promise.allSettled([
      fetchSession(),
      api<{ registrationOpen: boolean }>("/api/config").then((data) => {
        if (active) setRegistrationOpen(data.registrationOpen);
      }),
    ]).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [fetchSession]);
  useEffect(() => {
    if (!account) {
      setStore(null);
      setOperations([]);
      return;
    }
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
    void openStore(account.id)
      .then(async (value) => {
        if (disposed) {
          value.close();
          return;
        }
        opened = value;
        setStore(value);
        await refresh(value);
        const instance = new SyncEngine(value);
        instance.onState = (state) => {
          if (!disposed) setSync(state);
        };
        engine.current = instance;
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
        if (!disposed)
          setFailure(
            "Browser storage could not be opened. Logging is unavailable until storage is restored.",
          );
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
  }, [account?.id, account, refresh]);
  const save = async (kind: Kind, key: string, value: Value, parents?: string[]) => {
    if (!store) throw new Error("Browser storage is not ready");
    const observed =
      parents ??
      heads(operations.filter((op) => op.kind === kind && op.key === key)).map((op) => op.id);
    const op = await store.write(kind, key, value, observed);
    await refresh(store);
    void engine.current?.refreshPending();
    if (navigator.onLine) void engine.current?.run().catch(() => {});
    return op;
  };
  const signIn = async (email: string, password: string, signUp = false, name = "") => {
    await api(`/api/auth/${signUp ? "sign-up/email" : "sign-in/email"}`, {
      email,
      password,
      ...(signUp ? { name } : {}),
    });
    await fetchSession();
    setFailure("");
    void engine.current?.run().catch(() => {});
  };
  const signOut = async () => {
    await api("/api/auth/sign-out", {});
    localStorage.removeItem(ACCOUNT_KEY);
    engine.current?.stop();
    setAccount(null);
    setSync(initialSync);
  };
  const matchingStore = store?.accountId === account?.id ? store : null;
  return {
    account,
    loading,
    operations: matchingStore ? operations : [],
    store: matchingStore,
    sync,
    online,
    failure,
    setFailure,
    registrationOpen,
    save,
    signIn,
    signOut,
    synchronize: () => engine.current?.run(),
    refresh: () => (store ? refresh(store) : Promise.resolve()),
  };
}
export type Daymark = ReturnType<typeof useDaymark>;
