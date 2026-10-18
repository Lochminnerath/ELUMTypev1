import { Archive, Contact, Inbox, Mail, Search, Settings, X, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import { TypeLockup, TypeMark } from '../components/Brand';
import { Loader } from '../components/Loader';
import { NotificationBell } from '../components/NotificationBell';
import { UserMenu } from '../components/UserMenu';
import { Compose } from '../compose/Compose';
import { useType } from '../state/TypeProvider';
import { ThemeToggle } from '../theme/ThemeToggle';
import { AppSwitcher } from './AppSwitcher';
import './shell.css';

interface RailItem {
  to: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
  match?: (path: string, view: string | null) => boolean;
}

/** App bar, tool rail and the composer around every signed-in screen (handoff 8.3). */
export function Shell({ children }: { children: ReactNode }) {
  const { start, startError, retryStart, counts, compose } = useType();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const query = params.get('q') ?? '';
  const onList = !location.pathname.startsWith('/contacts') && !location.pathname.startsWith('/settings');

  // "/" focuses search, like most mail apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !target.closest('input, textarea, [contenteditable="true"]')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const items: RailItem[] = [
    { to: '/', label: 'Inbox', icon: Inbox, badge: counts.unread + counts.cards, match: (p) => p === '/' || p.startsWith('/t/') || p.startsWith('/view/elum') || p.startsWith('/view/email') },
    { to: '/view/unread', label: 'Unread', icon: Mail },
    { to: '/view/archive', label: 'Archived', icon: Archive },
    { to: '/contacts', label: 'Contacts', icon: Contact },
  ];

  if (startError) {
    return (
      <div className="empty-state" style={{ minHeight: '100%', justifyContent: 'center' }}>
        <TypeMark size={72} />
        <h2>We could not open your inbox</h2>
        <p>{startError}</p>
        <button type="button" className="elum-btn elum-btn--primary" onClick={retryStart}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to messages
      </a>
      <header className="app-bar">
        <NavLink to="/" className="app-bar__brand" aria-label="ELUM Type, inbox">
          <span className="app-bar__lockup">
            <TypeLockup height={30} />
          </span>
          <span className="app-bar__mark">
            <TypeMark size={30} />
          </span>
        </NavLink>
        {onList && (
          <form
            className="app-bar__search"
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              searchRef.current?.blur();
            }}
          >
            <Search size={18} strokeWidth={1.75} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              className="app-bar__search-input"
              placeholder="Search messages"
              aria-label="Search messages"
              value={query}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('q', e.target.value);
                else next.delete('q');
                setParams(next, { replace: true });
                if (location.pathname.startsWith('/t/')) navigate({ pathname: '/', search: next.toString() }, { replace: true });
              }}
            />
            {query && (
              <button
                type="button"
                className="icon-btn"
                aria-label="Clear search"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('q');
                  setParams(next, { replace: true });
                }}
              >
                <X size={16} strokeWidth={2} />
              </button>
            )}
          </form>
        )}
        <div className="app-bar__end">
          <AppSwitcher />
          <NotificationBell />
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>

      <nav className="rail" aria-label="Type">
        <div className="rail__items">
          {items.map((item) => {
            const active = item.match ? item.match(location.pathname, null) : location.pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className="rail__item"
                data-active={active || undefined}
                aria-current={active ? 'page' : undefined}
                aria-label={item.badge ? `${item.label}, ${item.badge} new` : item.label}
                data-tip={item.label}
                data-tip-placement="right"
              >
                <Icon size={20} strokeWidth={1.75} />
                {!!item.badge && <span className="rail__badge">{item.badge > 99 ? '99+' : item.badge}</span>}
                <span className="rail__text">{item.label}</span>
              </NavLink>
            );
          })}
        </div>
        <NavLink
          to="/settings"
          className="rail__item rail__item--bottom"
          data-active={location.pathname.startsWith('/settings') || undefined}
          aria-label="Settings"
          data-tip="Settings"
          data-tip-placement="right"
        >
          <Settings size={20} strokeWidth={1.75} />
          <span className="rail__text">Settings</span>
        </NavLink>
      </nav>

      <main id="main" className="shell__main">
        {start ? children : <div className="shell__loading"><Loader size={48} label="Opening your inbox" /></div>}
      </main>

      {start && compose && <Compose key={compose.draft.id ?? 'new'} request={compose} />}
    </div>
  );
}
