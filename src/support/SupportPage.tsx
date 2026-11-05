import { ArrowLeft, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, errorMessage, type SupportSummary, type SupportThread } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { Loader } from '../components/Loader';
import { PersonAvatar } from '../components/PersonAvatar';
import { useToast } from '../components/Toast';
import { useMediaQuery } from '../lib/hooks';
import { formatFull, formatWhen } from '../lib/time';
import { linkify } from '../lib/sanitize';
import { ElumSupportMark, ElumSupportName } from './ElumSupportMark';
import { openStartSupport } from './supportStart';
import '../thread/thread.css';
import './support.css';

/** How often an open conversation checks for ELUM Support's answer. */
const POLL_MS = 8000;

const STATUS: Record<SupportSummary['status'], string> = { new: 'Waiting for ELUM Support', open: 'Open', done: 'Closed' };

/** Conversations with ELUM Support: the list, and the open one as a chat. */
export function SupportPage() {
  const { id } = useParams<{ id?: string }>();
  const phone = useMediaQuery('(max-width: 860px)');
  const [list, setList] = useState<SupportSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!api.support) return;
    try {
      setList(await api.support.list());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    void loadList();
    const t = window.setInterval(() => document.visibilityState === 'visible' && void loadList(), POLL_MS * 3);
    return () => window.clearInterval(t);
  }, [loadList]);

  const showList = !phone || !id;
  return (
    <div className="support" data-open={id ? true : undefined}>
      {showList && (
        <section className="support__list" aria-label="Conversations with ELUM Support">
          <header className="support__list-head">
            <h1 className="support__heading">
              <ElumSupportName />
            </h1>
            <button type="button" className="elum-btn elum-btn--primary elum-btn--sm" onClick={openStartSupport}>
              <Plus size={16} strokeWidth={2} /> New
            </button>
          </header>
          {error && <p className="support__error">{error}</p>}
          {!list && !error && <Loader size={32} label="Opening your conversations" />}
          {list && list.length === 0 && (
            <div className="support__empty">
              <ElumSupportMark size={56} />
              <p>Questions about ELUM? Write to the ELUM team here, like any other message.</p>
              <button type="button" className="elum-btn elum-btn--primary" onClick={openStartSupport}>
                Message ELUM Support
              </button>
            </div>
          )}
          {list && list.length > 0 && (
            <ul className="support__items">
              {list.map((s) => (
                <li key={s.id}>
                  <Link className="support-row" to={`/support/${s.id}`} aria-current={s.id === id ? 'page' : undefined} data-unread={s.unread || undefined}>
                    <ElumSupportMark size={36} />
                    <span className="support-row__text">
                      <span className="support-row__top">
                        <span className="support-row__title">{s.title}</span>
                        <time dateTime={s.lastAt} title={formatFull(s.lastAt)}>
                          {formatWhen(s.lastAt)}
                        </time>
                      </span>
                      <span className="support-row__line">
                        <span className="support-row__status" data-status={s.status}>
                          {STATUS[s.status]}
                        </span>
                        {s.snippet && <span className="support-row__snippet">{s.snippet}</span>}
                      </span>
                    </span>
                    {s.unread && <span className="thread-row__dot" aria-label="New answer" />}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {id ? (
        <SupportChat key={id} id={id} onChanged={loadList} back={phone} />
      ) : (
        !phone && (
          <div className="support__placeholder">
            <ElumSupportMark size={64} />
            <p className="muted">Choose a conversation, or start a new one.</p>
          </div>
        )
      )}
    </div>
  );
}

/** One conversation with ELUM Support, as a chat. */
function SupportChat({ id, onChanged, back }: { id: string; onChanged: () => void; back: boolean }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [thread, setThread] = useState<SupportThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const count = thread?.messages.length ?? 0;

  const load = useCallback(async () => {
    try {
      const t = await api.support!.get(id);
      setThread((old) => (old && old.messages.length === t.messages.length && old.status === t.status ? old : t));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [id]);

  useEffect(() => {
    void load().then(onChanged);
    const t = window.setInterval(() => document.visibilityState === 'visible' && void load(), POLL_MS);
    return () => window.clearInterval(t);
  }, [load, onChanged]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      setThread(await api.support!.send(id, body));
      setText('');
      onChanged();
    } catch (e) {
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  if (error && !thread) {
    return (
      <section className="support-chat support-chat--empty">
        <p>{error}</p>
        <button type="button" className="elum-btn elum-btn--secondary" onClick={() => navigate('/support')}>
          Back to ELUM Support
        </button>
      </section>
    );
  }
  if (!thread) {
    return (
      <section className="support-chat support-chat--empty">
        <Loader size={40} label="Opening the conversation" />
      </section>
    );
  }

  return (
    <section className="support-chat" aria-label={`Conversation with ELUM Support: ${thread.title}`}>
      <header className="support-chat__head">
        {back && (
          <Link to="/support" className="icon-btn" aria-label="Back to conversations">
            <ArrowLeft size={18} strokeWidth={1.75} />
          </Link>
        )}
        <ElumSupportMark size={40} />
        <div className="support-chat__who">
          <ElumSupportName as="h2" />
          <span className="support-chat__title">{thread.title}</span>
        </div>
        <span className="support-row__status" data-status={thread.status}>
          {STATUS[thread.status]}
        </span>
      </header>

      <div className="support-chat__messages" aria-live="polite">
        {thread.messages.length === 0 && (
          <p className="support-chat__hint">Write your first message below. The ELUM team answers here, and Type lets you know.</p>
        )}
        {thread.messages.map((m) => (
          <div key={m.id} className="bubble-row" data-mine={!m.fromStaff || undefined}>
            {m.fromStaff && (
              <span className="bubble-row__avatar">
                <ElumSupportMark size={32} />
              </span>
            )}
            <div className="bubble-row__body">
              {m.fromStaff && (
                <span className="bubble__author">
                  <ElumSupportName />
                  {m.author && <span className="support-chat__agent"> · {m.author}</span>}
                </span>
              )}
              <div className="bubble">
                <div className="bubble__text" data-plain dangerouslySetInnerHTML={{ __html: linkify(m.body) }} />
              </div>
              <span className="bubble__meta">
                <time dateTime={m.createdAt} title={formatFull(m.createdAt)}>
                  {formatWhen(m.createdAt)}
                </time>
              </span>
            </div>
            {!m.fromStaff && user && (
              <span className="bubble-row__avatar support-chat__me">
                <PersonAvatar person={{ address: user.email, name: user.name, isElum: true, color: user.color }} size={32} />
              </span>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      <form
        className="support-chat__compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="support-chat__box">
          <label htmlFor="support-message" className="visually-hidden">
            Message to ELUM Support
          </label>
          <textarea
            id="support-message"
            className="support-chat__input"
            rows={2}
            maxLength={5000}
            placeholder="Write a message"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey) && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button type="submit" className="elum-btn elum-btn--primary" disabled={sending || !text.trim()}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
        <p className="support-chat__note">
          <ElumSupportMark size={16} /> You are messaging an official representative from ELUM.
        </p>
      </form>
    </section>
  );
}
