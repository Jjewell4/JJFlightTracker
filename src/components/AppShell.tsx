import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon';
import './AppShell.css';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Flights', icon: 'list', end: true },
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

  // Every screen opens at the top (the flights list restores its own position).
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className={`shell${isMap ? ' shell--fullbleed' : ''}`}>
      <aside className="shell__sidebar" aria-label="Primary">
        <div className="shell__brand">
          <span className="shell__logo" aria-hidden>
            <Icon name="plane" size={18} />
          </span>
          Flight Log
        </div>
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
      </aside>

      <main className="shell__main">{children}</main>

      {!isForm && (
        <nav className="tabbar" aria-label="Primary">
          {NAV.slice(0, 2).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="tabbar__link">
              <Icon name={n.icon} size={22} />
              <span>{n.label}</span>
            </NavLink>
          ))}
          <NavLink to="/flights/new" className="tabbar__add" aria-label="Log a flight">
            <Icon name="plus" size={26} />
          </NavLink>
          {NAV.slice(2).map((n) => (
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
