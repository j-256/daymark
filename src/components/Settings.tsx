import { Download, LogOut, ShieldCheck, Upload } from "lucide-react";
import { useState } from "react";
import { api, message } from "../client/api";
import type { Daymark } from "../client/useDaymark";
import { LIMITS } from "../shared/validation";
import { ErrorMessage } from "./ui";

export type Theme = "system" | "light" | "dark";
export function Settings({
  daymark,
  theme,
  setTheme,
  notify,
}: {
  daymark: Daymark;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  notify: (text: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
            disabled={busy}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setError("");
              setBusy(true);
              try {
                if (file.size > LIMITS.backup)
                  throw new Error("Backup exceeds the 20 MB import limit");
                const value = JSON.parse(await file.text());
                const count = await daymark.store?.importBackup(value);
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
        <p className="hint">
          Backups contain your complete activity history. Imports merge into this account without
          replacing other edits.
        </p>
      </section>
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
      <ErrorMessage text={error} />
      <p className="hint">Daymark v1 · AGPL-3.0-only</p>
    </>
  );
}
