import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/AccountButton';
import { Icon } from '@/components/Icon';
import { ConfirmSheet } from '@/components/Sheet';
import { useFlights } from '@/lib/db';
import { signOut, syncNow, useCloudSync } from '@/services/sync/controller';
import { markOnboarded } from './onboarding';
import { SignInPanel } from './SignInPanel';
import './account.css';

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

export function Benefits() {
  return (
    <ul className="benefits">
      <li>
        <span className="benefits__icon" aria-hidden>
          <Icon name="shield" size={18} />
        </span>
        <span>
          <strong>Never lose your log</strong> — a private copy lives in the cloud, safe if you lose or reset your phone.
        </span>
      </li>
      <li>
        <span className="benefits__icon" aria-hidden>
          <Icon name="devices" size={18} />
        </span>
        <span>
          <strong>Same log everywhere</strong> — sign in on your laptop or a new phone and everything appears.
        </span>
      </li>
      <li>
        <span className="benefits__icon" aria-hidden>
          <Icon name="plane" size={18} />
        </span>
        <span>
          <strong>Still works offline</strong> — flights save on the device first and sync when you’re back online.
        </span>
      </li>
    </ul>
  );
}

export default function AccountPage() {
  const sync = useCloudSync();
  const flights = useFlights();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());
  const [confirmOut, setConfirmOut] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (sync.phase === 'signed-in') markOnboarded();
  }, [sync.phase]);

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/', { replace: true }));
  const count = flights?.length ?? 0;

  let body;
  if (sync.phase === 'disabled') {
    body = (
      <section className="card account-card">
        <h2 className="account-card__title">Cloud sync isn’t set up</h2>
        <p className="muted">
          Your flights are saved on this device. To enable accounts and sync, add <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> to the deployment’s
          environment variables and redeploy (see README → Cloud sync).
        </p>
      </section>
    );
  } else if (sync.phase === 'loading') {
    body = (
      <section className="card account-card" aria-busy="true">
        <div className="skeleton" style={{ height: 56, borderRadius: 'var(--radius-md)' }} />
        <div className="skeleton" style={{ height: 120, borderRadius: 'var(--radius-md)', marginTop: 'var(--space-4)' }} />
      </section>
    );
  } else if (sync.phase === 'signed-out') {
    body = (
      <>
        <section className="card account-card">
          <div className="account-hero">
            <span className="account-hero__icon" aria-hidden>
              <Icon name="cloud" size={26} />
            </span>
            <h2 className="account-card__title">Back up & sync your flights</h2>
            <p className="muted">
              {count > 0
                ? `Your ${count.toLocaleString()} ${count === 1 ? 'flight is' : 'flights are'} only on this device right now.`
                : 'Create a free account with just your email.'}
            </p>
          </div>
          <Benefits />
          <SignInPanel />
        </section>
        <p className="account-foot">
          New here? Signing in creates your account. You can keep using Flight Log without one — everything stays on this device.
        </p>
      </>
    );
  } else {
    const failing = sync.status === 'error';
    const status =
      sync.status === 'syncing'
        ? 'Syncing…'
        : failing
          ? (sync.error ?? 'Sync failed')
          : sync.status === 'offline'
            ? 'Offline — changes will sync when you’re back online'
            : sync.pending > 0
              ? `${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'} waiting to sync`
              : 'Everything is backed up';
    body = (
      <>
        <section className="card account-card account-profile">
          <Avatar size={56} />
          <div className="account-profile__text">
            <span className="account-profile__email">{sync.email}</span>
            <span className="muted">Signed in · cloud sync on</span>
          </div>
        </section>

        <section className={`card account-card account-sync${failing ? ' account-sync--error' : ''}`}>
          <div className="account-sync__row">
            <span className={`account-sync__icon account-sync__icon--${failing ? 'error' : sync.status === 'syncing' ? 'busy' : sync.pending || sync.status === 'offline' ? 'pending' : 'ok'}`} aria-hidden>
              <Icon name={sync.status === 'syncing' ? 'refresh' : failing ? 'warning' : sync.pending ? 'cloud' : 'check'} size={20} className={sync.status === 'syncing' ? 'spin' : undefined} />
            </span>
            <div className="account-sync__text">
              <span className="account-sync__status" role="status" aria-live="polite">
                {status}
              </span>
              <span className="subtle">
                Last synced {ago(sync.lastSyncAt, now)} · {count.toLocaleString()} {count === 1 ? 'flight' : 'flights'} on this device
              </span>
            </div>
          </div>
          <button type="button" className="btn btn--block" onClick={() => void syncNow()} disabled={sync.status === 'syncing'}>
            <Icon name="refresh" size={16} /> Sync now
          </button>
        </section>

        <section className="list account-links">
          <Link to="/settings" className="list__row account-link">
            <Icon name="settings" size={18} />
            <span>Settings & backups</span>
            <Icon name="chevron" size={16} className="account-link__chev" />
          </Link>
          <button type="button" className="list__row account-link account-link--danger" onClick={() => setConfirmOut(true)}>
            <Icon name="logout" size={18} />
            <span>Sign out</span>
          </button>
        </section>
        <p className="account-foot">Deleted flights are kept in your cloud database as recoverable records.</p>

        <ConfirmSheet
          open={confirmOut}
          title="Sign out?"
          icon="logout"
          message={
            sync.pending
              ? `${sync.pending} recent ${sync.pending === 1 ? 'change hasn’t' : 'changes haven’t'} synced yet and will stay on this device only.`
              : 'Your flights stay on this device and in the cloud. Sign in again any time to resume syncing.'
          }
          confirmLabel="Sign out"
          busy={busy}
          onCancel={() => setConfirmOut(false)}
          onConfirm={() => {
            setBusy(true);
            void signOut().finally(() => {
              setBusy(false);
              setConfirmOut(false);
            });
          }}
        />
      </>
    );
  }

  return (
    <div className="account animate-in">
      <header className="account__header">
        <button type="button" className="btn btn--ghost btn--icon" onClick={back} aria-label="Back">
          <Icon name="back" size={22} />
        </button>
        <h1 className="account__title">Account</h1>
        <span className="account__spacer" />
      </header>
      {body}
    </div>
  );
}
