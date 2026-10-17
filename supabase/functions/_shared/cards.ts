/**
 * Turns a platform event into a Type inbox card (handoff 8.5). Plain TypeScript, tested with vitest.
 */

/** A row from public.elum_claim_deliveries. */
export interface Delivery {
  event_id: number;
  attempts: number;
  type: string;
  actor_id: string | null;
  recipient_id: string | null;
  recipient_address: string | null;
  subject: string | null;
  payload: Record<string, unknown> & { notification?: { title?: string; body?: string; link?: string } };
  created_at: string;
  channel: 'email' | 'type_inbox';
}

export interface Card {
  service: string;
  title: string;
  body: string | null;
  actionLabel: string | null;
  actionUrl: string | null;
}

const NAMES: Record<string, string> = { write: 'Write', browse: 'Browse', make: 'Make', store: 'Store' };

/**
 * The card for an event, or null when it does not belong in a Type inbox: the recipient is not a
 * Type account, there is no account yet (invites), or the event has nothing to show.
 */
export function cardFor(row: Delivery, serviceUrls: Record<string, string>): Card | null {
  if (row.channel !== 'type_inbox' || !row.recipient_id) return null;
  const service = row.type.split('.')[0];
  if (!NAMES[service]) return null;
  const note = row.payload.notification;
  if (!note?.title) return null;
  const link = note.link ?? null;
  const base = serviceUrls[service];
  const actionUrl = link ? (/^https?:\/\//.test(link) ? link : base ? `${base}${link.startsWith('/') ? '' : '/'}${link}` : null) : null;
  return {
    service,
    title: note.title.slice(0, 200),
    body: note.body?.slice(0, 1000) ?? null,
    actionLabel: actionUrl ? `Open in ${NAMES[service]}` : null,
    actionUrl,
  };
}
