import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isOnboarded } from '@/features/account/onboarding';
import { clearNotice, useCloudSync } from '@/services/sync/controller';
import { AccountButton, SidebarAccount } from './AccountButton';
import { Icon, type IconName } from './Icon';
import './AppShell.css';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/flights', label: 'Log', icon: 'plane', end: true },
  { to: '/map', label: 'Map', icon: 'globe' },
  { to: '/stats', label: 'Stats', icon: 'chart' },
  { to: '/settings', label: 'More', icon: 'settings' },
];

/**
 * Responsive app frame: bottom tab bar with a raised "add" button on phones,
 * left sidebar on wide screens. Pages render inside <main>.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isForm = pathname.startsWith('/flights/new') || pathname.endsWith('/edit');
  const isMap = pathname === '/map';
  const isBare = pathname === '/welcome';
  // Top-level tabs get the slim app bar (logo → home, account avatar) on phones.
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
        <Link to="/" className="shell__brand" aria-label="FlightJournal — home">
          <img className="brand-icon" src={`${import.meta.env.BASE_URL}favicon.svg`} width="32" height="32" alt="" />
          FlightJournal
        </Link>
        <NavLink to="/flights/new" className="shell__add-wide">
          <Icon name="plus" size={18} /> Log a flight
        </NavLink>
        <nav className="shell__side-nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="shell__side-link">
              <Icon name={n.icon} size={20} />
              {n.label === 'More' ? 'Settings' : n.label}
            </NavLink>
          ))}
          <NavLink to="/import" className="shell__side-link">
            <Icon name="upload" size={20} />
            Import
          </NavLink>
        </nav>
        <SidebarAccount />
      </aside>

      <main className="shell__main">
        {hasTopbar && (
          <div className="topbar">
            <Link to="/" className="topbar__brand" aria-label="FlightJournal — home">
              <img className="brand-icon" src={`${import.meta.env.BASE_URL}favicon.svg`} width="32" height="32" alt="" />
              FlightJournal
            </Link>
            <AccountButton />
          </div>
        )}
        {children}
      </main>

      {sync.notice && (
        <div className="shell__notice" role="status" aria-live="polite" onClick={clearNotice}>
          <Icon name="check" size={16} strokeWidth={2.25} /> {sync.notice}
        </div>
      )}

      {!isForm && !isBare && (
        <nav className="tabbar" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="tabbar__link">
              <Icon name={n.icon} size={22} />
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
