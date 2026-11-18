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

/**
 * A sign-in or confirmation code ("Your code is 482913"): mail people asked for, from services
 * they use their ELUM address with. The same rules as Type's lib/codes.ts.
 */
const CODE_WORD = /\b(code|codes|verification|verify|passcode|one[- ]time|otp|pin|security code|confirm|confirmation|sign[- ]?in|log[- ]?in|2fa|two[- ]factor)\b/i;
const CODE = /(?<![\w./:#-])((?:\d[ -]?){3,7}\d|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w/:#-]|\.\d)/g;

export function findCode(subject: string | null, text: string | null): string | null {
  const hay = `${subject ?? ''}\n${(text ?? '').slice(0, 4000)}`;
  if (!CODE_WORD.test(hay)) return null;
  for (const m of hay.matchAll(CODE)) {
    const raw = m[1];
    const code = raw.replace(/[ -]/g, '');
    if (/^\d+$/.test(code)) {
      if (code.length < 4 || code.length > 8) continue;
      if (code.length === 4 && /^(19|20)\d\d$/.test(code)) continue;
      if (raw !== code && !/^\d{3,4}[ -]\d{3,4}$/.test(raw)) continue;
    }
    const at = m.index ?? 0;
    if (CODE_WORD.test(hay.slice(Math.max(0, at - 120), at + raw.length + 60))) return code;
  }
  return null;
}

const RISKY_FILE = /\.(exe|scr|bat|cmd|com|pif|js|jse|vbs|vbe|wsf|wsh|jar|msi|ps1|hta|lnk|iso|img|reg)$/i;
const SCAM_PHRASES = [
  'you have won', 'you\'ve won', 'claim your prize', 'wire transfer', 'western union', 'bitcoin', 'crypto investment',
  'act now', '100% free', 'risk-free', 'risk free', 'limited time offer', 'click below to unlock', 'account will be suspended',
  'account has been suspended', 'verify your account immediately', 'gift card', 'inheritance', 'lottery', 'beneficiary',
  'dear winner', 'urgent reply needed', 'double your money', 'make money fast', 'no credit check',
];
const domainOf = (address: string) => address.split('@')[1]?.toLowerCase() ?? '';
/** example.co.uk and mail.example.co.uk are the same organisation; so are a.example.com and example.com. */
const sameOrg = (a: string, b: string) => {
  const tail = (d: string) => d.split('.').slice(-2).join('.');
  return !!a && !!b && (a === b || tail(a) === tail(b));
};

/**
 * Whether received mail goes to Spam. Plain rules, no learned filters and no AI:
 * - A failed DMARC check, or SPF and DKIM both failing, is always spam (the sender is forged).
 * - Codes people asked for (sign-in, confirmation) are never spam otherwise.
 * - Then the provider's spam score and Type's own signs add up: risky attachments, a sender name
 *   that pretends to be another address, a reply address at another company, links that show one
 *   address and go to another, shouting subjects and well-known scam phrases.
 * Each person's own choices (Spam / Not spam, people they write to) are applied afterwards, in
 * the database (type.spam_for).
 */
export function spamVerdict(mail: Pick<InboundEmail, 'headers' | 'spamScore' | 'from' | 'subject' | 'text' | 'attachments'>, html: string | null): boolean {
  const results = (header(mail.headers, 'Authentication-Results') ?? '').toLowerCase();
  if (/\bdmarc=fail\b/.test(results)) return true;
  if (/\bspf=fail\b/.test(results) && /\bdkim=fail\b/.test(results)) return true;
  if (findCode(mail.subject, mail.text)) return false;
  if (mail.spamScore !== null && mail.spamScore >= 5) return true;

  let score = mail.spamScore !== null && mail.spamScore >= 3 ? 2 : 0;
  if (mail.attachments.some((a) => RISKY_FILE.test(a.name))) score += 4;

  const fromDomain = domainOf(mail.from.address);
  const named = mail.from.name?.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
  if (named && !sameOrg(domainOf(named[0]), fromDomain)) score += 2;

  const replyTo = header(mail.headers, 'Reply-To')?.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/);
  if (replyTo && !sameOrg(domainOf(replyTo[0]), fromDomain)) score += 1;

  const subject = mail.subject ?? '';
  const letters = subject.replace(/[^A-Za-z]/g, '');
  if (letters.length >= 12 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) score += 1;
  if (/!{3,}|\${2,}/.test(subject)) score += 1;

  const words = `${subject}\n${mail.text}`.toLowerCase();
  const phrases = SCAM_PHRASES.filter((p) => words.includes(p)).length;
  score += Math.min(phrases, 2) * 2;

  if (html) {
    const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']?(https?:\/\/[^"'\s>]+)[^>]*>([\s\S]*?)<\/a>/gi)];
    if (links.length > 25) score += 1;
    // A link whose text shows one address but goes to another: the classic phishing trick.
    const tricked = links.some(([, href, label]) => {
      const shown = label.replace(/<[^>]+>/g, '').trim().match(/^(?:https?:\/\/)?([\w-]+(?:\.[\w-]+)+)/i);
      if (!shown) return false;
      try {
        return !sameOrg(new URL(href).hostname.toLowerCase(), shown[1].toLowerCase());
      } catch {
        return false;
      }
    });
    if (tricked) score += 2;
  }
  return score >= 4;
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

