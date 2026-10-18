import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { TypeMark } from '../components/Brand';
import { Dialog } from '../components/Dialog';
import { RELEASES, type Release, unseenReleases } from './releases';
import './WhatsNew.css';

const SEEN_KEY = 'elum.type.whats-new';
const OPEN_EVENT = 'elum:whats-new';

function lastSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function markSeen() {
  try {
    if (RELEASES[0]) localStorage.setItem(SEEN_KEY, RELEASES[0].id);
  } catch {
    // Without storage the panel shows again next time, which is harmless.
  }
}

/** Opens the panel with every release, from a menu. */
export function openWhatsNew() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Shows what changed once after each update, and on request. */
export function WhatsNew() {
  const { status } = useAuth();
  const [shown, setShown] = useState<Release[] | null>(null);

  useEffect(() => {
    if (status !== 'signed-in') return;
    const unseen = unseenReleases(RELEASES, lastSeen());
    if (unseen.length) setShown(unseen);
  }, [status]);

  useEffect(() => {
    const open = () => setShown(RELEASES);
    window.addEventListener(OPEN_EVENT, open);
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, []);

  const close = () => {
    markSeen();
    setShown(null);
  };

  return (
    <Dialog
      open={!!shown}
      onClose={close}
      title="What's new in Type"
      icon={<TypeMark size={28} />}
      width={520}
      footer={
        <button type="button" className="elum-btn elum-btn--primary" onClick={close}>
          Got it
        </button>
      }
    >
      <div className="whats-new">
        {shown?.map((r) => (
          <section key={r.id} className="whats-new__release">
            <h3 className="whats-new__title">{r.title}</h3>
            <p className="whats-new__date">{r.date}</p>
            <ul className="whats-new__items">
              {r.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
