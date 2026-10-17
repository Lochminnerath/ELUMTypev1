import { Bell } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, WRITE_URL, type AppNotification } from '../api';
import { formatWhen } from '../lib/time';
import { Avatar } from './Avatar';
import { Popover } from './Popover';
import './NotificationBell.css';

const POLL_MS = 60_000;
const SERVICE_NAMES: Record<string, string> = { elum: 'ELUM', write: 'Write', type: 'Type', browse: 'Browse', make: 'Make', store: 'Store' };

/**
 * Notifications from every ELUM service: shares and comments in Write, messages in Type, and
 * more as services grow. Shown only where the platform backend is connected.
 */
export function NotificationBell() {
  const feed = api.notifications;
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[]>([]);

  const load = useCallback(async () => {
    if (!feed) return;
    try {
      setItems(await feed.list({ limit: 30 }));
    } catch {
      // The bell is a convenience; a failed refresh tries again later.
    }
  }, [feed]);

  useEffect(() => {
    if (!feed) return;
    void load();
    const timer = window.setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS);
    const unsubscribe = feed.subscribe((n) => setItems((list) => (list.some((x) => x.id === n.id) ? list : [n, ...list])));
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [feed, load]);

  if (!feed) return null;
  const unread = items.filter((n) => !n.readAt).length;

  const open = (n: AppNotification) => {
    if (!n.readAt) void feed.markRead([n.id]).then(load);
    if (!n.link) return;
    if (/^https?:\/\//.test(n.link)) window.open(n.link, '_blank', 'noopener,noreferrer');
    else if (n.service === 'type') navigate(n.link);
    // A path from another service opens in that service.
    else if (n.service === 'write') window.open(WRITE_URL + n.link, '_blank', 'noopener,noreferrer');
  };

  return (
    <Popover
      label="Notifications"
      placement="bottom-end"
      className="notifications"
      onOpenChange={(o) => o && void load()}
      trigger={(props) => (
        <button
          type="button"
          className="icon-btn icon-btn--round bell"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          data-tip="Notifications"
          {...props}
        >
          <Bell size={18} strokeWidth={1.75} />
          {unread > 0 && <span className="bell__dot" aria-hidden="true" />}
        </button>
      )}
    >
      {(close) => (
        <div className="notifications__body">
          <header className="notifications__head">
            <h2 className="notifications__title">Notifications</h2>
            {unread > 0 && (
              <button type="button" className="elum-btn elum-btn--quiet elum-btn--sm" onClick={() => void feed.markRead().then(load)}>
                Mark all read
              </button>
            )}
          </header>
          {items.length === 0 ? (
            <p className="notifications__empty muted">Nothing new. Shares, comments and messages from every ELUM app show up here.</p>
          ) : (
            <ul className="notifications__list">
              {items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="notice"
                    data-unread={!n.readAt || undefined}
                    onClick={() => {
                      open(n);
                      close();
                    }}
                  >
                    {n.actor ? <Avatar user={n.actor} size={28} /> : <span className="notice__service-dot" data-service={n.service} />}
                    <span className="notice__text">
                      <span className="notice__title">{n.title}</span>
                      {n.body && <span className="notice__body">{n.body}</span>}
                      <span className="notice__meta">
                        <span className="notice__service" data-service={n.service}>
                          {SERVICE_NAMES[n.service] ?? n.service}
                        </span>
                        {formatWhen(n.createdAt)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
}