/** Where the ELUM footer's logo and link point. */
export const ELUM_SITE = 'https://elum.space';
export const ELUM_FOOTER_LOGO = 'https://account.elum.space/brand/email/elum-lockup.png';

/** The line every email sent from Type to the outside world ends with. */
export const ELUM_FOOTER_TEXT = 'Sent through ELUM. Get yours today.';

/**
 * The body as people wrote it, plus their signature, then a small ELUM footer: the logo and
 * "Sent through ELUM. Get yours today." Personal mail otherwise, so no branded template.
 * Accessible: a language, a real alt text on the logo, readable contrast, and a plain-text twin.
 */
/** The ELUM colours a picture falls back to; the same as Type's lib/pictures.ts. */
const PICTURE_COLOURS = ['#f59a52', '#3fc4a0', '#ec7fa9', '#9b84ee', '#e9b949', '#f06a5f', '#48bfe3', '#d27fe0', '#5ec46f', '#7093f8'];

export function colourFor(address: string): string {
  let h = 2166136261;
  for (const c of address.trim().toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return PICTURE_COLOURS[h % PICTURE_COLOURS.length];
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/**
 * Who it is from, at the top of the email: the sender's picture when they show it to everyone,
 * otherwise a circle in an ELUM colour with their initials.
 */
function senderLine(m: OutboundMessage, picture: string | null): string {
  const name = m.from.name?.trim() || m.from.address.split('@')[0];
  const font = "Manrope,'Helvetica Neue',Helvetica,Arial,sans-serif";
  const face = picture
    ? `<img src="${escapeHtml(picture)}" width="40" height="40" alt="" style="display:block;border:0;border-radius:20px;width:40px;height:40px">`
    : `<div style="width:40px;height:40px;border-radius:20px;background:${colourFor(m.from.address)};color:#141a2e;font:600 15px/40px ${font};text-align:center">${escapeHtml(initialsOf(name))}</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr>
<td style="padding:0 12px 0 0;vertical-align:middle">${face}</td>
<td style="vertical-align:middle;font:600 15px/20px ${font};color:#141a2e">${escapeHtml(name)}<div style="font:400 13px/18px ${font};color:#5a6178">${escapeHtml(m.from.address)}</div></td>
</tr></table>`;
}

export function outboundBody(m: OutboundMessage, cleanHtml: (html: string) => string, picture: string | null = null): { html: string; text: string } {
  const written = m.signature ? `${m.text}\n\n-- \n${m.signature}` : m.text;
  const text = `${written}\n\n---\n${ELUM_FOOTER_TEXT} ${ELUM_SITE}`;
  const body = m.html ? cleanHtml(m.html) : escapeHtml(m.text).replace(/\n/g, '<br>');
  const signature = m.signature ? `<p style="color:#5a6178">-- <br>${escapeHtml(m.signature).replace(/\n/g, '<br>')}</p>` : '';
  const footer = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:32px 0 0;border-top:1px solid #e2e5ee;padding:0">
<tr><td style="padding:14px 0 0;vertical-align:middle"><a href="${ELUM_SITE}" style="text-decoration:none"><img src="${ELUM_FOOTER_LOGO}" width="76" height="24" alt="ELUM" style="display:block;border:0"></a></td></tr>
<tr><td style="padding:8px 0 0;font:13px/20px Manrope,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#5a6178">Sent through ELUM. <a href="${ELUM_SITE}" style="color:#3b5bd6">Get yours today.</a></td></tr>
</table>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="font:15px/1.6 Manrope,'Helvetica Neue',Helvetica,Arial,sans-serif;color:#141a2e">${senderLine(m, picture)}${body}${signature}${footer}</body></html>`;
  return { html, text };
}

/**
 * The key Brevo uses to drop a retried send: it must be a UUID (anything longer is refused with
 * "Idempotency key exceeds char limit"). Built from the message id and its outbox rows, so the same
 * send always gets the same key and a different set of recipients gets another.
 */
export function idempotencyKey(messageId: string, outboxIds: string[]): string {
  const input = `${messageId}:${[...outboxIds].sort().join('.')}`;
  const part = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 0x01000193) >>> 0;
    return h.toString(16).padStart(8, '0');
  };
  const hex = part(0x811c9dc5) + part(0x9e3779b9) + part(0x85ebca6b) + part(0xc2b2ae35);
  // Shaped as a version 4, variant 1 UUID.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${'89ab'[parseInt(hex[16], 16) & 3]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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
  // Brevo de-duplicates a retried request with the same key. It must stay short (Brevo refuses a
  // long one with "Idempotency key exceeds char limit"), so the outbox rows go in as a hash.
  headers.idempotencyKey = idempotencyKey(m.id, rows.map((r) => String(r.outbox_id)));
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
