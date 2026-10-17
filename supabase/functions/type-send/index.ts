// Sends Type's outside email: drains type.outbox through Brevo. Runs on Supabase Edge Functions (Deno).
//
// Called two ways:
//   - every minute by pg_cron with "Authorization: Bearer <CRON_SECRET>" (see supabase/README.md);
//   - by the app right after sending, with the person's session and { messageId }, so mail goes
//     out at once instead of within the minute. That only speeds up the queue; it sends nothing new.
//
// Secrets (supabase secrets set ...):
//   BREVO_API_KEY   Brevo API key. Without it, nothing is sent and the queue waits.
//   CRON_SECRET     Shared secret the scheduler sends.
// The Type mail domain must be authenticated in Brevo (SPF, DKIM), so any address on it can send.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import sanitizeHtml from 'npm:sanitize-html@2';
import { CORS, fail, hasSecret, ok } from '../_shared/http.ts';
import { brevoPayload, outboundBody, outcome, type OutboxRow } from '../_shared/mail.ts';

const BATCH = 25;
const BUCKET = 'type-attachments';

/** Only what Type's composer makes: basic formatting and links. */
function cleanComposerHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'a', 'blockquote'],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto'],
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let messageId: string | null = null;
  if (!hasSecret(req, Deno.env.get('CRON_SECRET'))) {
    // A nudge from the app: any signed-in person may ask for the queue to run now.
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data } = await db.auth.getUser(jwt);
    if (!data.user) return fail('unauthorized', 'Your session has ended. Sign in again.');
    try {
      messageId = ((await req.json()) as { messageId?: string }).messageId ?? null;
    } catch {
      messageId = null;
    }
  }

  const key = Deno.env.get('BREVO_API_KEY');
  if (!key) return ok({ sent: 0, waiting: 'Set BREVO_API_KEY to send outside email.' });
  const domain = await db.rpc('type_domain');
  if (domain.error) return fail('server', 'Type is not set up in this database.');

  const claimed = await db.rpc('type_claim_outbox', { p_limit: BATCH, p_lease_seconds: 120, p_message: messageId });
  if (claimed.error) return fail('server', claimed.error.message);
  const rows = (claimed.data ?? []) as OutboxRow[];

  // One Brevo email per message, to all of its outside recipients claimed now.
  const byMessage = new Map<string, OutboxRow[]>();
  for (const row of rows) byMessage.set(row.message.id, [...(byMessage.get(row.message.id) ?? []), row]);

  let sent = 0;
  let failed = 0;
  for (const group of byMessage.values()) {
    const result = await deliver(db, key, String(domain.data), group);
    for (const row of group) {
      await db.rpc('type_finish_outbox', { p_id: row.outbox_id, p_status: result.status, p_provider_id: result.providerId, p_error: result.error });
    }
    if (result.status === 'sent') sent += group.length;
    else failed += group.length;
  }
  return ok({ sent, notSent: failed });
});

async function deliver(
  db: SupabaseClient,
  key: string,
  typeDomain: string,
  group: OutboxRow[],
): Promise<{ status: 'sent' | 'retry' | 'failed'; providerId: string | null; error: string | null }> {
  const m = group[0].message;
  try {
    const attachments: { name: string; content: string }[] = [];
    for (const a of m.attachments ?? []) {
      const file = await db.storage.from(BUCKET).download(a.path);
      if (file.error || !file.data) return { status: 'retry', providerId: null, error: `Attachment ${a.name} could not be read.` };
      attachments.push({ name: a.name, content: base64(new Uint8Array(await file.data.arrayBuffer())) });
    }
    const payload = brevoPayload(group, typeDomain, outboundBody(m, cleanComposerHtml), attachments);
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const status = outcome(res.status);
    if (status === 'sent') {
      const json = (await res.json().catch(() => ({}))) as { messageId?: string };
      // Brevo may use its own Message-ID; type_receive_email threads replies to it too.
      return { status, providerId: json.messageId ?? null, error: null };
    }
    return { status, providerId: null, error: `${res.status} ${(await res.text()).slice(0, 500)}` };
  } catch (e) {
    return { status: 'retry', providerId: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
