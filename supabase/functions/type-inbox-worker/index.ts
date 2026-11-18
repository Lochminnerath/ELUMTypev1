// Type's consumer of platform events (handoff 6.2 and 8.5). Claims deliveries for 'type-inbox':
//   - shares from every ELUM app (and write.* events) for Type accounts become inbox cards ("Ola shared “Field notes” with you",
//     with Open in Write); Write already skipped their email.
//   - elum.account.deleted removes what Type holds for that account.
// Every handler is idempotent (cards are unique per event), because a lease can expire mid-work.
//
// Runs every minute from pg_cron with "Authorization: Bearer <CRON_SECRET>".
// Secrets: CRON_SECRET, and ELUM_WRITE_URL (such as https://writebyelum.netlify.app) for card links.
// Switch the consumer on once this is deployed: update elum.consumers set active = true where id = 'type-inbox';

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { fail, hasSecret, ok } from '../_shared/http.ts';
import { cardFor, type Delivery } from '../_shared/cards.ts';

const CONSUMER = 'type-inbox';

Deno.serve(async (req) => {
  if (!hasSecret(req, Deno.env.get('CRON_SECRET'))) return fail('unauthorized', 'Not allowed.');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const url = (name: string, fallback: string) => (Deno.env.get(name) ?? fallback).replace(/\/+$/, '');
  // Where each app lives, for the card's Open button. Overridable with ELUM_<APP>_URL secrets.
  const urls = {
    write: url('ELUM_WRITE_URL', 'https://writebyelum.netlify.app'),
    make: url('ELUM_MAKE_URL', 'https://makebyelum.netlify.app'),
    inquire: url('ELUM_INQUIRE_URL', 'https://inquirebyelum.netlify.app'),
    capture: url('ELUM_CAPTURE_URL', 'https://capturebyelum.netlify.app'),
    code: url('ELUM_CODE_URL', 'https://codebyelum.netlify.app'),
    tune: url('ELUM_TUNE_URL', 'https://tunebyelum.netlify.app'),
  };

  const claimed = await db.rpc('elum_claim_deliveries', { p_consumer: CONSUMER, p_limit: 50 });
  if (claimed.error) return fail('server', claimed.error.message);
  const counts = { done: 0, skipped: 0, retry: 0 };
  for (const row of (claimed.data ?? []) as Delivery[]) {
    const status = await handle(db, row, urls).catch((e) => ({ status: 'retry' as const, error: e instanceof Error ? e.message : String(e) }));
    await db.rpc('elum_finish_delivery', { p_consumer: CONSUMER, p_event: row.event_id, p_status: status.status, p_error: 'error' in status ? status.error : null });
    counts[status.status]++;
  }
  return ok(counts);
});

async function handle(db: SupabaseClient, row: Delivery, urls: Record<string, string>): Promise<{ status: 'done' | 'skipped' } | { status: 'retry'; error: string }> {
  if (row.type === 'elum.account.deleted') {
    if (!row.recipient_id) return { status: 'skipped' };
    const { error } = await db.rpc('type_forget_account', { p_account: row.recipient_id });
    return error ? { status: 'retry', error: error.message } : { status: 'done' };
  }
  const card = cardFor(row, urls);
  if (!card) return { status: 'skipped' };
  const { error } = await db.rpc('type_add_card', {
    p_event: row.event_id,
    p_account: row.recipient_id,
    p_service: card.service,
    p_title: card.title,
    p_body: card.body,
    p_action_label: card.actionLabel,
    p_action_url: card.actionUrl,
    p_actor: row.actor_id,
  });
  return error ? { status: 'retry', error: error.message } : { status: 'done' };
}
