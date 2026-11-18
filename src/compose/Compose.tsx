import { Maximize2, Minimize2, X } from 'lucide-react';
import { AttachIcon, OfflineIcon, SavedIcon, SendIcon, ShareIcon, WarningIcon } from '../components/icons/ElumIcons';
import { ShareFromElum, type ChosenItem } from './ShareFromElum';
import { DeleteIcon } from '../components/icons/ElumIcons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage, isApiError, type DraftInput } from '../api';
import { Loader } from '../components/Loader';
import { useToast } from '../components/Toast';
import { useMediaQuery } from '../lib/hooks';
import { formatBytes } from '../lib/format';
import { useType, type ComposeRequest } from '../state/TypeProvider';
import { AddressField, type Recipient } from './AddressField';
import { RichEditor } from './RichEditor';
import { useDraft } from './useDraft';
import { delayedSend } from '../settings/typeSettings';
import './compose.css';

const ICON = { size: 18, strokeWidth: 1.75 };

/**
 * Writing a new message: a floating panel at the bottom right on desktop, a full sheet on phones
 * (handoff 8.3). Saves as you type; Send is the mint pill, once per view.
 */
export function Compose({ request }: { request: ComposeRequest }) {
  const { start, defaultMailbox, closeCompose, openCompose, settings } = useType();
  const toast = useToast();
  const navigate = useNavigate();
  const phone = useMediaQuery('(max-width: 560px)');
  const [minimized, setMinimized] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showCopies, setShowCopies] = useState(!!(request.draft.cc?.length || request.draft.bcc?.length));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  const initial = useMemo<DraftInput>(
    () => ({
      id: request.draft.id ?? crypto.randomUUID(),
      mailboxId: request.draft.mailboxId ?? defaultMailbox!.id,
      threadId: request.draft.threadId ?? null,
      to: request.draft.to ?? [],
      cc: request.draft.cc ?? [],
      bcc: request.draft.bcc ?? [],
      subject: request.draft.subject ?? '',
      text: request.draft.text ?? '',
      html: request.draft.html ?? (request.draft.text ? request.draft.text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!).replace(/\n/g, '<br>') : null),
    }),
    // The request is fixed for this composer (it is keyed by draft id).
    [],
  );
  const d = useDraft(initial, request.version ?? 0, request.attachments ?? []);
  const mailboxes = start?.mailboxes ?? [];
  const from = mailboxes.find((m) => m.id === d.draft.mailboxId) ?? defaultMailbox!;
  const recipients = [...d.draft.to, ...d.draft.cc, ...d.draft.bcc] as Recipient[];
  const [shared, setShared] = useState<ChosenItem[]>([]);
  const [shareOpen, setShareOpen] = useState(false);

  /** Adds things from other ELUM apps: a link in the message now, shared with everyone on Send. */
  const addShared = (items: ChosenItem[]) => {
    const fresh = items.filter((i) => !shared.some((s) => s.app === i.app && s.id === i.id));
    if (!fresh.length) return;
    setShared((list) => [...list, ...fresh]);
    const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const name = (i: ChosenItem) => `ELUM ${i.app.charAt(0).toUpperCase()}${i.app.slice(1)}`;
    const html = fresh.map((i) => `<p><a href="${esc(i.url)}">${esc(i.title)}</a> · ${name(i)}</p>`).join('');
    const text = fresh.map((i) => `${i.title} (${name(i)}): ${i.url}`).join('\n');
    d.update({ html: `${d.draft.html ?? ''}${html}`, text: `${d.draft.text}${d.draft.text ? '\n\n' : ''}${text}` });
  };

  /** Shares each chosen thing with each person on the message, through that app. */
  const shareAll = async (people: string[]) => {
    if (!shared.length || !api.shareItem) return;
    const problems: string[] = [];
    for (const item of shared) {
      for (const email of people) {
        try {
          await api.shareItem(item, email, item.role);
        } catch (e) {
          problems.push(`“${item.title}” with ${email}: ${errorMessage(e)}`);
        }
      }
    }
    if (problems.length) throw new Error(`We could not share ${problems.join('; ')}`);
  };
  const outside = recipients.filter((r) => !r.isElum && !r.address.endsWith(`@${start!.typeDomain}`));

  // Escape minimises rather than throwing words away.
  useEffect(() => {
    const el = panelRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && el?.contains(document.activeElement)) {
        e.preventDefault();
        setMinimized(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const send = async () => {
    if (!recipients.length) {
      setError('Add someone to send to.');
      return;
    }
    if (!d.draft.text.trim() && !d.attachments.length) {
      setError('Write something first.');
      return;
    }
    if (outside.length && !from.canEmail) {
      setError('Get an ELUM address to email people outside ELUM. You can still message ELUM people from this address.');
      return;
    }
    setSending(true);
    setError(null);
    const wait = settings.undoSeconds;
    if (wait > 0) {
      // Keep the draft safe, close, and give a moment to change your mind.
      if (!(await d.save())) {
        setSending(false);
        setError('We could not save the message. Check your connection and try again.');
        return;
      }
      const snapshot = { draft: { ...d.draft }, version: d.version.current, attachments: d.attachments };
      const people = recipients.map((r) => r.address);
      const later = delayedSend(wait, () => shareAll(people).then(() => d.send()));
      closeCompose();
      toast(`Sending in ${wait} seconds`, { duration: wait * 1000, action: { label: 'Undo', onClick: () => later.cancel() } });
      later.done.then(
        (went) => {
          if (!went) openCompose(snapshot);
          else toast('Sent', { tone: 'success' });
        },
        (e) => {
          toast(errorMessage(e), { tone: 'error', cause: e, code: 'send-failed' });
          openCompose(snapshot);
        },
      );
      return;
    }
    try {
      await shareAll(recipients.map((r) => r.address));
      const result = await d.send();
      closeCompose();
      toast(result.status === 'queued' ? 'Sending. Outside email goes out in a moment.' : 'Sent', {
        tone: 'success',
        action: { label: 'View', onClick: () => navigate(`/t/${result.threadId}`) },
      });
    } catch (e) {
      setSending(false);
      setError(errorMessage(e));
    }
  };

  const discard = async () => {
    await d.discard().catch(() => undefined);
    closeCompose();
    toast('Draft discarded');
  };

  const title = d.draft.subject.trim() || (recipients.length ? `To ${recipients.map((r) => r.name || r.address).join(', ')}` : 'New message');

  if (minimized && !phone) {
    return (
      <section className="compose compose--min" aria-label="Message draft">
        <button type="button" className="compose__min-title" onClick={() => setMinimized(false)}>
          {title}
        </button>
        <button type="button" className="icon-btn" aria-label="Close draft" data-tip="Close (the draft is kept)" onClick={() => void d.save().then(closeCompose)}>
          <X {...ICON} />
        </button>
      </section>
    );
  }

  return (
    <section
      ref={panelRef}
      className="compose"
      data-expanded={expanded || undefined}
      data-sheet={phone || undefined}
      role="dialog"
      aria-modal={phone || undefined}
      aria-label="New message"
    >
      <header className="compose__head">
        <h2 className="compose__title">{title}</h2>
        <SaveStatus state={d.state} />
        {!phone && (
          <>
            <button type="button" className="icon-btn" aria-label="Minimise" data-tip="Minimise" onClick={() => setMinimized(true)}>
              <Minimize2 {...ICON} />
            </button>
            <button type="button" className="icon-btn" aria-label={expanded ? 'Smaller' : 'Larger'} data-tip={expanded ? 'Smaller' : 'Larger'} onClick={() => setExpanded((v) => !v)}>
              <Maximize2 {...ICON} />
            </button>
          </>
        )}
        <button type="button" className="icon-btn" aria-label="Close draft" data-tip="Close (the draft is kept)" onClick={() => void d.save().then(closeCompose)}>
          <X {...ICON} />
        </button>
      </header>

      <div className="compose__fields">
        {mailboxes.length > 1 && (
          <div className="compose__from">
            <label htmlFor="compose-from" className="address-field__label">
              From
            </label>
            <select id="compose-from" className="select" value={from.id} onChange={(e) => d.update({ mailboxId: e.target.value })}>
              {mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} &lt;{m.address}&gt;
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="compose__row">
          <AddressField label="To" value={d.draft.to as Recipient[]} onChange={(to) => d.update({ to })} autoFocus={!d.draft.to.length} typeDomain={start!.typeDomain} />
          {!showCopies && (
            <button type="button" className="elum-btn elum-btn--quiet elum-btn--sm compose__copies" onClick={() => setShowCopies(true)}>
              Cc Bcc
            </button>
          )}
        </div>
        {showCopies && (
          <>
            <AddressField label="Cc" value={d.draft.cc as Recipient[]} onChange={(cc) => d.update({ cc })} typeDomain={start!.typeDomain} />
            <AddressField label="Bcc" value={d.draft.bcc as Recipient[]} onChange={(bcc) => d.update({ bcc })} typeDomain={start!.typeDomain} />
          </>
        )}
        <div className="compose__subject">
          <label htmlFor="compose-subject" className="visually-hidden">
            Subject
          </label>
          <input
            id="compose-subject"
            className="compose__subject-input"
            placeholder={outside.length ? 'Subject' : 'Subject (optional between ELUM people)'}
            value={d.draft.subject}
            maxLength={300}
            onChange={(e) => d.update({ subject: e.target.value })}
          />
        </div>
      </div>

      <RichEditor
        html={d.draft.html ?? ''}
        label="Message"
        placeholder="Write your message"
        autoFocus={d.draft.to.length > 0}
        onChange={({ html, text }) => d.update({ html, text })}
        onSubmit={() => void send()}
      />

      {d.attachments.length > 0 && (
        <ul className="attachment-list" aria-label="Attachments">
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

      {shared.length > 0 && (
        <ul className="attachment-list" aria-label="Shared from ELUM">
          {shared.map((item) => (
            <li key={`${item.app}:${item.id}`} className="attachment-chip shared-chip" title={`${item.role === 'editor' ? 'They can edit' : 'They can view'}. Shared when you press Send.`}>
              <img src={`/brand/apps/${item.app}.svg`} alt="" />
              <span className="attachment-chip__name">{item.title}</span>
              <span className="attachment-chip__size">{item.role === 'editor' ? 'Can edit' : 'Can view'}</span>
              <button
                type="button"
                className="address-chip__remove"
                aria-label={`Do not share ${item.title}`}
                onClick={() => setShared((list) => list.filter((x) => !(x.app === item.app && x.id === item.id)))}
              >
                <X size={12} strokeWidth={2.25} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {d.state === 'conflict' && (
        <div className="compose__notice" role="alert">
          <WarningIcon size={16} strokeWidth={2} aria-hidden="true" />
          <span>This draft changed on another device.</span>
          <button type="button" className="elum-btn elum-btn--quiet elum-btn--sm" onClick={d.keepMine}>
            Keep mine
          </button>
          <button type="button" className="elum-btn elum-btn--quiet elum-btn--sm" onClick={() => void d.loadTheirs()}>
            Load theirs
          </button>
        </div>
      )}
      {outside.length > 0 && !from.canEmail && (
        <p className="compose__notice" role="note">
          <WarningIcon size={16} strokeWidth={2} aria-hidden="true" />
          This address reaches ELUM people only. Get an ELUM address to email {outside[0].address}.
        </p>
      )}
      {error && (
        <p className="compose__error" role="alert">
          {error}
        </p>
      )}

      <footer className="compose__foot">
        <button type="button" className="elum-btn elum-btn--product" disabled={sending} onClick={() => void send()}>
          {sending ? <Loader size={20} label="Sending" /> : <SendIcon {...ICON} />}
          Send
        </button>
        <span className="kbd compose__hint">Ctrl+Enter</span>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (!files.length) return;
            d.attach(files).catch((err) => setError(isApiError(err) ? err.message : 'That file could not be attached. Try again.'));
          }}
        />
        <button type="button" className="icon-btn icon-btn--round compose__attach" aria-label="Attach files" data-tip="Attach files" onClick={() => fileRef.current?.click()}>
          <AttachIcon {...ICON} />
        </button>
        {api.shareables && (
          <button type="button" className="icon-btn icon-btn--round" aria-label="Share from ELUM" data-tip="Share from ELUM" onClick={() => setShareOpen(true)}>
            <ShareIcon {...ICON} />
          </button>
        )}
        <button type="button" className="icon-btn icon-btn--round" aria-label="Discard draft" data-tip="Discard draft" onClick={() => void discard()}>
          <DeleteIcon {...ICON} />
        </button>
      </footer>
      <ShareFromElum open={shareOpen} onClose={() => setShareOpen(false)} onAdd={addShared} />
    </section>
  );
}

export function SaveStatus({ state }: { state: ReturnType<typeof useDraft>['state'] }) {
  return (
    <span className="save-status" aria-live="polite">
      {state === 'saving' && (
        <>
          <Loader size={16} label="Saving" />
          <span>Saving</span>
        </>
      )}
      {state === 'saved' && (
        <>
          <SavedIcon size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Draft saved</span>
        </>
      )}
      {state === 'error' && (
        <span className="save-status__error">
          <OfflineIcon size={16} strokeWidth={1.75} aria-hidden="true" />
          Not saved yet. Trying again
        </span>
      )}
    </span>
  );
}
