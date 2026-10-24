import { useState } from "react";
import { message } from "../client/api";
import { ErrorMessage } from "./ui";

export function Login({
  signIn,
  registrationOpen,
  close,
}: {
  signIn: (email: string, password: string, signUp: boolean, name: string) => Promise<void>;
  registrationOpen: boolean;
  close?: () => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signup, setSignup] = useState(false);
  return (
    <section className="login">
      <h1>{signup ? "Create account" : "Sign in"}</h1>
      <p className="muted">
        {registrationOpen
          ? "Your trackers, on every device."
          : "Accounts are created by the administrator."}
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          const form = new FormData(event.currentTarget);
          try {
            await signIn(
              String(form.get("email")),
              String(form.get("password")),
              signup,
              String(form.get("name") || ""),
            );
            close?.();
          } catch (e) {
            setError(message(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {signup && (
          <label>
            Name
            <input name="name" required maxLength={80} autoComplete="name" />
          </label>
        )}
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={signup ? 12 : undefined}
            maxLength={128}
            required
          />
        </label>
        <ErrorMessage text={error} />
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Signing in..." : signup ? "Create account" : "Sign in"}
        </button>
      </form>
      {registrationOpen && (
        <button type="button" className="text-button" onClick={() => setSignup(!signup)}>
          {signup ? "Already have an account? Sign in" : "Create an account"}
        </button>
      )}
      <p className="hint">Forgot your password? Ask the administrator to reset it.</p>
      <a className="owner-link" href="/admin">
        Owner setup and administration
      </a>
    </section>
  );
}
