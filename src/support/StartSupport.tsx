import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, errorMessage } from '../api';
import { Dialog } from '../components/Dialog';
import { ElumSupportMark } from './ElumSupportMark';
import { START_SUPPORT_EVENT } from './supportStart';

/**
 * Starts a conversation with ELUM Support. There is no form: a short title, and the conversation
 * opens, ready for the first message.
 */
export function StartSupport() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const show = () => {
      setTitle('');
      setError(null);
      setOpen(true);
    };
    window.addEventListener(START_SUPPORT_EVENT, show);
    return () => window.removeEventListener(START_SUPPORT_EVENT, show);
  }, []);

  if (!api.support) return null;

  const start = async () => {
    if (title.trim().length < 3) {
      setError('Give your conversation a short title.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const thread = await api.support!.start(title);
      setOpen(false);
      navigate(`/support/${thread.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => setOpen(false)}
      icon={<ElumSupportMark size={28} />}
      title="Message ELUM Support"
      description="Give it a title, then write to the ELUM team like any other message."
      footer={
        <>
          <button type="button" className="elum-btn elum-btn--secondary" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="submit" form="start-support" className="elum-btn elum-btn--primary" disabled={busy}>
            {busy ? 'Starting…' : 'Start conversation'}
          </button>
        </>
      }
    >
      <form
        id="start-support"
        className="field"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <label htmlFor="start-support-title">Title</label>
        <input
            id="start-support-title"
            className="input"
            value={title}
            maxLength={120}
            placeholder="For example: My photos will not upload"
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={!!error || undefined}
            aria-describedby={error ? 'start-support-error' : undefined}
            data-autofocus
          />
        {error && (
          <span id="start-support-error" className="field-error" role="alert">
            {error}
          </span>
        )}
      </form>
    </Dialog>
  );
}
