import { ArrowLeft, Bell, BellOff, ChevronDown, ChevronUp, Ellipsis, ImageOff, ShieldCheck } from 'lucide-react';
import { AttachIcon, WarningIcon } from '../components/icons/ElumIcons';
import { ArchiveIcon, DeleteIcon, DownloadIcon, ForwardIcon, ReplyAllIcon, ReplyIcon, RestoreIcon, SpamIcon, UnreadIcon } from '../components/icons/ElumIcons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage, type Address, type Attachment, type Folder, type Message, type Thread } from '../api';
import { displayName, formatAddress, forwardSubject, replySubject } from '../api/validation';
import { Avatar } from '../components/Avatar';
import { TypeMark } from '../components/Brand';
import { Loader } from '../components/Loader';
import { Menu } from '../components/Menu';
import { useToast } from '../components/Toast';
import { formatBytes, namesOf } from '../lib/format';
import { cleanRichText, linkify } from '../lib/sanitize';
import { formatFull, formatWhen } from '../lib/time';
import { useType } from '../state/TypeProvider';
import { EmailFrame } from './EmailFrame';
import { ReplyDock } from './ReplyDock';
import './thread.css';

const ICON = { size: 18, strokeWidth: 1.75 };

/** One conversation: ELUM messages as bubbles, email as cards, and the reply dock (handoff 8.2). */
export function ThreadView({ threadId, onBack, onChanged }: { threadId: string; onBack: () => void; onChanged: () => void }) {
  const { tick, lastEvent, refreshCounts, openCompose, defaultMailbox, start } = useType();
  const toast = useToast();
  const navigate = useNavigate();
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const count = useRef(0);
  // A new dock (and draft) after each reply.
  const [dock, setDock] = useState(0);

  const load = useCallback(async () => {
    try {
      const t = await api.getThread(threadId);
      setThread(t);
      setError(null);
      const latest = t.messages[t.messages.length - 1];
      if (latest && (!t.me.lastReadAt || latest.createdAt > t.me.lastReadAt) && !latest.mine) {
        await api.markRead(threadId);
        refreshCounts();
        onChanged();
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [threadId, refreshCounts, onChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live: reload when something in this thread changes.
  useEffect(() => {
    if (!lastEvent || tick === 0) return;
    if (lastEvent.kind === 'inbox' || (lastEvent.kind === 'message' && lastEvent.threadId === threadId)) void load();
  }, [tick]);

  useEffect(() => {
    if (thread && thread.messages.length !== count.current) {
      endRef.current?.scrollIntoView({ block: 'end', behavior: count.current ? 'smooth' : 'auto' });
      count.current = thread.messages.length;
    }
  }, [thread]);

  if (error) {
    return (
      <section className="thread thread--empty" aria-label="Conversation">
        <TypeMark size={64} />
        <h2>We could not open this conversation</h2>
        <p className="muted">{error}</p>
        <button type="button" className="elum-btn elum-btn--secondary" onClick={onBack}>
          Back to the inbox
        </button>
      </section>
    );
  }
  if (!thread) {
    return (
      <section className="thread thread--empty" aria-label="Conversation" aria-busy="true">
        <Loader size={40} label="Opening the conversation" />
      </section>
    );
  }

  const others = thread.participants.filter((p) => p.address !== thread.me.address);
  const isEmail = thread.kind === 'email';
  const folder = thread.me.folder;

  const move = async (to: Folder, message: string) => {
    await api.move([thread.id], to);
    onChanged();
    refreshCounts();
    toast(message, { action: { label: 'Undo', onClick: () => void api.move([thread.id], folder).then(() => (onChanged(), void load())) } });
    if (to !== 'inbox') onBack();
    else void load();
  };

  const recipientsFor = (m: Message, all: boolean): { to: Address[]; cc: Address[] } => {
    const me = thread.me.address;
    if (m.mine) return { to: m.to, cc: all ? m.cc : [] };
    if (!all) return { to: [m.from], cc: [] };
    const notMe = (a: Address) => a.address !== me && a.address !== m.from.address;
    return { to: [m.from, ...m.to.filter(notMe)], cc: m.cc.filter(notMe) };
  };

  const reply = (m: Message, all: boolean) => {
    const { to, cc } = recipientsFor(m, all);
    openCompose({
      draft: {
        mailboxId: thread.me.mailboxId,
        threadId: thread.id,
        to,
        cc,
        subject: replySubject(m.subject ?? thread.subject),
      },
    });
  };

  const forward = (m: Message) => {
    const header = [
      '---------- Forwarded message ----------',
      `From: ${formatAddress(m.from)}`,
      `Date: ${formatFull(m.createdAt)}`,
      m.subject ? `Subject: ${m.subject}` : null,
      `To: ${m.to.map(formatAddress).join(', ')}`,
    ]
      .filter(Boolean)
      .join('\n');
    openCompose({
      draft: {
        mailboxId: defaultMailbox?.id,
        subject: forwardSubject(m.subject ?? thread.subject),
        text: `\n\n${header}\n\n${m.text}`,
      },
    });
  };

  return (
    <section className="thread" aria-label={thread.subject ?? `Conversation with ${namesOf(others)}`}>
      <header className="thread__head">
        <button type="button" className="icon-btn icon-btn--round thread__back" aria-label="Back to the list" onClick={onBack}>
          <ArrowLeft {...ICON} />
        </button>
        <div className="thread__titles">
          <h2 className="thread__title">{thread.subject || namesOf(others, 3)}</h2>
          <p className="thread__people">
            <span className="badge" data-kind={thread.kind}>
              {isEmail ? 'Email' : 'From ELUM'}
            </span>
            {others.map((p) => displayName(p)).join(', ') || 'Only you'}
          </p>
        </div>
        <div className="thread__actions">
          {folder === 'inbox' ? (
            <button type="button" className="icon-btn icon-btn--round" aria-label="Archive" data-tip="Archive" onClick={() => void move('archive', 'Archived')}>
              <ArchiveIcon {...ICON} />
            </button>
          ) : (
            <button type="button" className="icon-btn icon-btn--round" aria-label="Move to inbox" data-tip="Move to inbox" onClick={() => void move('inbox', 'Moved to inbox')}>
              <RestoreIcon {...ICON} />
            </button>
          )}
          {folder !== 'trash' && (
            <button type="button" className="icon-btn icon-btn--round" aria-label="Delete" data-tip="Delete" onClick={() => void move('trash', 'Moved to trash')}>
              <DeleteIcon {...ICON} />
            </button>
          )}
          <Menu
            label="More actions"
            placement="bottom-end"
            items={[
              {
                label: 'Mark as unread',
                icon: <UnreadIcon size={16} strokeWidth={1.75} />,
                onSelect: () =>
                  void api.markRead(thread.id, false).then(() => {
                    onChanged();
                    refreshCounts();
                    navigate('/');
                  }),
              },
              thread.me.muted
                ? { label: 'Unmute', icon: <Bell size={16} strokeWidth={1.75} />, onSelect: () => void api.setMuted(thread.id, false).then(load) }
                : { label: 'Mute', hint: 'No notifications for this conversation', icon: <BellOff size={16} strokeWidth={1.75} />, onSelect: () => void api.setMuted(thread.id, true).then(load) },
              folder === 'spam'
                ? { label: 'Not spam', icon: <ShieldCheck size={16} strokeWidth={1.75} />, onSelect: () => void move('inbox', 'Moved to inbox') }
                : { label: 'Report spam', icon: <SpamIcon size={16} strokeWidth={1.75} />, onSelect: () => void move('spam', 'Moved to spam') },
            ]}
            trigger={(props) => (
              <button type="button" className="icon-btn icon-btn--round" aria-label="More actions" data-tip="More" {...props}>
                <Ellipsis {...ICON} />
              </button>
            )}
          />
        </div>
      </header>

      <div className="thread__scroll">
        <ol className="thread__messages" data-kind={thread.kind}>
          {thread.messages.map((m, i) => {
            const prev = thread.messages[i - 1];
            const grouped = !isEmail && prev && prev.from.address === m.from.address && Date.parse(m.createdAt) - Date.parse(prev.createdAt) < 5 * 60_000;
            const next = thread.messages[i + 1];
            const lastInGroup = !next || next.from.address !== m.from.address || Date.parse(next.createdAt) - Date.parse(m.createdAt) >= 5 * 60_000;
            return (
              <li key={m.id}>
                {isEmail ? (
                  <EmailCard
                    message={m}
                    collapsed={i < thread.messages.length - 3}
                    onReply={() => reply(m, false)}
                    onReplyAll={() => reply(m, true)}
                    onForward={() => forward(m)}
                  />
                ) : (
                  <Bubble message={m} grouped={!!grouped} showMeta={lastInGroup} onForward={() => forward(m)} />
                )}
              </li>
            );
          })}
        </ol>
        <div ref={endRef} />
      </div>

      <ReplyDock
        key={dock}
        thread={thread}
        recipients={recipientsFor}
        onSent={() => {
          setDock((n) => n + 1);
          void load().then(onChanged);
        }}
        canEmail={(start?.mailboxes.find((x) => x.id === thread.me.mailboxId)?.canEmail) ?? false} />
    </section>
  );
}

function StatusLine({ message }: { message: Message }) {
  if (!message.mine) return null;
  if (message.failed.length) {
    return (
      <span className="msg-status msg-status--failed">
        <WarningIcon size={14} strokeWidth={2} aria-hidden="true" />
        Not delivered to {message.failed.join(', ')}
      </span>
    );
  }
  const label = message.status === 'queued' ? 'Sending' : message.status === 'delivered' ? 'Delivered' : 'Sent';
  return <span className="msg-status">{message.status === 'queued' ? <Loader size={14} label="Sending" /> : null}{label}</span>;
}

/** An ELUM message as a bubble: yours on the right in mint, theirs on the left on paper. */
function Bubble({ message: m, grouped, showMeta, onForward }: { message: Message; grouped: boolean; showMeta: boolean; onForward: () => void }) {
  const body = m.html ? cleanRichText(m.html) : linkify(m.text);
  return (
    <div className="bubble-row" data-mine={m.mine || undefined} data-grouped={grouped || undefined}>
      {!m.mine && (
        <span className="bubble-row__avatar">{!grouped && <Avatar user={{ name: displayName(m.from), color: m.from.color ?? null }} size={32} />}</span>
      )}
      <div className="bubble-row__body">
        {!m.mine && !grouped && <span className="bubble__author">{displayName(m.from)}</span>}
        <div className="bubble" data-auto={m.auto || undefined}>
          {m.auto && <span className="bubble__auto">Automatic reply</span>}
          {m.subject && !grouped && <strong className="bubble__subject">{m.subject}</strong>}
          <div className="bubble__text" data-plain={!m.html || undefined} dangerouslySetInnerHTML={{ __html: body }} />
          <Attachments list={m.attachments} />
        </div>
        {showMeta && (
          <span className="bubble__meta">
            <time dateTime={m.createdAt} title={formatFull(m.createdAt)}>
              {formatWhen(m.createdAt)}
            </time>
            <StatusLine message={m} />
            <button type="button" className="bubble__action" onClick={onForward}>
              Forward
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

/** An email as a card: sender, recipients, full headers on demand, and the body in a safe frame. */
function EmailCard({
  message: m,
  collapsed: startCollapsed,
  onReply,
  onReplyAll,
  onForward,
}: {
  message: Message;
  collapsed: boolean;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
}) {
  const { imageSenders, allowImages, start } = useType();
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const [details, setDetails] = useState(false);
  const [showOnce, setShowOnce] = useState(false);
  const [blocked, setBlocked] = useState(0);
  const always = start?.preferences.loadImages === 'always' || imageSenders.has(m.from.address);
  const images = always || showOnce || m.mine;
  const recipients = [...m.to, ...m.cc];

  if (collapsed) {
    return (
      <button type="button" className="email-card email-card--collapsed" onClick={() => setCollapsed(false)}>
        <Avatar user={{ name: displayName(m.from), color: m.from.isElum ? m.from.color : null }} size={32} />
        <span className="email-card__from">{displayName(m.from)}</span>
        <span className="email-card__peek">{m.text.slice(0, 120)}</span>
        <time className="email-card__time" dateTime={m.createdAt}>
          {formatWhen(m.createdAt)}
        </time>
      </button>
    );
  }

  return (
    <article className="email-card" aria-label={`From ${displayName(m.from)}`}>
      <header className="email-card__head">
        <Avatar user={{ name: displayName(m.from), color: m.from.isElum ? m.from.color : null }} size={40} />
        <div className="email-card__who">
          <span className="email-card__from">
            {displayName(m.from)}
            {!m.from.isElum && <span className="email-card__address">{m.from.address}</span>}
          </span>
          <span className="email-card__to">
            to {recipients.length ? recipients.map((r) => (r.address === m.from.address ? 'themselves' : displayName(r))).join(', ') : 'you'}
            {m.bcc.length > 0 && <>, Bcc {m.bcc.map(displayName).join(', ')}</>}
            <button type="button" className="email-card__details" aria-expanded={details} onClick={() => setDetails((v) => !v)}>
              {details ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
              <span className="visually-hidden">{details ? 'Hide details' : 'Show details'}</span>
            </button>
          </span>
        </div>
        <time className="email-card__time" dateTime={m.createdAt} title={formatFull(m.createdAt)}>
          {formatWhen(m.createdAt)}
        </time>
        <div className="email-card__actions">
          <button type="button" className="icon-btn" aria-label="Reply" data-tip="Reply" onClick={onReply}>
            <ReplyIcon size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" aria-label="Reply all" data-tip="Reply all" onClick={onReplyAll}>
            <ReplyAllIcon size={16} strokeWidth={1.75} />
          </button>
          <button type="button" className="icon-btn" aria-label="Forward" data-tip="Forward" onClick={onForward}>
            <ForwardIcon size={16} strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {details && (
        <dl className="email-card__headers mono">
          <dt>From</dt>
          <dd>{formatAddress(m.from)}</dd>
          {m.to.length > 0 && (
            <>
              <dt>To</dt>
              <dd>{m.to.map(formatAddress).join(', ')}</dd>
            </>
          )}
          {m.cc.length > 0 && (
            <>
              <dt>Cc</dt>
              <dd>{m.cc.map(formatAddress).join(', ')}</dd>
            </>
          )}
          {m.bcc.length > 0 && (
            <>
              <dt>Bcc</dt>
              <dd>{m.bcc.map(formatAddress).join(', ')}</dd>
            </>
          )}
          <dt>Date</dt>
          <dd>{formatFull(m.createdAt)}</dd>
          {m.subject && (
            <>
              <dt>Subject</dt>
              <dd>{m.subject}</dd>
            </>
          )}
          {m.messageId && (
            <>
              <dt>Message-ID</dt>
              <dd>{m.messageId}</dd>
            </>
          )}
          {Object.entries(m.headers ?? {})
            .filter(([k]) => !['from', 'to', 'cc', 'subject', 'date', 'message-id'].includes(k.toLowerCase()))
            .map(([k, v]) => (
              <span key={k} className="email-card__header-pair">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </span>
            ))}
        </dl>
      )}

      {!images && blocked > 0 && (
        <div className="images-banner" role="note">
          <ImageOff size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>We hid {blocked === 1 ? 'an image' : `${blocked} images`} so the sender cannot tell you opened this.</span>
          <button type="button" className="elum-btn elum-btn--quiet elum-btn--sm" onClick={() => setShowOnce(true)}>
            Show images
          </button>
          <button type="button" className="elum-btn elum-btn--quiet elum-btn--sm" onClick={() => void allowImages(m.from.address, true)}>
            Always from {m.from.address}
          </button>
        </div>
      )}

      <div className="email-card__body">
        {m.auto && <p className="bubble__auto">Automatic reply</p>}
        {m.html ? (
          <EmailFrame html={m.html} allowImages={images} title={`Message from ${displayName(m.from)}`} onBlocked={setBlocked} />
        ) : (
          <div className="email-card__text" dangerouslySetInnerHTML={{ __html: linkify(m.text) }} />
        )}
      </div>
      <Attachments list={m.attachments} />
      <footer className="email-card__foot">
        <StatusLine message={m} />
      </footer>
    </article>
  );
}

function Attachments({ list }: { list: Attachment[] }) {
  if (!list.length) return null;
  return (
    <ul className="attachment-list" aria-label="Attachments">
      {list.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            className="attachment-chip attachment-chip--open"
            onClick={() =>
              void api.attachmentUrl(a).then((url) => {
                const link = document.createElement('a');
                link.href = url;
                link.download = a.name;
                link.rel = 'noopener';
                link.click();
              })
            }
          >
            <AttachIcon size={14} strokeWidth={2} aria-hidden="true" />
            <span className="attachment-chip__name">{a.name}</span>
            <span className="attachment-chip__size">{formatBytes(a.bytes)}</span>
            <DownloadIcon size={14} strokeWidth={2} aria-label="Download" />
          </button>
        </li>
      ))}
    </ul>
  );
}
