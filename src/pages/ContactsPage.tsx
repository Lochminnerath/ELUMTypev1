import { BadgeCheck, Search, SquarePen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, errorMessage, type Contact } from '../api';
import { displayName } from '../api/validation';
import { Avatar } from '../components/Avatar';
import { TypeMark } from '../components/Brand';
import { Loader } from '../components/Loader';
import { formatWhen } from '../lib/time';
import { useType } from '../state/TypeProvider';
import './pages.css';

/** People you have written with, and ELUM people found by name or address (handoff 8.2). */
export function ContactsPage() {
  const { openCompose, tick } = useType();
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Contact[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      api.contacts(query).then(
        (c) => !cancelled && (setList(c), setError(null)),
        (e) => !cancelled && setError(errorMessage(e)),
      );
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [query, tick]);

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Contacts</h1>
        <p className="muted">People you have written with. Search by name to find anyone on ELUM.</p>
        <div className="page__search">
          <Search size={18} strokeWidth={1.75} aria-hidden="true" />
          <input className="input" type="search" placeholder="Search by name or address" aria-label="Search contacts" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </header>
      {error && <p className="field-error">{error}</p>}
      {list === null ? (
        <Loader size={36} label="Loading contacts" />
      ) : list.length === 0 ? (
        <div className="empty-state">
          <TypeMark size={64} />
          <h2>{query ? 'Nobody by that name' : 'No contacts yet'}</h2>
          <p>{query ? 'Check the spelling, or write to their email address.' : 'People appear here once you write to them.'}</p>
        </div>
      ) : (
        <ul className="contact-list">
          {list.map((c) => (
            <li key={c.address} className="contact-row">
              <Avatar user={{ name: displayName(c), color: c.isElum ? c.color : null }} size={40} />
              <span className="contact-row__text">
                <span className="contact-row__name">
                  {c.name || c.address}
                  {c.isElum && <BadgeCheck size={14} strokeWidth={2} className="address-chip__badge" aria-label="ELUM account" />}
                </span>
                <span className="contact-row__address">
                  {c.address}
                  {c.lastContactAt && <> · last message {formatWhen(c.lastContactAt).toLowerCase()}</>}
                </span>
              </span>
              <button
                type="button"
                className="elum-btn elum-btn--secondary elum-btn--sm"
                onClick={() => openCompose({ draft: { to: [{ address: c.address, name: c.name }] } })}
              >
                <SquarePen size={16} strokeWidth={1.75} />
                Write
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
