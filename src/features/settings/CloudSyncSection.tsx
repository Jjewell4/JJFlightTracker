import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Icon } from '@/components/Icon';
import { ConfirmSheet } from '@/components/Sheet';
import { signOut, syncNow, useCloudSync } from '@/services/sync/controller';
import { sendSignInEmail, verifySignInCode } from '@/services/sync/supabase';

function ago(ts: number | undefined, now: number): string {
  if (!ts) return 'not yet';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/rate limit|too many/i.test(msg)) return 'Too many emails requested — wait a minute and try again.';
  if (/expired|invalid/i.test(msg)) return 'That code is invalid or expired. Request a new one.';
  if (/signups not allowed/i.test(msg)) return 'New sign-ups are turned off for this app.';
  return msg;
}

export function CloudSyncSection({ Group, say }: { Group: (p: { title?: string; footer?: ReactNode; children: ReactNode }) => ReactNode; say: (msg: string) => void }) {
  const sync = useCloudSync();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOut, setConfirmOut] = useState(false);

  const footer =
    'Your log stays on this device and works offline; sync keeps a copy in your private cloud database and on any other device you sign in on. Deleted flights are kept in the cloud as recoverable records.';

  if (sync.phase === 'disabled') {
    return (
      <Group title="Cloud sync" footer="Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the deployment’s environment variables and redeploy to turn on sync. See README → Cloud sync.">
        <div className="list__row srow">
          <span className="stile stile--plain" aria-hidden>
            <Icon name="cloud" size={18} />
          </span>
          <span className="srow__text">
            <span className="srow__title">Not set up</span>
            <span className="srow__sub">Flights are saved on this device only.</span>
          </span>
        </div>
      </Group>
    );
  }

  if (sync.phase === 'loading') {
    return (
      <Group title="Cloud sync">
        <div className="list__row srow" aria-busy="true">
          <span className="skeleton" style={{ width: 36, height: 36, borderRadius: 10 }} />
          <span className="skeleton" style={{ height: 14, flex: 1 }} />
        </div>
      </Group>
    );
  }

  if (sync.phase === 'signed-out') {
    async function send(e: FormEvent) {
      e.preventDefault();
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
      setBusy(true);
      setError(null);
      try {
        await sendSignInEmail(email);
        setSentTo(email.trim());
        setCode('');
      } catch (err) {
        setError(errText(err));
      } finally {
        setBusy(false);
      }
    }
    async function verify(e: FormEvent) {
      e.preventDefault();
      setBusy(true);
      setError(null);
      try {
        await verifySignInCode(sentTo!, code);
        say('Signed in — syncing your flights.');
        setSentTo(null);
      } catch (err) {
        setError(errText(err));
      } finally {
        setBusy(false);
      }
    }

    return (
      <Group title="Cloud sync" footer={footer}>
        <div className="list__row srow srow--stack">
          <div className="row">
            <span className="stile stile--accent" aria-hidden>
              <Icon name="cloud" size={18} />
            </span>
            <span className="srow__text">
              <span className="srow__title">Back up & sync your log</span>
              <span className="srow__sub">{sentTo ? `We emailed a code to ${sentTo}.` : 'Sign in with your email — no password.'}</span>
            </span>
          </div>
          {!sentTo ? (
            <form className="skey" onSubmit={send}>
              <input
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-label="Email address"
                aria-invalid={!!error}
              />
              <button type="submit" className="btn btn--primary" disabled={busy || !email.trim()}>
                {busy ? 'Sending…' : 'Send code'}
              </button>
            </form>
          ) : (
            <>
              <form className="skey" onSubmit={verify}>
                <input
                  className="input mono"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="6-digit code"
                  maxLength={10}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^\d]/g, ''))}
                  aria-label="Sign-in code"
                  aria-invalid={!!error}
                  autoFocus
                />
                <button type="submit" className="btn btn--primary" disabled={busy || code.length < 6}>
                  {busy ? 'Checking…' : 'Sign in'}
                </button>
              </form>
              <p className="srow__sub">Or tap the link in the email on this device. No email? Check spam, or</p>
              <div className="row">
                <button type="button" className="btn btn--ghost" onClick={() => setSentTo(null)}>
                  Use a different email
                </button>
                <span className="spacer" />
                <button type="button" className="btn btn--ghost" disabled={busy} onClick={(e) => void send(e as unknown as FormEvent)}>
                  Resend
                </button>
              </div>
            </>
          )}
          {(error || sync.error) && (
            <p className="field__error" role="alert">
              {error || sync.error}
            </p>
          )}
        </div>
      </Group>
    );
  }

  // ---- signed in ----
  const status =
    sync.status === 'syncing'
      ? 'Syncing…'
      : sync.status === 'error'
        ? (sync.error ?? 'Sync failed')
        : sync.status === 'offline'
          ? `Offline — ${sync.pending ? `${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'} will sync when you’re back online` : 'will sync when you’re back online'}`
          : sync.pending
            ? `${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'} waiting`
            : `Up to date · synced ${ago(sync.lastSyncAt, now)}`;
  const tone = sync.status === 'error' ? 'danger' : sync.status === 'offline' || sync.pending ? 'amber' : 'green';

  return (
    <Group title="Cloud sync" footer={footer}>
      <div className="list__row srow">
        <span className={`stile stile--${tone}`} aria-hidden>
          <Icon name={sync.status === 'syncing' ? 'refresh' : 'cloud'} size={18} className={sync.status === 'syncing' ? 'spin' : undefined} />
        </span>
        <span className="srow__text">
          <span className="srow__title">{sync.email ?? 'Signed in'}</span>
          <span className="srow__sub" role="status" aria-live="polite">
            {status}
          </span>
        </span>
        <button type="button" className="btn" onClick={() => void syncNow()} disabled={sync.status === 'syncing'}>
          Sync now
        </button>
      </div>
      <button type="button" className="list__row srow" onClick={() => setConfirmOut(true)}>
        <span className="stile stile--plain" aria-hidden>
          <Icon name="back" size={18} />
        </span>
        <span className="srow__text">
          <span className="srow__title">Sign out</span>
          <span className="srow__sub">Stops syncing on this device; your flights stay here and in the cloud</span>
        </span>
      </button>
      <ConfirmSheet
        open={confirmOut}
        title="Sign out of cloud sync?"
        icon="cloud"
        message={sync.pending ? `${sync.pending} recent ${sync.pending === 1 ? 'change hasn’t' : 'changes haven’t'} synced yet and will stay on this device only.` : 'Your flights stay on this device and in the cloud.'}
        confirmLabel="Sign out"
        onCancel={() => setConfirmOut(false)}
        onConfirm={() => {
          void signOut().then(() => {
            setConfirmOut(false);
            say('Signed out of cloud sync.');
          });
        }}
      />
    </Group>
  );
}
