import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { updatePassword } from "@/services/sync/supabase";
import { useCloudSync } from "@/services/sync/controller";
import "./account.css";
export default function PasswordPage() {
  const sync = useCloudSync();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await updatePassword(password);
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update password.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings">
      <h1 className="page-title">Set your password</h1>
      <section className="card account-card">
        {sync.phase === "loading" ? (
          <p>Checking your session…</p>
        ) : sync.phase !== "signed-in" ? (
          <>
            <p>
              Open a fresh reset link in the browser where you requested it, or
              sign in first.
            </p>
            <Link to="/account" className="btn">
              Go to account
            </Link>
          </>
        ) : done ? (
          <>
            <p role="status">Password updated. Use it next time you sign in.</p>
            <Link to="/account" className="btn">
              Back to account
            </Link>
          </>
        ) : (
          <form className="signin" onSubmit={submit}>
            <p>Your existing flights and account stay with you.</p>
            <label className="field">
              New password
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label className="field">
              Confirm password
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="field__error">
                {error}
              </p>
            )}
            <button className="btn btn--primary" disabled={busy}>
              {busy ? "Saving…" : "Save password"}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
