import { useState, type FormEvent } from "react";
import {
  signInPassword,
  createPasswordAccount,
  requestPasswordReset,
} from "@/services/sync/supabase";
export function SignInPanel({ autoFocus = false }: { autoFocus?: boolean }) {
  const [mode, setMode] = useState<"signin" | "signup" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "signin") await signInPassword(email, password);
      else if (mode === "signup") {
        if (!(await createPasswordAccount(email, password)))
          setNotice(
            "Check your email to confirm your account, then sign in with your password.",
          );
      } else {
        await requestPasswordReset(email);
        setNotice(
          "If an account exists for this email, you’ll receive a password reset link. Open it in this browser.",
        );
      }
      setPassword("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Unable to continue. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="signin" onSubmit={submit}>
      <h3>
        {mode === "signup"
          ? "Create an account"
          : mode === "reset"
            ? "Reset your password"
            : "Welcome back"}
      </h3>
      <label className="field">
        <span className="field__label">Email</span>
        <input
          className="input"
          type="email"
          autoComplete="email"
          autoCapitalize="off"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus={autoFocus}
          disabled={busy}
        />
      </label>
      {mode !== "reset" && (
        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="input"
            type="password"
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            required
            minLength={mode === "signup" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          {mode === "signup" && (
            <span className="field__hint">Use at least 8 characters.</span>
          )}
        </label>
      )}
      {error && (
        <p role="alert" className="field__error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button className="btn btn--primary btn--lg btn--block" disabled={busy}>
        {busy
          ? "Please wait…"
          : mode === "signup"
            ? "Create account"
            : mode === "reset"
              ? "Send reset link"
              : "Sign in"}
      </button>
      {(["signin", "signup", "reset"] as const)
        .filter((m) => m !== mode)
        .map((m) => (
          <button
            key={m}
            className="btn btn--ghost"
            type="button"
            disabled={busy}
            onClick={() => {
              setMode(m);
              setPassword("");
              setError("");
              setNotice("");
            }}
          >
            {m === "signin"
              ? "Back to sign in"
              : m === "signup"
                ? "Create an account"
                : "Forgot password / previously used email links?"}
          </button>
        ))}
    </form>
  );
}
