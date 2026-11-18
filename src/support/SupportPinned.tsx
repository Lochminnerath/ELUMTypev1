import { Link } from 'react-router';
import { formatFull, formatWhen } from '../lib/time';
import { ElumSupportMark, ElumSupportName } from './ElumSupportMark';
import { useSupportList } from './useSupport';

/**
 * Open conversations with ELUM Support, pinned to the top of the inbox until they are closed.
 * Someone who has asked ELUM for help sees the answer the moment they open Type.
 */
export function SupportPinned() {
  const open = useSupportList().filter((s) => s.status !== 'done' || s.unread);
  if (!open.length) return null;
  return (
    <ul className="support-pinned" aria-label="Your conversations with ELUM Support">
      {open.map((s) => (
        <li key={s.id}>
          <Link className="thread-row support-pinned__row" to={`/support/${s.id}`} data-unread={s.unread || undefined}>
            <ElumSupportMark size={40} />
            <span className="thread-row__text">
              <span className="thread-row__top">
                <span className="thread-row__names">
                  <ElumSupportName />
                </span>
                <time className="thread-row__time" dateTime={s.lastAt} title={formatFull(s.lastAt)}>
                  {formatWhen(s.lastAt)}
                </time>
              </span>
              <span className="thread-row__line">
                <span className="thread-row__subject">{s.title}</span>
                <span className="thread-row__snippet">{s.unread ? 'ELUM Support answered you' : s.snippet || 'Waiting for ELUM Support'}</span>
              </span>
            </span>
            <span className="thread-row__marks">{s.unread && <span className="thread-row__dot" aria-label="New answer" />}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
