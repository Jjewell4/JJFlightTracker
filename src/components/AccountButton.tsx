import { NavLink } from 'react-router-dom';
import { useCloudSync, type CloudSyncState } from '@/services/sync/controller';
import { Icon } from './Icon';
import './AccountButton.css';

export function syncTone(s: CloudSyncState): 'ok' | 'pending' | 'error' | 'syncing' | 'none' {
  if (s.phase !== 'signed-in') return 'none';
  if (s.status === 'syncing') return 'syncing';
  if (s.status === 'error') return 'error';
  if (s.status === 'offline' || s.pending > 0) return 'pending';
  return 'ok';
}

export function syncLabel(s: CloudSyncState): string {
  if (s.phase === 'signed-out') return 'Not signed in · saved on this device';
  if (s.phase !== 'signed-in') return '';
  if (s.status === 'syncing') return 'Syncing…';
  if (s.status === 'error') return 'Sync problem';
  if (s.status === 'offline') return 'Offline · will sync later';
  if (s.pending > 0) return `${s.pending} ${s.pending === 1 ? 'change' : 'changes'} waiting`;
  return 'Synced';
}

/** Round avatar: email initial when signed in (with a sync-status dot), person icon when not. */
export function Avatar({ size = 34 }: { size?: number }) {
  const sync = useCloudSync();
  const initial = sync.email?.trim()[0]?.toUpperCase();
  const tone = syncTone(sync);
  return (
    <span className={`avatar${initial ? ' avatar--in' : ''}`} style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initial ?? <Icon name="user" size={Math.round(size * 0.55)} />}
      {tone !== 'none' && <span className={`avatar__dot avatar__dot--${tone}`} aria-hidden />}
    </span>
  );
}

/** Account entry point for the top bar (phones). Hidden when cloud sync isn't configured. */
export function AccountButton() {
  const sync = useCloudSync();
  if (sync.phase === 'disabled') return null;
  const label = sync.phase === 'signed-in' ? `Account: ${sync.email ?? 'signed in'}, ${syncLabel(sync)}` : 'Account: sign in to back up your flights';
  return (
    <NavLink to="/account" className="account-btn" aria-label={label}>
      {sync.phase === 'signed-out' && <span className="account-btn__cta">Sign in</span>}
      <Avatar />
    </NavLink>
  );
}

/** Account row for the desktop sidebar. */
export function SidebarAccount() {
  const sync = useCloudSync();
  if (sync.phase === 'disabled') return null;
  return (
    <NavLink to="/account" className="side-account">
      <Avatar size={36} />
      <span className="side-account__text">
        <span className="side-account__title">{sync.phase === 'signed-in' ? (sync.email ?? 'Account') : 'Sign in'}</span>
        <span className="side-account__sub">{sync.phase === 'loading' ? '…' : syncLabel(sync)}</span>
      </span>
    </NavLink>
  );
}
