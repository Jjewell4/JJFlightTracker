import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { sendSignInEmail, verifySignInCode } from '@/services/sync/supabase';

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/rate limit|too many|security purposes/i.test(msg)) return 'Too many emails requested. Wait a minute, then try again.';
  if (/expired|invalid/i.test(msg)) return 'That code is invalid or has expired. Send a new link.';
  if (/signups not allowed|signup.*disabled/i.test(msg)) return 'New accounts are turned off for this app. Use the email you signed up with.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'You seem to be offline. Connect and try again.';
  return msg;
}

const RESEND_SECONDS = 30;

/**
 * Passwordless sign-in: email → "check your inbox" (magic link). Signing in completes when
 * the link is opened — the app picks the session up automatically, even in this tab.
 * A 6-digit code entry is tucked away for email templates that include one.
 */
export function SignInPanel({ autoFocus = false }: { autoFocus?: boolean }) {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState('');
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function send(target: string) {
    setBusy(true);
    setError(null);
    try {
      await sendSignInEmail(target);
      setSentTo(target);
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  function submitEmail(e: FormEvent) {
    e.preventDefault();
    const v = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(v)) {
      setError('Enter a valid email address.');
      emailRef.current?.focus();
      return;
    }
    void send(v);
  }

  async function submitCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifySignInCode(sentTo!, code);
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!sentTo) {
    return (
      <form className="signin" onSubmit={submitEmail} noValidate>
        <label className="field">
          <span className="field__label">Email</span>
          <input
            ref={emailRef}
            className="input"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            aria-invalid={!!error}
            aria-describedby={error ? 'signin-error' : 'signin-hint'}
            autoFocus={autoFocus}
          />
        </label>
        {error ? (
          <p id="signin-error" className="field__error" role="alert">
            {error}
          </p>
        ) : (
          <p id="signin-hint" className="field__hint">
            We’ll email you a sign-in link. No password needed.
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
          <Icon name="mail" size={18} />
          {busy ? 'Sending…' : 'Email me a sign-in link'}
        </button>
      </form>
    );
  }

  return (
    <div className="signin signin--sent" aria-live="polite">
      <div className="signin__mail" aria-hidden>
        <Icon name="mail" size={28} />
      </div>
      <h3 className="signin__title">Check your inbox</h3>
      <p className="signin__body">
        We sent a sign-in link to <strong>{sentTo}</strong>. Open it on this device and you’ll be signed in automatically.
      </p>
      <p className="field__hint">It can take a minute to arrive. Check spam if you don’t see it.</p>

      <div className="signin__actions">
        <button type="button" className="btn" disabled={busy || cooldown > 0} onClick={() => void send(sentTo)}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : busy ? 'Sending…' : 'Resend link'}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setSentTo(null);
            setShowCode(false);
            setCode('');
            setError(null);
          }}
        >
          Use a different email
        </button>
      </div>

      {!showCode ? (
        <button type="button" className="signin__code-toggle" onClick={() => setShowCode(true)}>
          Got a 6-digit code instead?
        </button>
      ) : (
        <form className="signin__code" onSubmit={submitCode}>
          <input
            className="input mono"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            maxLength={10}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ''))}
            aria-label="Sign-in code"
            autoFocus
          />
          <button type="submit" className="btn btn--primary" disabled={busy || code.length < 6}>
            {busy ? 'Checking…' : 'Sign in'}
          </button>
        </form>
      )}

      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
