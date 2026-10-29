import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isOnboarded } from '@/features/account/onboarding';
import { clearNotice, useCloudSync } from '@/services/sync/controller';
import { DraftNotifier } from '@/features/review/DraftNotifier';
import { AccountButton, SidebarAccount } from './AccountButton';
import { Icon, type IconName } from './Icon';
import './AppShell.css';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const HOME: NavItem = { to: '/', label: 'Home', icon: 'home', end: true };
const LOG: NavItem = { to: '/flights', label: 'Log', icon: 'plane', end: true };
const MAP: NavItem = { to: '/map', label: 'Map', icon: 'globe' };
const STATS: NavItem = { to: '/stats', label: 'Stats', icon: 'chart' };
const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: 'settings' };
const IMPORT: NavItem = { to: '/import', label: 'Import', icon: 'upload' };

/** Phone tab bar, either side of the centre "Log a flight" button. Settings lives in the top bar. */
const TABS_LEFT = [HOME, LOG];
const TABS_RIGHT = [MAP, STATS];
/** Wide-screen sidebar. */
const SIDE_NAV = [HOME, LOG, MAP, STATS, SETTINGS, IMPORT];

/** The app mark (same artwork as the favicon and launcher icons). */
function BrandMark({ size }: { size: number }) {
  return <img className="brand-mark" src={`${import.meta.env.BASE_URL}favicon.svg`} width={size} height={size} alt="" />;
}

/**
 * Responsive app frame. Phones: slim top bar (brand, settings, account) on the main tabs and a
 * bottom tab bar with a raised centre "Log a flight" button. Wide screens: left sidebar.
 * Pages render inside <main>.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isForm = pathname.startsWith('/flights/new') || pathname.endsWith('/edit');
  const isMap = pathname === '/map';
  const isBare = pathname === '/welcome';
  // Top-level tabs get the slim app bar (logo → home, settings, account) on phones. The map is
  // full-bleed with its own controls; settings is one tab away from there.
  const hasTopbar = pathname === '/' || pathname === '/flights' || pathname === '/stats' || pathname === '/settings';
  const sync = useCloudSync();

  const navigate = useNavigate();

  // Following a link while a sheet is open (a flight in the map sheet, "Log return flight"…)
  // replaces the sheet's Back entry, so Back returns to the screen, not to a stale copy of it.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!(window.history.state as { __overlay?: string } | null)?.__overlay) return;
      const href = (e.target as Element | null)?.closest?.('a[href]')?.getAttribute('href');
      if (!href?.startsWith('#/')) return;
      e.preventDefault();
      navigate(href.slice(1), { replace: true });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [navigate]);

  // First run: offer sign-in or local-only use once the stored session has been checked.
  useEffect(() => {
    if (sync.phase === 'signed-out' && !isOnboarded() && !isBare && !isForm && pathname !== '/account' && pathname !== '/password') {
      navigate('/welcome', { replace: true });
    }
  }, [sync.phase, pathname, isBare, isForm, navigate]);

  // One-off notices from sync (e.g. "Signed in as …" after opening the email link).
  useEffect(() => {
    if (!sync.notice) return;
    const t = setTimeout(clearNotice, 4500);
    return () => clearTimeout(t);
  }, [sync.notice]);

  // Every screen opens at the top (the flights list restores its own position).
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={`shell${isMap ? ' shell--fullbleed' : ''}${isBare ? ' shell--bare' : ''}`}>
      <aside className="shell__sidebar" aria-label="Primary">
        <Link to="/" className="shell__brand" aria-label="Window Seat — home">
          <BrandMark size={44} />
          Window Seat
        </Link>
        <Link to="/flights/new" className="shell__add-wide">
          <Icon name="plus" size={18} strokeWidth={2.25} /> Log a flight
        </Link>
        <nav className="shell__side-nav">
          {SIDE_NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="shell__side-link">
              <Icon name={n.icon} size={20} />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <SidebarAccount />
      </aside>

      <main className="shell__main">
        {hasTopbar && (
          <header className="topbar">
            <Link to="/" className="topbar__brand" aria-label="Window Seat — home">
              <BrandMark size={48} />
              Window Seat
            </Link>
            <div className="topbar__actions">
              <NavLink to="/settings" className="topbar__btn" aria-label="Settings" title="Settings">
                <Icon name="settings" size={22} />
              </NavLink>
              <AccountButton />
            </div>
          </header>
        )}
        {children}
      </main>

      {!isBare && <DraftNotifier />}

      {sync.notice && (
        <div className="shell__notice" role="status" aria-live="polite" onClick={clearNotice}>
          <Icon name="check" size={16} strokeWidth={2.25} /> {sync.notice}
        </div>
      )}

      {!isForm && !isBare && (
        <nav className="tabbar" aria-label="Primary">
          {TABS_LEFT.map(tab)}
          <Link to="/flights/new" className="tabbar__add" aria-label="Log a flight" title="Log a flight">
            <span className="tabbar__add-disc">
              <Icon name="plus" size={28} strokeWidth={2.5} />
            </span>
          </Link>
          {TABS_RIGHT.map(tab)}
        </nav>
      )}
    </div>
  );
}

function tab(n: NavItem) {
  return (
    <NavLink key={n.to} to={n.to} end={n.end} className="tabbar__link">
      <Icon name={n.icon} size={24} />
      <span>{n.label}</span>
    </NavLink>
  );
}
