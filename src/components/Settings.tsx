import { Download, LogOut, ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";
import { api, message } from "../client/api";
import type { Layout } from "../client/layout";
import type { Daymark } from "../client/useDaymark";
import { LIMITS } from "../shared/validation";
import { ErrorMessage } from "./ui";

export type Theme = "system" | "light" | "dark";
export function Settings({
  daymark,
  theme,
  setTheme,
  layout,
  setLayout,
  notify,
  signIn,
}: {
  daymark: Daymark;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  layout: Layout;
  setLayout: (layout: Layout) => void;
  notify: (text: string) => void;
  signIn: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowDifferentWorkspace, setAllowDifferentWorkspace] = useState(false);
  return (
    <>
      <div className="page-title">
        <h1>Settings</h1>
      </div>
      <section className="settings-section">
        <h2>Appearance</h2>
        <label>
          Appearance
          <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
            <option value="system">System preference</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Layout
          <select value={layout} onChange={(event) => setLayout(event.target.value as Layout)}>
            <option value="auto">Automatic</option>
            <option value="compact">Compact</option>
            <option value="wide">Wide</option>
          </select>
        </label>
        <p className="hint">
          Automatic follows your window. Compact keeps a phone layout; Wide uses desktop spacing and
          can scroll horizontally. Saved on this device.
        </p>
      </section>
      <section className="settings-section">
        <h2>Your data</h2>
        <button
          className="list-action"
          type="button"
          disabled={!daymark.store}
          onClick={async () => {
            try {
              const backup = await daymark.store?.backup();
              if (!backup) return;
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(backup)], { type: "application/json" }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = `daymark-${new Date().toISOString().slice(0, 10)}.json`;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              notify("Backup exported");
            } catch (e) {
              setError(message(e));
            }
          }}
        >
          <Download />
          Export backup
        </button>
        <label className="list-action upload-label">
          <Upload />
          Import backup
          <input
            type="file"
            accept="application/json,.json"
            disabled={busy || !daymark.store}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setError("");
              setBusy(true);
              try {
                if (file.size > LIMITS.backup)
                  throw new Error("Backup exceeds the 20 MB import limit");
                const value = JSON.parse(await file.text());
                const count = await daymark.store?.importBackup(value, { allowDifferentWorkspace });
                await daymark.refresh();
                void daymark.synchronize()?.catch(() => {});
                notify(`${count ?? 0} edits imported`);
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
                event.target.value = "";
              }
            }}
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            checked={allowDifferentWorkspace}
            onChange={(event) => setAllowDifferentWorkspace(event.target.checked)}
          />
          Import from another workspace
        </label>
        <p className="hint">
          Backups contain trackers, inventory, and complete activity history. Imports merge without
          replacing edits.{" "}
          {daymark.account
            ? "Imported history will sync to this account."
            : "Data stays on this device. Export backups before clearing browser data."}
        </p>
      </section>
      {!daymark.account ? (
        <section className="settings-section">
          <h2>Local workspace</h2>
          <p>Free to use without an account. Your history stays in this browser.</p>
          <p className="hint">
            Sync accounts are invite-only. Signing in opens a separate workspace and does not upload
            your local history. Use a backup to transfer it when you choose.
          </p>
          <button type="button" className="secondary" disabled={!daymark.online} onClick={signIn}>
            Sign in for sync
          </button>
        </section>
      ) : (
        <section className="settings-section">
          <h2>Account</h2>
          <p>
            {daymark.account?.name}
            <br />
            <span className="muted">{daymark.account?.email}</span>
          </p>
          <details>
            <summary>Change password</summary>
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                setBusy(true);
                setError("");
                try {
                  await api("/api/auth/change-password", {
                    currentPassword: data.get("current"),
                    newPassword: data.get("password"),
                    revokeOtherSessions: true,
                  });
                  form.reset();
                  notify("Password updated. Other sessions were signed out.");
                } catch (e) {
                  setError(message(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label>
                Current password
                <input type="password" name="current" autoComplete="current-password" required />
              </label>
              <label>
                New password
                <input
                  type="password"
                  name="password"
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </label>
              <button type="submit" className="secondary" disabled={busy || !daymark.online}>
                Update password
              </button>
            </form>
          </details>
          {daymark.account?.role === "admin" && (
            <a className="list-action" href="/admin">
              <ShieldCheck />
              Manage accounts
            </a>
          )}
          <button
            type="button"
            className="list-action"
            disabled={busy || !daymark.online}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await daymark.signOut();
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut />
            Sign out
          </button>
          <p className="hint">
            {daymark.sync.pending
              ? `${daymark.sync.pending} changes are waiting to sync. They stay on this browser after sign-out.`
              : "Local history stays on this browser after sign-out."}
            {!daymark.online ? " Connect to sign out." : ""}
          </p>
        </section>
      )}
      <ErrorMessage text={error} />
      <p className="hint">Daymark v1 · AGPL-3.0-only</p>
    </>
  );
}
