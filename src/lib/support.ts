import { ApiError } from '../api/errors';

/** Where someone goes when something went wrong. The support form is served by ELUM Inquire. */
const SUPPORT_BASE = 'https://browse.elum.services/app/inquire/f/support';

export const TROUBLESHOOTING_URL = 'https://browse.elum.services/docs/troubleshooting';
export const PASSKEY_TROUBLESHOOTING_URL = `${TROUBLESHOOTING_URL}#passkeys`;

export interface SupportDetails {
  /** A short error code or phrase, such as "signin-failed". */
  code?: string;
  /** What the screen said. Kept to 300 characters. */
  message?: string;
  /** The page path the problem happened on. */
  from?: string;
}

/** A link to the support form with the app and what went wrong filled in. Always the live site. */
export function supportUrl(app: string, details: SupportDetails = {}): string {
  const params = new URLSearchParams();
  params.set('app', app.trim());
  const code = details.code?.trim();
  const message = details.message?.trim().slice(0, 300).trim();
  const from = details.from?.trim();
  if (code) params.set('code', code);
  if (message) params.set('message', message);
  if (from) params.set('from', from);
  return `${SUPPORT_BASE}?${params.toString().replace(/\+/g, '%20')}`;
}

/** Opens the support form in a new tab, for a toast action. */
export function openSupport(app: string, details: SupportDetails = {}): void {
  const from = details.from ?? (typeof window !== 'undefined' ? window.location.pathname : undefined);
  window.open(supportUrl(app, { ...details, from }), '_blank', 'noopener,noreferrer');
}

/**
 * Whether a failure is worth offering support for: the service or the connection failed, or it was
 * something unexpected. Not for things the person can fix themselves (a wrong password, a full field).
 */
export function isSupportable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.code === 'server' || error.code === 'network' || error.code === 'storage_full';
}
