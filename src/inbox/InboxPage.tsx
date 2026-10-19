import { BadgeCheck, BellOff, Paperclip, SquarePen } from 'lucide-react';
import { ArchiveIcon } from '../components/icons/ElumIcons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { api, errorMessage, type InboxCard, type InboxView, type ThreadSummary } from '../api';
import { displayName } from '../api/validation';
import { Avatar } from '../components/Avatar';
import { ProductGlyph, TypeMark, type Product } from '../components/Brand';
import { Loader } from '../components/Loader';
import { useMediaQuery } from '../lib/hooks';
import { leadPerson, namesOf } from '../lib/format';
import { formatFull, formatWhen } from '../lib/time';
import { useType } from '../state/TypeProvider';
import { openElsewhere } from '../lib/elum';
import { ThreadView } from '../thread/ThreadView';
import './inbox.css';

const VIEWS: { view: InboxView; label: string; title: string }[] = [
  { view: 'inbox', label: 'All', title: 'Inbox' },
  { view: 'unread', label: 'Unread', title: 'Unread' },
  { view: 'elum', label: 'From ELUM', title: 'From ELUM' },
  { view: 'email', label: 'Email', title: 'Email' },
  { view: 'archive', label: 'Archived', title: 'Archived' },
  { view: 'spam', label: 'Spam', title: 'Spam' },
  { view: 'trash', label: 'Trash', title: 'Trash' },
];

const EMPTY: Record<InboxView, { title: string; text: string }> = {
  inbox: { title: 'All caught up', text: 'New messages from ELUM people and email from anyone arrive here.' },
  unread: { title: 'Nothing unread', text: 'Everything new has been read.' },
  elum: { title: 'No ELUM conversations yet', text: 'Messages between ELUM people arrive the moment they are sent.' },
  email: { title: 'No email yet', text: 'Email from people outside ELUM arrives here.' },
  archive: { title: 'Nothing archived', text: 'Archive a conversation to clear it from your inbox. A new message brings it back.' },
  spam: { title: 'No spam', text: 'Email we think is unwanted waits here. It never rings the bell.' },
  trash: { title: 'Trash is empty', text: 'Conversations you delete wait here.' },
};

const LAST_VIEW = 'elum.type.view';

