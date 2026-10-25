import { ChevronLeft, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type Account, api, message } from "../client/api";
import type { Daymark } from "../client/useDaymark";
import { Login } from "./Login";
import { ErrorMessage, Sheet } from "./ui";

interface ManagedAccount extends Account {
  banned: number | null;
}
export function Admin({ daymark }: { daymark: Daymark }) {
  const [setup, setSetup] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [creating, setCreating] = useState(false);
  const [reset, setReset] = useState<ManagedAccount | null>(null);
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const data = await api<{ accounts: ManagedAccount[] }>("/api/admin/accounts");
    setAccounts(data.accounts);
  }, []);
  useEffect(() => {
    void api<{ setupRequired: boolean }>("/api/admin/bootstrap")
      .then((data) => setSetup(data.setupRequired))
      .catch((e) => setError(message(e)));
  }, []);
  useEffect(() => {
    if (daymark.account?.role === "admin" && setup === false)
      void load().catch((e) => setError(message(e)));
  }, [daymark.account?.role, setup, load]);
  if (setup === true)
    return (
      <main className="view admin-view">
        <a className="back-link" href="/">
          <ChevronLeft />
          Daymark
        </a>
        <div className="login">
          <ShieldCheck className="intro-icon" />
          <h1>Set up your owner account</h1>
          <p className="muted">Access has verified your identity. Choose a password for Daymark.</p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              const data = new FormData(event.currentTarget);
              try {
                await api("/api/admin/bootstrap", {
                  name: data.get("name"),
                  password: data.get("password"),
                });
                location.reload();
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Name
              <input name="name" autoComplete="name" maxLength={80} required />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <ErrorMessage text={error} />
            <button className="primary" type="submit" disabled={busy}>
              Create owner account
            </button>
          </form>
        </div>
      </main>
    );
  if (setup === null)
    return (
      <main className="view">
        <p className="empty">Checking owner access...</p>
        <ErrorMessage text={error} />
      </main>
    );
  if (daymark.account?.role !== "admin")
    return (
      <main className="view">
        <a className="back-link" href="/">
          <ChevronLeft />
          Daymark
        </a>
        <p className="hint">Sign in with the owner account to manage users.</p>
        <Login signIn={daymark.signIn} />
      </main>
    );
  return (
    <main className="view admin-view">
      <a className="back-link" href="/">
        <ChevronLeft />
        Back to Daymark
      </a>
      <div className="page-title">
        <h1>Accounts</h1>
        <button className="text-button" type="button" onClick={() => setCreating(true)}>
          Create account
        </button>
      </div>
      <p className="hint">
        The app is free to use locally. Create accounts here to invite people to online sync.
      </p>
      <ErrorMessage text={error} />
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {accounts.map((user) => (
        <article className="account-row" key={user.id}>
          <div>
            <strong>{user.name}</strong>
            <span className="item-meta">{user.email}</span>
            <span className="item-meta">
              {user.role === "admin" ? "Owner" : user.banned ? "Inactive" : "Active"}
            </span>
          </div>
          {user.role !== "admin" && (
            <div className="account-actions">
              <button className="secondary compact" type="button" onClick={() => setReset(user)}>
                Reset password
              </button>
              <button
                className="text-button"
                disabled={busy}
                type="button"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    await api("/api/admin/account-status", { id: user.id, active: !!user.banned });
                    await load();
                  } catch (e) {
                    setError(message(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {user.banned ? "Activate" : "Deactivate"}
              </button>
            </div>
          )}
        </article>
      ))}
      {creating && (
        <Sheet title="Create account" close={() => setCreating(false)}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setBusy(true);
              setError("");
              try {
                await api("/api/admin/accounts", {
                  name: data.get("name"),
                  email: data.get("email"),
                  password: data.get("password"),
                });
                await load();
                setCreating(false);
                setNotice("Account created. Share the credentials privately.");
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Name
              <input name="name" autoComplete="off" maxLength={80} required />
            </label>
            <label>
              Email
              <input name="email" type="email" autoComplete="off" required />
            </label>
            <label>
              Initial password
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <p className="hint">No email is sent. The user can change this password in Settings.</p>
            <ErrorMessage text={error} />
            <button className="primary" type="submit" disabled={busy}>
              Create account
            </button>
          </form>
        </Sheet>
      )}
      {reset && (
        <Sheet title={`Reset ${reset.name}'s password`} close={() => setReset(null)}>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              const data = new FormData(event.currentTarget);
              try {
                await api("/api/admin/reset-password", {
                  id: reset.id,
                  password: data.get("password"),
                });
                setReset(null);
                setNotice("Password reset. Existing sessions were signed out.");
              } catch (e) {
                setError(message(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              New password
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
              />
            </label>
            <ErrorMessage text={error} />
            <button type="submit" className="primary" disabled={busy}>
              Reset password
            </button>
          </form>
        </Sheet>
      )}
    </main>
  );
}
