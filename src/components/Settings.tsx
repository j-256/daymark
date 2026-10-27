import { LogOut, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api, message } from "../client/api";
import type { Layout } from "../client/layout";
import type { Daymark } from "../client/useDaymark";
import type { RecoveryControls } from "../client/useRecovery";
import { RecoverySettings } from "./Recovery";
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
  recovery,
}: {
  daymark: Daymark;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  layout: Layout;
  setLayout: (layout: Layout) => void;
  notify: (text: string) => void;
  signIn: () => void;
  recovery: RecoveryControls;
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
      <RecoverySettings key={daymark.store?.accountId} controls={recovery} />
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
