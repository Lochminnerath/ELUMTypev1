import { AtSign, ExternalLink } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage, isApiError, type Mailbox } from '../api';
import { useAuth, useUser } from '../auth/AuthProvider';
import { useToast } from '../components/Toast';
import { useType } from '../state/TypeProvider';
import './pages.css';

const ACCOUNT_URL = 'https://account.elum.example';

/** Signature, sending address, images, vacation reply and links to the ELUM account (handoff 8.2). */
export function SettingsPage() {
  const user = useUser();
  const { updateName } = useAuth();
  const { start, setPreferences, setMailbox, defaultMailbox, clearPendingRecovery } = useType();
  const toast = useToast();
  const prefs = start!.preferences;
  const [name, setName] = useState(user.name);
  const [vacation, setVacation] = useState({
    on: prefs.vacationOn,
    subject: prefs.vacationSubject ?? '',
    body: prefs.vacationBody ?? '',
    until: prefs.vacationUntil?.slice(0, 10) ?? '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => setName(user.name), [user.name]);

  const savePrefs = async (patch: Parameters<typeof api.updatePreferences>[0], message = 'Settings saved') => {
    setBusy(true);
    try {
      setPreferences(await api.updatePreferences(patch, prefs.version));
      toast(message, { tone: 'success' });
    } catch (e) {
      if (isApiError(e, 'conflict')) toast('Your settings changed on another device. Reload to see them.', { tone: 'error' });
      else toast(errorMessage(e), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateName(name);
      toast('Name saved', { tone: 'success' });
    } catch (err) {
      toast(errorMessage(err), { tone: 'error' });
    }
  };

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Settings</h1>
        <p className="muted">These apply to Type. Your name, password and addresses belong to your ELUM account.</p>
      </header>

      <section className="settings-section" aria-labelledby="s-profile">
        <h2 id="s-profile" className="settings-section__title">You</h2>
        <form className="settings-row" onSubmit={saveName}>
          <div className="field">
            <label htmlFor="s-name">Name</label>
            <input id="s-name" className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
            <span className="muted settings-hint">How people see you in every ELUM app.</span>
          </div>
          <button type="submit" className="elum-btn elum-btn--secondary elum-btn--sm" disabled={!name.trim() || name === user.name}>
            Save
          </button>
        </form>
      </section>

      {start!.pendingRecovery && <RecoveryCode address={start!.pendingRecovery} onDone={clearPendingRecovery} />}

      <section className="settings-section" aria-labelledby="s-addresses">
        <h2 id="s-addresses" className="settings-section__title">Your addresses</h2>
        {start!.mailboxes.map((m) => (
          <MailboxSettings key={m.id} mailbox={m} isDefault={m.id === defaultMailbox?.id} onSaved={setMailbox} />
        ))}
        {start!.mailboxes.length > 1 && (
          <div className="field">
            <label htmlFor="s-default">Send from</label>
            <select id="s-default" className="select" value={defaultMailbox?.id} disabled={busy} onChange={(e) => void savePrefs({ defaultMailbox: e.target.value })}>
              {start!.mailboxes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.address}
                </option>
              ))}
            </select>
          </div>
        )}
        {!start!.mailboxes.some((m) => m.canEmail) && (
          <div className="settings-callout">
            <AtSign size={18} strokeWidth={1.75} aria-hidden="true" />
            <div>
              <strong>Get an ELUM address</strong>
              <p className="muted">
                You sign in with {user.email}, so you can message anyone on ELUM. To email people outside ELUM from Type, add an address on {start!.typeDomain}.
                Your current address stays as a way to sign in and recover your account.
              </p>
              <a className="elum-btn elum-btn--secondary elum-btn--sm" href={`${ACCOUNT_URL}/addresses`} target="_blank" rel="noopener noreferrer">
                Get an ELUM address <ExternalLink size={14} strokeWidth={1.75} />
              </a>
            </div>
          </div>
        )}
      </section>

      <section className="settings-section" aria-labelledby="s-images">
        <h2 id="s-images" className="settings-section__title">Images in email</h2>
        <p className="muted settings-hint">
          Senders can use images to see when you open their email. We hide them until you choose to see them.
        </p>
        <div className="segmented" role="group" aria-label="Images in email">
          <button type="button" aria-pressed={prefs.loadImages === 'ask'} disabled={busy} onClick={() => void savePrefs({ loadImages: 'ask' })}>
            Ask first
          </button>
          <button type="button" aria-pressed={prefs.loadImages === 'always'} disabled={busy} onClick={() => void savePrefs({ loadImages: 'always' })}>
            Always show
          </button>
        </div>
        {start!.imageSenders.length > 0 && <p className="muted settings-hint">Always shown from: {start!.imageSenders.join(', ')}</p>}
      </section>

      <section className="settings-section" aria-labelledby="s-vacation">
        <h2 id="s-vacation" className="settings-section__title">Away reply</h2>
        <label className="switch-row">
          <span>
            <strong>Reply while I am away</strong>
            <span className="muted settings-hint">Each person gets one reply every four days. Lists and automatic mail get none.</span>
          </span>
          <input type="checkbox" className="switch" role="switch" checked={vacation.on} onChange={(e) => setVacation((v) => ({ ...v, on: e.target.checked }))} />
        </label>
        <div className="field">
          <label htmlFor="s-vsubject">Subject</label>
          <input id="s-vsubject" className="input" placeholder="Away: your message" value={vacation.subject} maxLength={200} onChange={(e) => setVacation((v) => ({ ...v, subject: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="s-vbody">Message</label>
          <textarea id="s-vbody" className="input textarea" rows={4} maxLength={4000} placeholder="I am away until Monday and will reply then." value={vacation.body} onChange={(e) => setVacation((v) => ({ ...v, body: e.target.value }))} />
        </div>
        <div className="field">
          <label htmlFor="s-vuntil">Until (optional)</label>
          <input id="s-vuntil" className="input" type="date" value={vacation.until} onChange={(e) => setVacation((v) => ({ ...v, until: e.target.value }))} />
        </div>
        <button
          type="button"
          className="elum-btn elum-btn--primary elum-btn--sm"
          disabled={busy}
          onClick={() =>
            void savePrefs(
              {
                vacationOn: vacation.on,
                vacationSubject: vacation.subject,
                vacationBody: vacation.body,
                vacationUntil: vacation.until ? new Date(`${vacation.until}T23:59:59`).toISOString() : null,
              },
              vacation.on ? 'Away reply is on' : 'Away reply is off',
            )
          }
        >
          Save away reply
        </button>
      </section>

      <section className="settings-section" aria-labelledby="s-account">
        <h2 id="s-account" className="settings-section__title">Your ELUM account</h2>
        <p className="muted settings-hint">Password, recovery, which notifications reach you, and deleting your account. One account for Write, Type and the rest.</p>
        <a className="elum-btn elum-btn--secondary elum-btn--sm" href={ACCOUNT_URL} target="_blank" rel="noopener noreferrer">
          Open your ELUM account <ExternalLink size={14} strokeWidth={1.75} />
        </a>
      </section>
    </div>
  );
}

function MailboxSettings({ mailbox, isDefault, onSaved }: { mailbox: Mailbox; isDefault: boolean; onSaved: (m: Mailbox) => void }) {
  const toast = useToast();
  const [signature, setSignature] = useState(mailbox.signature ?? '');
  const [displayName, setDisplayName] = useState(mailbox.displayName);
  const changed = signature !== (mailbox.signature ?? '') || displayName !== mailbox.displayName;
  return (
    <form
      className="mailbox-settings"
      onSubmit={(e) => {
        e.preventDefault();
        api.updateMailbox(mailbox.id, { displayName, signature }).then(
          (m) => {
            onSaved(m);
            toast('Saved', { tone: 'success' });
          },
          (err) => toast(errorMessage(err), { tone: 'error' }),
        );
      }}
    >
      <p className="mailbox-settings__address mono">
        {mailbox.address}
        {isDefault && <span className="badge">Sends by default</span>}
        {!mailbox.canEmail && <span className="badge" data-kind="elum">ELUM people only</span>}
      </p>
      <div className="field">
        <label htmlFor={`dn-${mailbox.id}`}>Name on messages</label>
        <input id={`dn-${mailbox.id}`} className="input" value={displayName} maxLength={80} onChange={(e) => setDisplayName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`sig-${mailbox.id}`}>Email signature</label>
        <textarea id={`sig-${mailbox.id}`} className="input textarea" rows={3} maxLength={2000} value={signature} onChange={(e) => setSignature(e.target.value)} />
        <span className="muted settings-hint">Added under emails to people outside ELUM.</span>
      </div>
      <button type="submit" className="elum-btn elum-btn--secondary elum-btn--sm" disabled={!changed || !displayName.trim()}>
        Save
      </button>
    </form>
  );
}

/** The code we emailed to a new recovery address (handoff 3.4). */
function RecoveryCode({ address, onDone }: { address: string; onDone: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="settings-section settings-section--notice" aria-labelledby="s-recovery">
      <h2 id="s-recovery" className="settings-section__title">Confirm your recovery email</h2>
      <p className="muted settings-hint">We sent a 6-digit code to {address}. It is how you get back in if you forget your password.</p>
      <form
        className="settings-row"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          api.confirmRecovery(code).then(
            () => {
              toast(`${address} is your recovery email`, { tone: 'success' });
              onDone();
            },
            (err) => {
              setError(errorMessage(err));
              setBusy(false);
            },
          );
        }}
      >
        <div className="field">
          <label htmlFor="s-code">Code</label>
          <input
            id="s-code"
            className="input mono"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            aria-invalid={error ? true : undefined}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
          {error && <span className="field-error">{error}</span>}
        </div>
        <button type="submit" className="elum-btn elum-btn--primary elum-btn--sm" disabled={busy || code.length !== 6}>
          Confirm
        </button>
      </form>
      <button
        type="button"
        className="elum-btn elum-btn--quiet elum-btn--sm"
        onClick={() => api.resendRecovery().then(() => toast('We sent a new code'), (err) => toast(errorMessage(err), { tone: 'error' }))}
      >
        Send a new code
      </button>
    </section>
  );
}