/** The conversation list and, beside it, the open conversation (handoff 8.2 and 8.3). */
export function InboxPage() {
  const params = useParams<{ view?: string; threadId?: string }>();
  const [search] = useSearchParams();
  const query = search.get('q') ?? '';
  const location = useLocation();
  const navigate = useNavigate();
  const phone = useMediaQuery('(max-width: 860px)');
  const { tick, openCompose, refreshCounts } = useType();

  const threadId = params.threadId ?? null;
  const view: InboxView = useMemo(() => {
    if (params.view && VIEWS.some((v) => v.view === params.view)) return params.view as InboxView;
    if (threadId) {
      const saved = sessionStorage.getItem(LAST_VIEW);
      if (saved && VIEWS.some((v) => v.view === saved)) return saved as InboxView;
    }
    return 'inbox';
  }, [params.view, threadId]);

  useEffect(() => {
    if (!threadId) sessionStorage.setItem(LAST_VIEW, view);
  }, [view, threadId]);

  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [cards, setCards] = useState<InboxCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, cardList] = await Promise.all([
        api.listThreads({ view, query }),
        view === 'inbox' || view === 'unread' || view === 'archive' ? api.listCards({ archived: view === 'archive' }) : Promise.resolve([]),
      ]);
      setThreads(list);
      setCards(
        cardList.filter((c) => (view !== 'unread' || !c.readAt) && (!query || `${c.title} ${c.body ?? ''}`.toLowerCase().includes(query.toLowerCase()))),
      );
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [view, query]);

  useEffect(() => {
    void load();
  }, [load, tick]);

  const rows = useMemo(() => {
    const merged: ({ kind: 'thread'; at: string; thread: ThreadSummary } | { kind: 'card'; at: string; card: InboxCard })[] = [
      ...(threads ?? []).map((t) => ({ kind: 'thread' as const, at: t.lastMessageAt, thread: t })),
      ...cards.map((c) => ({ kind: 'card' as const, at: c.createdAt, card: c })),
    ];
    return merged.sort((a, b) => b.at.localeCompare(a.at));
  }, [threads, cards]);

  const title = VIEWS.find((v) => v.view === view)!.title;
  const showList = !phone || !threadId;
  const linkFor = (id: string) => ({ pathname: `/t/${id}`, search: location.search });

  return (
    <div className="inbox" data-thread-open={!!threadId || undefined}>
      {showList && (
        <section className="inbox__list" aria-label={title}>
          <header className="inbox__head">
            <div className="inbox__title-row">
              <h1 className="inbox__title">{query ? `Results for “${query}”` : title}</h1>
              <button type="button" className="elum-btn elum-btn--product inbox__compose" onClick={() => openCompose()}>
                <SquarePen size={18} strokeWidth={1.75} />
                <span>Compose</span>
              </button>
            </div>
            <div className="chips" role="group" aria-label="Show">
              {VIEWS.map((v) => (
                <Link
                  key={v.view}
                  to={{ pathname: v.view === 'inbox' ? '/' : `/view/${v.view}`, search: location.search }}
                  className="chip"
                  aria-pressed={v.view === view}
                >
                  {v.label}
                </Link>
              ))}
            </div>
          </header>

          {error && (
            <div className="inbox__error" role="alert">
              <p>{error}</p>
              <button type="button" className="elum-btn elum-btn--secondary elum-btn--sm" onClick={() => void load()}>
                Try again
              </button>
            </div>
          )}

          {threads === null && !error ? (
            <div className="inbox__loading">
              <Loader size={36} label="Loading conversations" />
            </div>
          ) : rows.length === 0 && !error ? (
            <div className="empty-state inbox__empty">
              <TypeMark size={64} />
              <h2>{query ? 'Nothing matches' : EMPTY[view].title}</h2>
              <p>{query ? 'Try another name, address or word.' : EMPTY[view].text}</p>
              {view === 'inbox' && !query && (
                <button type="button" className="elum-btn elum-btn--secondary" onClick={() => openCompose()}>
                  Write a message
                </button>
              )}
            </div>
          ) : (
            <ul className="thread-list">
              {rows.map((row) =>
                row.kind === 'thread' ? (
                  <li key={row.thread.id}>
                    <ThreadRow thread={row.thread} active={row.thread.id === threadId} to={linkFor(row.thread.id)} />
                  </li>
                ) : (
                  <li key={row.card.id}>
                    <CardRow
                      card={row.card}
                      onChange={() => {
                        void load();
                        refreshCounts();
                      }}
                    />
                  </li>
                ),
              )}
            </ul>
          )}
        </section>
      )}

      {threadId ? (
        <ThreadView
          key={threadId}
          threadId={threadId}
          onBack={() => navigate({ pathname: view === 'inbox' ? '/' : `/view/${view}`, search: location.search })}
          onChanged={() => void load()}
        />
      ) : (
        !phone && (
          <section className="inbox__none" aria-label="Conversation">
            <TypeMark size={72} />
            <p className="muted">Choose a conversation, or write a new message.</p>
          </section>
        )
      )}
    </div>
  );
}

