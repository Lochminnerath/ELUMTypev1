// Emails people outside ELUM Type when something is shared with them in an ELUM app (Make,
// Capture, Code, Inquire, Tune). Claims deliveries for the platform's 'email' consumer; Type
// accounts get a card in their Type inbox instead (type-inbox-worker), and Write sends its own.
//
// Runs every minute from pg_cron with "Authorization: Bearer <CRON_SECRET>".
// Secrets: CRON_SECRET, BREVO_API_KEY, SHARE_EMAIL_FROM (such as "ELUM <hello@elum.space>",
// a Brevo-verified sender), optional ELUM_<APP>_URL for each app's address and EMAIL_ASSETS_URL.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { fail, hasSecret, ok } from '../_shared/http.ts';
import { cardFor, type Delivery } from '../_shared/cards.ts';
import { renderEmail } from '../_shared/email.ts';

const CONSUMER = 'email';

const url = (name: string, fallback: string) => (Deno.env.get(name) ?? fallback).replace(/\/+$/, '');
const URLS: Record<string, string> = {
  make: url('ELUM_MAKE_URL', 'https://makebyelum.netlify.app'),
  inquire: url('ELUM_INQUIRE_URL', 'https://inquirebyelum.netlify.app'),
  capture: url('ELUM_CAPTURE_URL', 'https://capturebyelum.netlify.app'),
  code: url('ELUM_CODE_URL', 'https://codebyelum.netlify.app'),
  tune: url('ELUM_TUNE_URL', 'https://tunebyelum.netlify.app'),
};

Deno.serve(async (req) => {
  if (!hasSecret(req, Deno.env.get('CRON_SECRET'))) return fail('unauthorized', 'Not allowed.');
  const key = Deno.env.get('BREVO_API_KEY');
  const from = Deno.env.get('SHARE_EMAIL_FROM');
  if (!key || !from) return ok({ waiting: 'Set BREVO_API_KEY and SHARE_EMAIL_FROM to send share emails.' });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const assets = url('EMAIL_ASSETS_URL', URLS.make);
  const sender = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);

  const claimed = await db.rpc('elum_claim_deliveries', { p_consumer: CONSUMER, p_limit: 50 });
  if (claimed.error) return fail('server', claimed.error.message);
  const counts = { done: 0, skipped: 0, retry: 0 };
  for (const row of (claimed.data ?? []) as Delivery[]) {
    let status: 'done' | 'skipped' | 'retry' = 'skipped';
    let error: string | null = null;
    try {
      // The same wording and link as the Type card, for someone whose ELUM mail goes elsewhere.
      const card = row.channel === 'email' && row.recipient_address ? cardFor({ ...row, channel: 'type_inbox' }, URLS) : null;
      if (card) {
        const app = card.service.charAt(0).toUpperCase() + card.service.slice(1);
        const email = renderEmail(
          card.title,
          {
            preheader: card.body ?? `Open it in ELUM ${app}.`,
            eyebrow: `ELUM ${app}`,
            title: card.title,
            paragraphs: [card.body ?? `It is waiting for you in ELUM ${app}. Sign in with your ELUM account to open it.`],
            button: card.actionUrl ? { label: card.actionLabel ?? `Open in ${app}`, url: card.actionUrl } : undefined,
            reason: 'You got this because someone on ELUM shared something with this address. You can turn these emails off in ELUM Account, under Notifications.',
          },
          { assetBase: assets },
        );
        const res = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            sender: sender ? { name: sender[1] || 'ELUM', email: sender[2] } : { name: 'ELUM', email: from.trim() },
            to: [{ email: row.recipient_address }],
            subject: email.subject,
            htmlContent: email.html,
            textContent: email.text,
            tags: ['elum-share', card.service],
          }),
        });
        if (res.ok) status = 'done';
        else if (res.status >= 500 || res.status === 429) {
          status = 'retry';
          error = `Brevo answered ${res.status}`;
        } else {
          status = 'skipped';
          error = `Brevo refused it (${res.status})`;
        }
      }
    } catch (e) {
      status = 'retry';
      error = e instanceof Error ? e.message : String(e);
    }
    await db.rpc('elum_finish_delivery', { p_consumer: CONSUMER, p_event: row.event_id, p_status: status, p_error: error });
    counts[status]++;
  }
  return ok(counts);
});
