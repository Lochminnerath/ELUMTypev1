import { useEffect, useState } from 'react';
import { api } from '../api';
import { STATUS_PAGE, type ServiceState } from '../lib/platform';
import './ServiceBanner.css';

const CHECK_MS = 5 * 60 * 1000;
const seenKey = 'elum.banner.closed';

/**
 * What the ELUM team wants people to know, set in the ELUM Console: a notice, an incident, read
 * only while something is fixed, or a maintenance screen in place of the app. Checks when the app
 * opens, and every five minutes while it is in front.
 */
export function ServiceBanner({ service }: { service: string }) {
  const [state, setState] = useState<ServiceState | null>(null);
  const [closed, setClosed] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(seenKey);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let live = true;
    const check = () =>
      api.serviceState?.(service).then(
        (s) => live && setState(s),
        () => undefined,
      );
    void check();
    const t = window.setInterval(() => document.visibilityState === 'visible' && void check(), CHECK_MS);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, [service]);

  if (!state) return null;

  if (state.mode === 'maintenance') {
    return (
      <div className="service-veil" role="alertdialog" aria-modal="true" aria-labelledby="service-veil-title">
        <div className="service-veil__card">
          <img className="theme-light-only" src="/brand/logos/elum-mark.svg" width={56} height={56} alt="" />
          <img className="theme-dark-only" src="/brand/logos/elum-mark-reversed.svg" width={56} height={56} alt="" />
          <h1 id="service-veil-title">Back soon</h1>
          <p>{state.message || 'We are making this app better. Everything you saved is safe.'}</p>
          <a href={STATUS_PAGE} target="_blank" rel="noreferrer">
            ELUM status
          </a>
        </div>
      </div>
    );
  }

  const incident = state.incidents[0];
  const text = incident ? `${incident.title}${incident.message ? `. ${incident.message}` : ''}` : state.mode === 'read_only' ? state.message || 'You can look at everything, but changes are paused for a moment.' : state.mode === 'notice' ? state.message : '';
  if (!text) return null;
  const id = `${state.mode}:${incident?.id ?? ''}:${text}`;
  if (closed === id) return null;
  const tone = incident ? incident.severity : state.mode;

  return (
    <div className="service-banner" data-tone={tone} role="status">
      <span className="service-banner__dot" aria-hidden="true" />
      <span className="service-banner__text">
        {state.mode === 'read_only' && !incident && <strong>Read only right now. </strong>}
        {text}
      </span>
      <a className="service-banner__link" href={STATUS_PAGE} target="_blank" rel="noreferrer">
        Status
      </a>
      <button
        type="button"
        className="service-banner__close"
        aria-label="Hide"
        onClick={() => {
          setClosed(id);
          try {
            sessionStorage.setItem(seenKey, id);
          } catch {
            // Hidden for now only.
          }
        }}
      >
        ×
      </button>
    </div>
  );
}
