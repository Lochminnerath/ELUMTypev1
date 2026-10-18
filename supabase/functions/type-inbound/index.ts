// Receives email for Type addresses (handoff 7). The inbound provider (Brevo inbound parsing)
// POSTs each message here; this stores it in the right inboxes. Runs on Supabase Edge Functions (Deno).
//
// Steps: check the shared secret, read the provider's payload, drop mail for unknown addresses,
// sanitise the HTML, judge spam and automatic mail, save attachments to the type-attachments
// bucket, then public.type_receive_email (which threads it, notifies and emits type.message.received).
//
// Secrets (supabase secrets set ...):
//   INBOUND_SECRET  Brevo does not sign inbound webhooks, so the webhook URL carries a secret:
//                   https://<project>.functions.supabase.co/type-inbound?token=<INBOUND_SECRET>
//   BREVO_API_KEY   To download attachments from Brevo.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. Deploy with --no-verify-jwt.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import sanitizeHtml from 'npm:sanitize-html@2';
import { fail, hasSecret, ok } from '../_shared/http.ts';
import {
  fromBrevoInbound,
  hasRemoteImages,
  isAutomatic,
  isSpam,
  MAX_ATTACHMENT_BYTES,
  safeFileName,
  type InboundEmail,
} from '../_shared/mail.ts';

const BUCKET = 'type-attachments';

/** Received HTML is cleaned here and again in the app; it is never trusted. */
function cleanReceivedHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'center', 'font', 'span', 'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']),
    disallowedTagsMode: 'discard',
    allowedAttributes: {
      '*': ['style', 'align', 'valign', 'width', 'height', 'bgcolor', 'color', 'dir', 'title'],
      a: ['href', 'name', 'target'],
      img: ['src', 'alt', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
      font: ['face', 'size', 'color'],
      table: ['cellpadding', 'cellspacing', 'border'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'cid', 'data'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
    allowProtocolRelative: false,
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail('invalid', 'Use POST.');
  if (!hasSecret(req, Deno.env.get('INBOUND_SECRET'))) return fail('unauthorized', 'Not allowed.');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let payload: { items?: Record<string, unknown>[] };
  try {
    payload = await req.json();
  } catch {
    return fail('invalid', 'Expected JSON.');
  }
  const items = Array.isArray(payload.items) ? payload.items : [payload as Record<string, unknown>];
  const results = [];
  for (const item of items) {
    const mail = fromBrevoInbound(item);
    if (!mail.from.address || !mail.recipients.length) {
      results.push({ stored: false, reason: 'unreadable' });
      continue;
    }
    results.push(await store(db, mail));
  }
  // Providers retry on errors, so answer 200 once each item is handled (the database de-duplicates).
  return ok({ results });
});

async function store(db: SupabaseClient, mail: InboundEmail) {
  const id = crypto.randomUUID();
  const html = mail.html ? cleanReceivedHtml(mail.html) : null;
  const attachments: { path: string; name: string; mime: string; bytes: number }[] = [];
  let total = 0;
  for (const a of mail.attachments) {
    if (a.bytes > MAX_ATTACHMENT_BYTES || total + a.bytes > MAX_ATTACHMENT_BYTES) continue;
    const bytes = await download(a);
    if (!bytes) continue;
    total += bytes.length;
    const path = `${id}/${crypto.randomUUID().slice(0, 8)}-${safeFileName(a.name)}`;
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: a.mime, upsert: false });
    if (!up.error) attachments.push({ path, name: a.name, mime: a.mime, bytes: bytes.length });
  }

  const { data, error } = await db.rpc('type_receive_email', {
    p: {
      id,
      messageId: mail.messageId,
      inReplyTo: mail.inReplyTo,
      references: mail.references,
      from: mail.from,
      to: mail.to,
      cc: mail.cc,
      recipients: mail.recipients,
      subject: mail.subject,
      text: mail.text,
      html,
      headers: pickHeaders(mail.headers),
      date: mail.date,
      spam: isSpam(mail.headers, mail.spamScore),
      auto: isAutomatic(mail.headers, mail.from.address),
      hasRemoteImages: hasRemoteImages(html),
      attachments,
    },
  });
  if (error || (data as { stored?: boolean })?.stored === false) {
    // Not stored (unknown address, or a copy we already had): the files are not needed.
    if (attachments.length) await db.storage.from(BUCKET).remove(attachments.map((a) => a.path));
  }
  if (error) return { stored: false, reason: error.message };
  return data;
}

/** The headers people may want to see under "details". Not every header: they can be huge. */
function pickHeaders(headers: Record<string, string>): Record<string, string> {
  const keep = ['From', 'To', 'Cc', 'Reply-To', 'Date', 'Subject', 'Message-ID', 'In-Reply-To', 'Authentication-Results', 'List-Id', 'List-Unsubscribe'];
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const name = keep.find((x) => x.toLowerCase() === k.toLowerCase());
    if (name) out[name] = v.slice(0, 2000);
  }
  return out;
}

async function download(a: InboundEmail['attachments'][number]): Promise<Uint8Array | null> {
  if (a.base64) return Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0));
  const key = Deno.env.get('BREVO_API_KEY');
  if (!a.downloadToken || !key) return null;
  const res = await fetch(`https://api.brevo.com/v3/inbound/attachments/${encodeURIComponent(a.downloadToken)}`, { headers: { 'api-key': key } });
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}
