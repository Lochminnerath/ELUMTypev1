import { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { answerSignIn, pickRequest, signInRequests, type SignInRequest } from './approvals';
import './Approvals.css';

const POLL_MS = 15_000;

/**
 * On a device that is signed in: asks "Is this you signing in?" when a new sign-in waits for
 * approval, with the number the new device shows among two others. Picking the wrong number, or
 * "No, it's not me", ends that sign-in. A sign-in from the same network is marked nearby; it
 * still needs the right number.
 */
export function SignInPrompt({ sb, securityUrl }: { sb: SupabaseClient; securityUrl: string }) {
  const toast = useToast();
  const [request, setRequest] = useState<SignInRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (document.visibilityState !== 'visible') return true;
    const list = await signInRequests(sb);
    if (list === null) return false; // This database has no approvals: stop asking.
    setRequest((current) => pickRequest(list, current?.id));
    return true;
  }, [sb]);

  useEffect(() => {
    let timer = 0;
    let stopped = false;
    const loop = async () => {
      const keep = await check();
      if (!stopped && keep) timer = window.setTimeout(loop, POLL_MS);
    };
    void loop();
    const onVisible = () => document.visibilityState === 'visible' && void check();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  const answer = async (number: number | null) => {
    if (!request) return;
    setBusy(true);
    try {
      const result = await answerSignIn(sb, request.id, number);
      if (result === 'approved') toast(`${request.device} is signed in`, { tone: 'success' });
      else
        toast(number === null ? 'We stopped that sign-in. If it was not you, change your password.' : 'That was not the number, so we stopped that sign-in.', {
          tone: 'error',
          duration: 10000,
        });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'That sign-in is no longer waiting.', { tone: 'error' });
    } finally {
      setBusy(false);
      setRequest(null);
      void check();
    }
  };

  if (!request) return null;
  const when = new Date(request.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <Dialog
      open
      onClose={() => setRequest(null)}
      title="Is this you signing in?"
      description={`${request.device}${request.ip ? `, ${request.ip}` : ''}, at ${when}. Choose the number it shows.`}
      width={440}
      icon={
        <span className="approval-prompt__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
            <path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6l7-3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <circle cx="12" cy="11.5" r="2.6" fill="currentColor" />
          </svg>
        </span>
      }
      footer={
        <button type="button" className="elum-btn elum-btn--secondary approval-prompt__deny" disabled={busy} onClick={() => void answer(null)}>
          No, it's not me
        </button>
      }
    >
      {request.nearby && (
        <p className="approval-prompt__nearby">
          <span className="approval-prompt__nearby-dot" aria-hidden="true" />
          Nearby · on your network
        </p>
      )}
      <div className="approval-prompt__numbers" role="group" aria-label="The number on the new device">
        {request.numbers.map((n) => (
          <button key={n} type="button" className="approval-prompt__number" disabled={busy} onClick={() => void answer(n)}>
            {n}
          </button>
        ))}
      </div>
      <p className="approval-prompt__note">
        Not sure? Choose “No, it's not me”. You can see every device on your <a href={securityUrl}>Security page</a>.
      </p>
    </Dialog>
  );
}
