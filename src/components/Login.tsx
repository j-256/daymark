import { useState } from "react";
import { message } from "../client/api";
import { ErrorMessage } from "./ui";

export function Login({
  signIn,
  close,
}: {
  signIn: (email: string, password: string) => Promise<void>;
  close?: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="login">
      <h1>Sign in</h1>
      <p className="muted">
        Sync accounts are invite-only. Use the local workspace for free without an account.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const form = new FormData(event.currentTarget);
          try {
            await signIn(String(form.get("email")), String(form.get("password")));
            close?.();
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            maxLength={128}
            required
          />
        </label>
        <ErrorMessage text={error} />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
      <p className="hint">Forgot your password? Ask the administrator to reset it.</p>
      <a className="owner-link" href="/admin">
        Owner setup and administration
      </a>
    </section>
  );
}