function ThreadRow({ thread, active, to }: { thread: ThreadSummary; active: boolean; to: { pathname: string; search: string } }) {
  const lead = leadPerson(thread.participants) ?? { address: thread.lastSender.address, name: thread.lastSender.name, isElum: false };
  const names = namesOf(thread.participants);
  const elum = thread.kind === 'elum';
  return (
    <Link
      to={to}
      className="thread-row"
      data-unread={thread.unread || undefined}
      aria-current={active ? 'page' : undefined}
      aria-label={`${thread.unread ? 'Unread. ' : ''}${names}. ${thread.subject ?? ''} ${thread.snippet}`}
    >
      <Avatar user={{ name: displayName(lead), color: lead.isElum ? lead.color : null }} size={40} />
      <span className="thread-row__text">
        <span className="thread-row__top">
          <span className="thread-row__names">{names}</span>
          {elum && <BadgeCheck className="thread-row__elum" size={14} strokeWidth={2} aria-label="ELUM conversation" />}
          {thread.messageCount > 1 && <span className="thread-row__count">{thread.messageCount}</span>}
          <time className="thread-row__time" dateTime={thread.lastMessageAt} title={formatFull(thread.lastMessageAt)}>
            {formatWhen(thread.lastMessageAt)}
          </time>
        </span>
        <span className="thread-row__line">
          {thread.subject && <span className="thread-row__subject">{thread.subject}</span>}
          <span className="thread-row__snippet">{thread.snippet}</span>
        </span>
      </span>
      <span className="thread-row__marks">
        {thread.unread && <span className="thread-row__dot" aria-hidden="true" />}
        {thread.hasAttachments && <Paperclip size={14} strokeWidth={2} aria-label="Has attachments" />}
        {thread.muted && <BellOff size={14} strokeWidth={2} aria-label="Muted" />}
      </span>
    </Link>
  );
}

const SERVICE_NAMES: Record<string, string> = { elum: 'ELUM', write: 'Write', type: 'Type', browse: 'Browse', make: 'Make', store: 'Store' };

/** A platform event shown in the inbox: "Ola shared “Field notes” with you", with Open in Write (handoff 8.5). */
function CardRow({ card, onChange }: { card: InboxCard; onChange: () => void }) {
  const product = (['write', 'browse', 'make', 'store', 'type', 'elum'].includes(card.service) ? card.service : 'elum') as Product;
  const mark = (change: { read?: boolean; archived?: boolean }) => void api.markCard(card.id, change).then(onChange);
  return (
    <div className="card-row" data-unread={!card.readAt || undefined} data-service={card.service}>
      <span className="card-row__icon">
        {card.actor ? <Avatar user={card.actor} size={40} /> : null}
        <span className="card-row__glyph">
          <ProductGlyph product={product} size={16} />
        </span>
      </span>
      <span className="thread-row__text">
        <span className="thread-row__top">
          <span className="thread-row__names">{card.title}</span>
          <time className="thread-row__time" dateTime={card.createdAt} title={formatFull(card.createdAt)}>
            {formatWhen(card.createdAt)}
          </time>
        </span>
        {card.body && <span className="thread-row__snippet">{card.body}</span>}
        <span className="card-row__actions">
          <span className="card-row__service" data-service={card.service}>
            {SERVICE_NAMES[card.service] ?? card.service}
          </span>
          {card.actionUrl && (
            <a
              className="elum-btn elum-btn--secondary elum-btn--sm"
              href={card.actionUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                // Opens the document in Write already signed in; Write checks access itself.
                e.preventDefault();
                mark({ read: true });
                void openElsewhere(card.actionUrl!, true);
              }}
            >
              {card.actionLabel ?? 'Open'}
            </a>
          )}
          {!card.archivedAt ? (
            <button type="button" className="icon-btn" aria-label="Archive" data-tip="Archive" onClick={() => mark({ read: true, archived: true })}>
              <ArchiveIcon size={16} strokeWidth={1.75} />
            </button>
          ) : (
            <button type="button" className="elum-btn elum-btn--quiet elum-btn--sm" onClick={() => mark({ archived: false })}>
              Move to inbox
            </button>
          )}
        </span>
      </span>
      {!card.readAt && <span className="thread-row__dot card-row__dot" aria-label="Unread" />}
    </div>
  );
}
