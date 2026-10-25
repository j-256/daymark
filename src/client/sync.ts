import { type Operation, SYNC_PROTOCOL, SYNC_PROTOCOL_HEADER } from "../shared/model";
import { LIMITS } from "../shared/validation";
import type { RemoteOperation, Store } from "./storage";

export type SyncStatus = "idle" | "syncing" | "synced" | "offline" | "error" | "auth";
export interface SyncState {
  status: SyncStatus;
  pending: number;
  message: string;
  lastSynced: number | null;
}
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
class SyncFailure extends Error {
  constructor(
    message: string,
    readonly auth = false,
  ) {
    super(message);
  }
}
const MAX_PAGES = 100;
const MAX_UPLOADS = 100;
const MAX_BATCH_BYTES = LIMITS.body - 1024;
export class SyncEngine {
  state: SyncState = { status: "idle", pending: 0, message: "", lastSynced: null };
  onState?: (state: SyncState) => void;
  private current?: Promise<void>;
  private requested = false;
  private abort = new AbortController();
  constructor(
    private store: Store,
    private fetcher: Fetch = (input, init) => fetch(input, init),
  ) {}
  private set(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    this.onState?.(this.state);
  }
  async refreshPending(): Promise<void> {
    this.set({ pending: (await this.store.pending()).length });
  }
  private async request(path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await this.fetcher(path, {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      redirect: "manual",
      signal: this.abort.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Daymark-Account": this.store.accountId,
        [SYNC_PROTOCOL_HEADER]: SYNC_PROTOCOL,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (
      [0, 301, 302, 303, 307, 308, 401, 403].includes(response.status) ||
      !response.headers.get("content-type")?.includes("application/json")
    )
      throw new SyncFailure("Sign in to resume syncing. Your local changes are saved.", true);
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new SyncFailure(
        typeof data.message === "string" ? data.message : "Sync failed. Local changes are saved.",
        data.error === "account_changed",
      );
    return data;
  }
  run(): Promise<void> {
    if (this.current) {
      this.requested = true;
      return this.current;
    }
    this.current = (async () => {
      do {
        this.requested = false;
        await this.perform();
      } while (this.requested && !this.abort.signal.aborted);
    })().finally(() => {
      this.current = undefined;
    });
    return this.current;
  }
  private async perform(): Promise<void> {
    if (this.abort.signal.aborted) return;
    this.set({ status: "syncing", message: "" });
    try {
      let remaining = false;
      for (let index = 0; index < MAX_UPLOADS; index++) {
        const pending = await this.store.pending();
        if (!pending.length) break;
        const batch: Operation[] = [];
        for (const op of pending.slice(0, LIMITS.batch)) {
          const trial = [...batch, op];
          if (
            new TextEncoder().encode(JSON.stringify({ operations: trial })).length > MAX_BATCH_BYTES
          )
            break;
          batch.push(op);
        }
        if (!batch.length)
          throw new SyncFailure(
            "A local edit exceeds the upload limit. Export a backup before changing it.",
          );
        const result = await this.request("/api/sync", { operations: batch });
        const expected = new Set(batch.map((op) => op.id));
        if (
          !Array.isArray(result.acknowledged) ||
          !result.acknowledged.length ||
          result.acknowledged.some((id) => typeof id !== "string" || !expected.has(id))
        )
          throw new SyncFailure(
            "The server returned an invalid acknowledgement. Local changes are preserved.",
          );
        await this.store.acknowledge(result.acknowledged as string[]);
        await this.refreshPending();
        if (index === MAX_UPLOADS - 1) remaining = true;
      }
      for (let page = 0; page < MAX_PAGES; page++) {
        const before = await this.store.cursor();
        const data = await this.request(`/api/sync?cursor=${before}`);
        if (
          !Array.isArray(data.operations) ||
          typeof data.cursor !== "number" ||
          typeof data.hasMore !== "boolean" ||
          data.cursor < before ||
          (data.hasMore && (data.cursor === before || !data.operations.length))
        )
          throw new SyncFailure("The server returned an invalid sync page");
        await this.store.mergeRemote(data.operations as RemoteOperation[], data.cursor);
        if (!data.hasMore) break;
        if (page === MAX_PAGES - 1) remaining = true;
      }
      const pending = (await this.store.pending()).length;
      this.set({
        status: remaining || pending ? "syncing" : "synced",
        pending,
        lastSynced: Date.now(),
      });
    } catch (error) {
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      this.set({
        status: error instanceof SyncFailure && error.auth ? "auth" : offline ? "offline" : "error",
        pending: (await this.store.pending()).length,
        message: error instanceof Error ? error.message : "Sync failed. Local changes are saved.",
      });
      throw error;
    }
  }
  stop(): void {
    this.abort.abort();
  }
}
