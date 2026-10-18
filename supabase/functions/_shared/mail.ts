/**
 * Email helpers for Type's edge functions: reading inbound mail, deciding what is spam or
 * automatic, and shaping outbound mail for Brevo. Plain TypeScript, tested with vitest.
 */

export interface MailAddress {
  address: string;
  name?: string | null;
}

/** An email that arrived, in the shape public.type_receive_email takes. */
export interface InboundEmail {
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  /** Envelope recipients: the addresses this copy was delivered to. */
  recipients: string[];
  subject: string | null;
  text: string;
  html: string | null;
  headers: Record<string, string>;
  date: string | null;
  spamScore: number | null;
  attachments: InboundAttachment[];
}

export interface InboundAttachment {
  name: string;
  mime: string;
  bytes: number;
  /** Brevo: a token for GET /v3/inbound/attachments/{token}. */
  downloadToken?: string;
  /** Other providers: the content inline. */
  base64?: string;
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;

export function cleanAddress(value: unknown): string | null {
  const a = String(value ?? '').trim().toLowerCase();
  return EMAIL_RE.test(a) ? a : null;
}

/** "Rae <rae@x.org>, kai@y.org" from a header, into addresses. */
export function parseAddressHeader(value: string | null | undefined): MailAddress[] {
  if (!value) return [];
  const out: MailAddress[] = [];
  // Split on commas outside quotes.
  const parts = value.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  for (const part of parts) {
    const m = part.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    const address = cleanAddress(m ? m[2] : part);
    if (address) out.push({ address, name: m?.[1]?.trim() || null });
  }
  return out;
}

/** Message-IDs in a References or In-Reply-To header. */
export function parseMessageIds(value: string | null | undefined): string[] {
  return (value ?? '').match(/<[^<>\s]+>/g) ?? [];
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

/**
 * Mail no one should answer automatically: auto-replies, bounces, lists and bulk mail
 * (RFC 3834). Vacation replies skip these, so two away-messages never talk forever.
 */
export function isAutomatic(headers: Record<string, string>, from: string): boolean {
  const auto = header(headers, 'Auto-Submitted');
  if (auto && auto.trim().toLowerCase() !== 'no') return true;
  if (/^(bulk|list|junk|auto_reply)$/i.test(header(headers, 'Precedence')?.trim() ?? '')) return true;
  if (header(headers, 'List-Id') || header(headers, 'List-Unsubscribe')) return true;
  if (header(headers, 'X-Autoreply') || header(headers, 'X-Autorespond')) return true;
  return /^(mailer-daemon|postmaster|no-?reply|bounces?)[@+.-]/i.test(from);
}

/**
 * Spam, from the provider's checks: a failed DMARC, both SPF and DKIM failing, or a high spam
 * score. Type's own rules can be added here; there are no learned filters (no AI).
 */
export function isSpam(headers: Record<string, string>, spamScore: number | null): boolean {
  const results = (header(headers, 'Authentication-Results') ?? '').toLowerCase();
  if (/\bdmarc=fail\b/.test(results)) return true;
  if (/\bspf=fail\b/.test(results) && /\bdkim=fail\b/.test(results)) return true;
  return spamScore !== null && spamScore >= 5;
}

export function hasRemoteImages(html: string | null): boolean {
  return !!html && (/<img[^>]+src\s*=\s*["']?\s*(https?:)?\/\//i.test(html) || /url\(\s*['"]?\s*(https?:)?\/\//i.test(html));
}

/** A file name that is safe as a storage path segment. */
export function safeFileName(name: string): string {
  const clean = name.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^\.+/, '').trim();
  return (clean || 'attachment').slice(-120);
}

/**
 * Brevo's inbound parsing webhook posts { items: [...] }. This reads one item into an
 * InboundEmail. Field names follow Brevo's documentation (check them when switching providers).
 */
export function fromBrevoInbound(item: Record<string, unknown>): InboundEmail {
  const list = (v: unknown): MailAddress[] =>
    Array.isArray(v)
      ? v.flatMap((x) => {
          const r = x as { Address?: string; Name?: string };
          const address = cleanAddress(r.Address);
          return address ? [{ address, name: r.Name?.trim() || null }] : [];
        })
      : [];
  const fromRaw = (item.From ?? {}) as { Address?: string; Name?: string };
  const headers = Object.fromEntries(
    Object.entries((item.Headers ?? {}) as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]),
  );
  const to = list(item.To);
  const cc = list(item.Cc);
  const recipients = Array.isArray(item.Recipients)
    ? (item.Recipients as unknown[]).map(cleanAddress).filter((a): a is string => !!a)
    : [...to, ...cc].map((a) => a.address);
  const attachments = Array.isArray(item.Attachments)
    ? (item.Attachments as Record<string, unknown>[]).map((a) => ({
        name: safeFileName(String(a.Name ?? 'attachment')),
        mime: String(a.ContentType ?? 'application/octet-stream'),
        bytes: Number(a.ContentLength ?? 0),
        downloadToken: a.DownloadToken ? String(a.DownloadToken) : undefined,
      }))
    : [];
  const html = typeof item.RawHtmlBody === 'string' && item.RawHtmlBody.trim() ? item.RawHtmlBody : null;
  const text =
    typeof item.RawTextBody === 'string' && item.RawTextBody.trim()
      ? item.RawTextBody
      : typeof item.ExtractedMarkdownMessage === 'string'
        ? item.ExtractedMarkdownMessage
        : '';
  return {
    messageId: typeof item.MessageId === 'string' ? item.MessageId.trim() : (header(headers, 'Message-ID') ?? null),
    inReplyTo: typeof item.InReplyTo === 'string' && item.InReplyTo ? item.InReplyTo.trim() : (parseMessageIds(header(headers, 'In-Reply-To'))[0] ?? null),
    references: parseMessageIds(header(headers, 'References')),
    from: { address: cleanAddress(fromRaw.Address) ?? '', name: fromRaw.Name?.trim() || null },
    to,
    cc,
    recipients,
    subject: typeof item.Subject === 'string' ? item.Subject.slice(0, 300) : null,
    text,
    html,
    headers,
    date: typeof item.SentAtDate === 'string' ? safeDate(item.SentAtDate) : null,
    spamScore: typeof item.SpamScore === 'number' ? item.SpamScore : null,
    attachments,
  };
}

function safeDate(value: string): string | null {
  const t = Date.parse(value);
  // A date far in the future would pin a message to the top of the inbox.
  return Number.isFinite(t) && t <= Date.now() + 5 * 60_000 ? new Date(t).toISOString() : null;
}

// ------------------------------------------------------------------ outbound

/** A message claimed from type.outbox (public.type_claim_outbox). */
export interface OutboundMessage {
  id: string;
  threadId: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string | null;
  text: string;
  html: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  auto: boolean;
  signature: string | null;
  attachments: { path: string; name: string; mime: string; bytes: number }[];
}

export interface OutboxRow {
  outbox_id: number;
  attempts: number;
  address: string;
  name: string | null;
  kind: 'to' | 'cc' | 'bcc';
  message: OutboundMessage;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** The body as people wrote it, plus their signature. Personal mail, so no branded template. */
export function outboundBody(m: OutboundMessage, cleanHtml: (html: string) => string): { html: string; text: string } {
  const text = m.signature ? `${m.text}\n\n-- \n${m.signature}` : m.text;
  const body = m.html ? cleanHtml(m.html) : escapeHtml(m.text).replace(/\n/g, '<br>');
  const signature = m.signature ? `<p style="color:#5a6178">-- <br>${escapeHtml(m.signature).replace(/\n/g, '<br>')}</p>` : '';
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body style="font:15px/1.6 Manrope,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#141a2e">${body}${signature}</body></html>`;
  return { html, text };
}

/**
 * The Brevo transactional email body for one message and the outside recipients claimed for it.
 * Type addresses on the message are kept in To and Cc so outside people can reply to everyone;
 * their copies come back through type-inbound and are recognised by Message-ID.
 */
export function brevoPayload(
  rows: OutboxRow[],
  typeDomain: string,
  body: { html: string; text: string },
  attachments: { name: string; content: string }[],
): Record<string, unknown> {
  const m = rows[0].message;
  const external = new Set(rows.map((r) => r.address));
  const keep = (a: MailAddress) => external.has(a.address) || a.address.endsWith(`@${typeDomain}`);
  const fmt = (a: MailAddress) => (a.name ? { email: a.address, name: a.name } : { email: a.address });
  let to = m.to.filter(keep).map(fmt);
  const cc = m.cc.filter(keep).map(fmt);
  const bcc = rows.filter((r) => r.kind === 'bcc').map((r) => fmt({ address: r.address, name: r.name }));
  // Brevo needs at least one To.
  if (!to.length) to = bcc.length && !cc.length ? [bcc.shift()!] : cc.length ? [cc.shift()!] : [];
  const headers: Record<string, string> = {};
  if (m.messageId) headers['Message-Id'] = m.messageId;
  if (m.inReplyTo) headers['In-Reply-To'] = m.inReplyTo;
  const refs = [...m.references, ...(m.inReplyTo && !m.references.includes(m.inReplyTo) ? [m.inReplyTo] : [])];
  if (refs.length) headers.References = refs.join(' ');
  if (m.auto) headers['Auto-Submitted'] = 'auto-replied';
  // Brevo de-duplicates a retried request with the same key.
  headers.idempotencyKey = `${m.id}:${rows.map((r) => r.outbox_id).join('.')}`;
  return {
    sender: fmt(m.from),
    to,
    ...(cc.length ? { cc } : {}),
    ...(bcc.length ? { bcc } : {}),
    subject: m.subject?.trim() || '(no subject)',
    htmlContent: body.html,
    textContent: body.text,
    headers,
    ...(attachments.length ? { attachment: attachments } : {}),
    tags: ['type'],
  };
}

/** What to do with an outbox row after Brevo answers: sent, retry later, or give up. */
export function outcome(status: number): 'sent' | 'retry' | 'failed' {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 429 || status >= 500) return 'retry';
  return 'failed';
}

/** A six-digit code for confirming a recovery email. */
export function sixDigitCode(random: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  return String(random(1)[0] % 1_000_000).padStart(6, '0');
}

/** Throwaway inbox domains that cannot be a recovery email (handoff 3.4). A short list; extend it as needed. */
export const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org', 'trashmail.com',
  'yopmail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com',
]);

export function isDisposable(address: string): boolean {
  return DISPOSABLE_DOMAINS.has(address.split('@')[1]?.toLowerCase() ?? '');
}
