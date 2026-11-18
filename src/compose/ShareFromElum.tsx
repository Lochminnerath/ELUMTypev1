import { useEffect, useState, type CSSProperties } from 'react';
import { Check } from 'lucide-react';
import { api, errorMessage } from '../api';
import type { ShareableItem, ShareRole } from '../api/client';
import { Dialog } from '../components/Dialog';
import { ShareIcon } from '../components/icons/ElumIcons';
import { Loader } from '../components/Loader';
import { ELUM_APPS } from '../lib/platform';

export interface ChosenItem extends ShareableItem {
  role: ShareRole;
  url: string;
}

const NAMES: Record<ShareableItem['app'], string> = { write: 'Write', make: 'Make', inquire: 'Inquire', capture: 'Capture', code: 'Code', tune: 'Tune' };

export function itemUrl(item: ShareableItem): string {
  const base = ELUM_APPS.find((a) => a.id === item.app)?.url ?? '';
  return `${base}${item.path}`;
}

/**
 * Share from ELUM: pick documents, designs, forms, albums, projects or playlists you own, and they
 * are shared with everyone you send the message to, with a link in the message. Nothing is shared
 * until you press Send.
 */
export function ShareFromElum({ open, onClose, onAdd }: { open: boolean; onClose(): void; onAdd(items: ChosenItem[]): void }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ShareableItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<Map<string, ShareableItem>>(new Map());
  const [role, setRole] = useState<ShareRole>('viewer');

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = window.setTimeout(() => {
      (api.shareables?.(query) ?? Promise.resolve([])).then(
        (list) => live && setItems(list),
        (e) => live && setProblem(errorMessage(e)),
      );
    }, query ? 220 : 0);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) {
      setPicked(new Map());
      setQuery('');
    }
  }, [open]);

  const toggle = (item: ShareableItem) =>
    setPicked((m) => {
      const next = new Map(m);
      const key = `${item.app}:${item.id}`;
      if (next.has(key)) next.delete(key);
      else next.set(key, item);
      return next;
    });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={520}
      icon={<ShareIcon size={24} />}
      title="Share from ELUM"
      description="Choose what to send. It is shared with everyone on this message when you press Send."
      footer={
        <>
          <label className="share-elum__role">
            <span className="visually-hidden">They can</span>
            <select className="input" value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>
              <option value="viewer">They can view</option>
              <option value="editor">They can edit</option>
            </select>
          </label>
          <button
            type="button"
            className="elum-btn elum-btn--product"
            disabled={!picked.size}
            onClick={() => {
              onAdd([...picked.values()].map((item) => ({ ...item, role, url: itemUrl(item) })));
              onClose();
            }}
          >
            {picked.size ? `Add ${picked.size} to message` : 'Add to message'}
          </button>
        </>
      }
    >
      <div className="share-elum">
        <input className="input" type="search" placeholder="Search your documents, designs and more" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search" autoFocus />
        {problem && (
          <p className="compose__error" role="alert">
            {problem}
          </p>
        )}
        {!items ? (
          <div className="share-elum__wait">
            <Loader size={28} label="Finding your things" />
          </div>
        ) : items.length === 0 ? (
          <p className="muted share-elum__empty">{query ? 'Nothing matches that.' : 'Things you make in Write, Make, Inquire, Capture, Code and Tune show here.'}</p>
        ) : (
          <ul className="share-elum__list">
            {items.map((item, i) => {
              const on = picked.has(`${item.app}:${item.id}`);
              const app = ELUM_APPS.find((a) => a.id === item.app);
              return (
                <li key={`${item.app}:${item.id}`} style={{ '--i': i, '--app': app?.color } as CSSProperties}>
                  <button type="button" className="share-elum__item" aria-pressed={on} onClick={() => toggle(item)}>
                    <img src={`/brand/apps/${item.app}.svg`} alt="" width={28} height={28} />
                    <span className="share-elum__text">
                      <strong>{item.title}</strong>
                      <span className="muted">
                        {NAMES[item.app]} · {new Date(item.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      </span>
                    </span>
                    <span className="share-elum__check" aria-hidden="true">
                      {on && <Check size={14} strokeWidth={2.5} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
