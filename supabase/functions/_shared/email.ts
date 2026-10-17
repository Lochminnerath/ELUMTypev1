/**
 * ELUM Type system emails (recovery codes and the like), on the ELUM email layout from Write's
 * docs/EMAIL.md: the product lockup, one card, one action, a plain-text version and the footer.
 * Copied from Write's supabase/functions/_shared/email.ts with the Type lockup and mint accent,
 * minus the document card. Personal mail people send from Type does not use it.
 */

export interface EmailContent {
  /** Inbox preview line, shown after the subject. */
  preheader: string;
  /** Small uppercase label above the title. */
  eyebrow?: string;
  title: string;
  paragraphs: string[];
  /** A comment being quoted. */
  quote?: { author: string; text: string };
  button?: { label: string; url: string };
  /** A one-time code, shown large. */
  code?: string;
  /** Small print under the button, such as how long a link lasts. */
  note?: string;
  /** Why this person got the email. */
  reason: string;
}

export interface RenderOptions {
  /** Where /brand/email/*.png are served from: Type's URL. */
  assetBase: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// Brand colours (tokens.css), fixed values because email clients have no CSS variables.
const C = {
  ground: '#f4f5f8',
  card: '#ffffff',
  ink: '#141a2e',
  muted: '#5a6178',
  hairline: '#e2e5ee',
  action: '#3b5bd6',
  accentDeep: '#187a5f',
  accentLine: '#95dfcb',
  mist: '#eef2ff',
};

const SANS = "Manrope, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const DISPLAY = "Sora, 'Avenir Next', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MONO = "'IBM Plex Mono', Menlo, Consolas, monospace";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const row = (html: string, style = '', className = '') =>
  `<tr><td${className ? ` class="${className}"` : ''} style="${style}">${html}</td></tr>`;

export function renderEmail(subject: string, c: EmailContent, { assetBase }: RenderOptions): RenderedEmail {
  const base = assetBase.replace(/\/+$/, '');
  const e = escapeHtml;
  const parts: string[] = [];

  if (c.eyebrow) {
    parts.push(row(e(c.eyebrow), `padding:0 0 10px;font:600 12px/16px ${SANS};letter-spacing:.14em;text-transform:uppercase;color:${C.accentDeep}`, 'eyebrow'));
  }
  parts.push(row(e(c.title), `padding:0;font:400 24px/32px ${DISPLAY};letter-spacing:-.01em;color:${C.ink}`, 'title'));
  for (const p of c.paragraphs) {
    parts.push(row(e(p), `padding:14px 0 0;font:400 16px/26px ${SANS};color:${C.muted}`));
  }
  if (c.quote) {
    parts.push(row('', 'padding:18px 0 0;font-size:0;line-height:0'));
    parts.push(
      row(
        `<div class="muted" style="font:600 13px/20px ${SANS};color:${C.muted}">${e(c.quote.author)}</div>
<div class="ink" style="font:400 15px/24px ${SANS};color:${C.ink};white-space:pre-wrap">${e(c.quote.text)}</div>`,
        `padding:4px 0 4px 14px;border-left:3px solid ${C.accentLine}`,
      ),
    );
  }
  if (c.code) {
    parts.push(
      row(
        `<span class="code" style="display:inline-block;padding:12px 20px;border-radius:12px;background:${C.mist};font:500 28px/36px ${MONO};letter-spacing:.2em;color:${C.ink}">${e(c.code)}</span>`,
        'padding:24px 0 0',
      ),
    );
  }
  if (c.button) {
    parts.push(
      row(
        `<a href="${e(c.button.url)}" class="button" style="display:inline-block;padding:13px 26px;border-radius:999px;background:${C.action};color:#ffffff;font:600 15px/20px ${SANS};text-decoration:none">${e(c.button.label)}</a>`,
        'padding:28px 0 0',
      ),
    );
    parts.push(
      row(
        `If the button does not work, paste this link into your browser:<br><a href="${e(c.button.url)}" class="link" style="color:${C.action};word-break:break-all">${e(c.button.url)}</a>`,
        `padding:16px 0 0;font:400 13px/20px ${SANS};color:${C.muted}`,
      ),
    );
  }
  if (c.note) parts.push(row(e(c.note), `padding:12px 0 0;font:400 13px/20px ${SANS};color:${C.muted}`));

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${e(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600&family=Sora:wght@400&display=swap" rel="stylesheet">
<style>
  @media (prefers-color-scheme: dark) {
    .ground { background: #0e1220 !important; }
    .card { background: #171c2e !important; border-color: #2a3149 !important; }
    .card td, .muted { color: #a3aac0 !important; }
    .card .ink, .card .title { color: #eef1fa !important; }
    .card .eyebrow { color: #7ce0c3 !important; }
    .card .link { color: #8fa9fa !important; }
    .logo-dark { display: block !important; max-height: none !important; overflow: visible !important; }
    .code { background: #1b2340 !important; color: #eef1fa !important; }
    .button { background: #7093f8 !important; color: #0e1220 !important; }
    .footer td { color: #a3aac0 !important; }
    .logo-light { display: none !important; }
  }
  @media (max-width: 600px) { .card-pad { padding: 28px 22px !important; } }
</style>
</head>
<body class="ground" style="margin:0;padding:0;background:${C.ground}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${e(c.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="ground" style="background:${C.ground}">
<tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 20px">
<img class="logo-light" src="${base}/brand/email/type-lockup.png" width="140" height="45" alt="ELUM Type" style="display:block;border:0">
<!--[if !mso]><!--><img class="logo-dark" src="${base}/brand/email/type-lockup-reversed.png" width="140" height="45" alt="ELUM Type" style="display:none;max-height:0;overflow:hidden;border:0"><!--<![endif]-->
</td></tr>
<tr><td class="card card-pad" style="background:${C.card};border:1px solid ${C.hairline};border-radius:16px;padding:36px 36px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${parts.join('\n')}
</table>
</td></tr>
<tr><td class="footer" style="padding:24px 4px 0">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding:0 10px 0 0;vertical-align:middle"><img src="${base}/brand/email/elum-mark.png" width="20" height="20" alt="ELUM" style="display:block;border:0"></td>
<td style="font:600 12px/16px ${SANS};color:${C.muted};vertical-align:middle">Built by people. Runs without AI.</td>
</tr></table>
<div style="padding:10px 0 0;font:400 12px/18px ${SANS};color:${C.muted}">${e(c.reason)}</div>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;

  const text = [
    c.eyebrow ? c.eyebrow.toUpperCase() : null,
    c.title,
    ...c.paragraphs,
    c.quote ? `${c.quote.author}:\n${c.quote.text.replace(/^/gm, '> ')}` : null,
    c.code ? `Your code: ${c.code}` : null,
    c.button ? `${c.button.label}: ${c.button.url}` : null,
    c.note ?? null,
    '--',
    'ELUM Type. Built by people. Runs without AI.',
    c.reason,
  ]
    .filter((l): l is string => l !== null)
    .join('\n\n');

  return { subject, html, text: `${text}\n` };
}

// ------------------------------------------------------------ the messages

/** The code that confirms a recovery email for a Type account (handoff 3.4). */
export function recoveryCodeEmail(d: { code: string; address: string; typeAddress: string }, o: RenderOptions): RenderedEmail {
  return renderEmail(
    `${d.code} is your ELUM Type code`,
    {
      preheader: 'Use this code to confirm your recovery email.',
      eyebrow: 'Recovery email',
      title: 'Confirm your recovery email',
      paragraphs: [
        `Enter this code in Type, under Settings, to confirm ${d.address} as the way back into ${d.typeAddress}.`,
        'If you forget your password, we send the reset link here.',
      ],
      code: d.code,
      note: 'The code works for 30 minutes. Never share it with anyone.',
      reason: `You got this because someone set ${d.address} as the recovery email for ${d.typeAddress}. If it was not you, ignore this email.`,
    },
    o,
  );
}
