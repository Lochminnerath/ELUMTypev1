import { Maximize2, X } from 'lucide-react';
import { AttachIcon, SendIcon } from '../components/icons/ElumIcons';
import { ReplyAllIcon } from '../components/icons/ElumIcons';
import { useRef, useState } from 'react';
import { errorMessage, isApiError, type Address, type Message, type Thread } from '../api';
import { displayName, replySubject } from '../api/validation';
import { SaveStatus } from '../compose/Compose';
import { useDraft } from '../compose/useDraft';
import { Loader } from '../components/Loader';
import { useToast } from '../components/Toast';
import { formatBytes } from '../lib/format';
import { useType } from '../state/TypeProvider';

const ICON = { size: 18, strokeWidth: 1.75 };

/**
 * The reply dock: a floating glass bar under the conversation, like Write's formatting dock
 * (handoff 8.2). In ELUM conversations Enter sends; in email, Ctrl+Enter. The full composer is one
 * click away for Cc, Bcc and formatting.
 */
export function ReplyDock({
  thread,
  recipients,
  onSent,
  canEmail,
}: {
  thread: Thread;
  recipients: (m: Message, all: boolean) => { to: Address[]; cc: Address[] };
  onSent: () => void;
  canEmail: boolean;
}) {
  const { openCompose } = useType();
  const toast = useToast();
  const last = [...thread.messages].reverse().find((m) => !m.auto) ?? thread.messages[thread.messages.length - 1];
  const isEmail = thread.kind === 'email';
  const [all, setAll] = useState(true);
  const target = last ? recipients(last, all) : { to: [], cc: [] };
  const [draftId] = useState(() => crypto.randomUUID());
  const d = useDraft({
    id: draftId,
    mailboxId: thread.me.mailboxId,
    threadId: thread.id,
    to: target.to,
    cc: target.cc,
    bcc: [],
    subject: isEmail ? replySubject(last?.subject ?? thread.subject) : '',
    text: '',
    html: null,
  });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const multi = target.to.length + target.cc.length > 1 || (last && !last.mine && last.to.length + last.cc.length > 1);
  const outside = [...target.to, ...target.cc].some((a) => !thread.participants.find((p) => p.address === a.address)?.isElum);

  const send = async () => {
    if (!d.draft.text.trim() && !d.attachments.length) return;
    if (outside && !canEmail) {
      setError('Get an ELUM address to email people outside ELUM.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      // The recipients follow the latest message when the reply goes out.
      await d.send({ to: target.to, cc: target.cc });
      onSent();
    } catch (e) {
      setError(errorMessage(e));
      toast(errorMessage(e), { tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const toLabel = [...target.to, ...target.cc].map(displayName).join(', ');

  return (
    <div className="dock-wrap">
      {error && (
        <p className="dock__error" role="alert">
          {error}
        </p>
      )}
      {d.attachments.length > 0 && (
        <ul className="attachment-list dock__files" aria-label="Attachments">
          {d.attachments.map((a) => (
            <li key={a.id} className="attachment-chip">
              <AttachIcon size={14} strokeWidth={2} aria-hidden="true" />
              <span className="attachment-chip__name">{a.name}</span>
              <span className="attachment-chip__size">{formatBytes(a.bytes)}</span>
              <button type="button" className="address-chip__remove" aria-label={`Remove ${a.name}`} onClick={() => void d.removeAttachment(a)}>
                <X size={12} strokeWidth={2.25} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="dock"
        aria-label="Reply"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        {isEmail && multi && (
          <button
            type="button"
            className="icon-btn icon-btn--round"
            aria-pressed={all}
            aria-label={all ? 'Replying to everyone' : 'Replying to the sender only'}
            data-tip={all ? 'Reply all' : 'Reply to sender'}
            onClick={() => setAll((v) => !v)}
          >
            <ReplyAllIcon {...ICON} />
          </button>
        )}
        <label htmlFor="dock-text" className="visually-hidden">
          Reply to {toLabel}
        </label>
        <textarea
          id="dock-text"
          className="dock__input"
          rows={1}
          placeholder={toLabel ? `Reply to ${toLabel}` : 'Write a reply'}
          value={d.draft.text}
          onChange={(e) => {
            d.update({ text: e.target.value, html: null, to: target.to, cc: target.cc });
            e.target.style.height = '';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`;
          }}
          onKeyDown={(e) => {
            const chat = !isEmail && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing;
            if (chat || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <SaveStatus state={d.state === 'saved' ? 'idle' : d.state} />
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length) d.attach(files).catch((err) => setError(isApiError(err) ? err.message : 'That file could not be attached.'));
          }}
        />
        <button type="button" className="icon-btn icon-btn--round" aria-label="Attach files" data-tip="Attach files" onClick={() => fileRef.current?.click()}>
          <AttachIcon {...ICON} />
        </button>
        <button
          type="button"
          className="icon-btn icon-btn--round"
          aria-label="Open in the full editor"
          data-tip="Full editor"
          onClick={() => {
            void d.save().then(() =>
              openCompose({ draft: { ...d.draft, to: target.to, cc: target.cc }, version: d.version.current, attachments: d.attachments }),
            );
          }}
        >
          <Maximize2 {...ICON} />
        </button>
        <button type="submit" className="elum-btn elum-btn--product dock__send" disabled={sending || (!d.draft.text.trim() && !d.attachments.length)}>
          {sending ? <Loader size={18} label="Sending" /> : <SendIcon {...ICON} />}
          <span className="dock__send-label">Send</span>
        </button>
      </form>
    </div>
  );
}
