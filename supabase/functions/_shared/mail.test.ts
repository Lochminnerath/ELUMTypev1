import { describe, expect, it } from 'vitest';
import { cardFor, type Delivery } from './cards';
import { fail, hasSecret } from './http';
import {
  brevoPayload,
  fromBrevoInbound,
  hasRemoteImages,
  isAutomatic,
  isDisposable,
  isSpam,
  outboundBody,
  outcome,
  parseAddressHeader,
  safeFileName,
  sixDigitCode,
  type OutboxRow,
} from './mail';

describe('inbound', () => {
  const item = {
    Uuid: ['x'],
    MessageId: '<abc@outside.org>',
    InReplyTo: '<1@type.elum.services>',
    From: { Name: 'Kai Moreno', Address: 'Kai@Outside.org' },
    To: [{ Name: 'Rae', Address: 'rae@type.elum.services' }],
    Cc: [{ Name: null, Address: 'fen@type.elum.services' }, { Address: 'not an address' }],
    Subject: 'Re: Hello',
    RawHtmlBody: '<p>Hi</p><img src="https://t.example/p.gif">',
    RawTextBody: 'Hi',
    SentAtDate: '2026-10-17T10:00:00Z',
    SpamScore: 0.4,
    Headers: { 'Authentication-Results': 'mx; spf=pass; dkim=pass; dmarc=pass', References: '<0@x> <1@type.elum.services>' },
    Attachments: [{ Name: '../../etc/passwd', ContentType: 'text/plain', ContentLength: 12, DownloadToken: 'tok' }],
  };

  it('reads a Brevo inbound item', () => {
    const mail = fromBrevoInbound(item);
    expect(mail.from).toEqual({ address: 'kai@outside.org', name: 'Kai Moreno' });
    expect(mail.recipients).toEqual(['rae@type.elum.services', 'fen@type.elum.services']);
    expect(mail.cc).toHaveLength(1);
    expect(mail.references).toEqual(['<0@x>', '<1@type.elum.services>']);
    expect(mail.attachments[0].name).toBe('_.._etc_passwd');
    expect(mail.date).toBe('2026-10-17T10:00:00.000Z');
    expect(isSpam(mail.headers, mail.spamScore)).toBe(false);
    expect(hasRemoteImages(mail.html)).toBe(true);
  });

  it('ignores dates in the future', () => {
    expect(fromBrevoInbound({ ...item, SentAtDate: '2999-01-01T00:00:00Z' }).date).toBeNull();
  });

  it('judges spam from the provider checks', () => {
    expect(isSpam({ 'Authentication-Results': 'mx; dmarc=fail' }, 0)).toBe(true);
    expect(isSpam({ 'authentication-results': 'spf=fail dkim=fail' }, 0)).toBe(true);
    expect(isSpam({}, 7)).toBe(true);
    expect(isSpam({ 'Authentication-Results': 'spf=fail dkim=pass dmarc=pass' }, 1)).toBe(false);
  });

  it('spots mail that must not get an automatic reply', () => {
    expect(isAutomatic({ 'Auto-Submitted': 'auto-replied' }, 'a@b.c')).toBe(true);
    expect(isAutomatic({ 'Auto-Submitted': 'no' }, 'a@b.c')).toBe(false);
    expect(isAutomatic({ Precedence: 'bulk' }, 'a@b.c')).toBe(true);
    expect(isAutomatic({ 'List-Id': '<news.example>' }, 'a@b.c')).toBe(true);
    expect(isAutomatic({}, 'noreply@shop.example')).toBe(true);
    expect(isAutomatic({}, 'kai@studio.example')).toBe(false);
  });

  it('parses address headers', () => {
    expect(parseAddressHeader('"Moreno, Kai" <kai@x.org>, fen@y.org, junk')).toEqual([
      { address: 'kai@x.org', name: 'Moreno, Kai' },
      { address: 'fen@y.org', name: null },
    ]);
  });

  it('keeps file names safe', () => {
    expect(safeFileName('a/b\\c:d.txt')).toBe('a_b_c_d.txt');
    expect(safeFileName('...')).toBe('attachment');
  });
});

describe('outbound', () => {
  const message = {
    id: 'm1',
    threadId: 't1',
    from: { address: 'rae@type.elum.services', name: 'Rae Reed' },
    to: [{ address: 'kai@outside.org', name: 'Kai' }, { address: 'fen@type.elum.services', name: 'Fen' }, { address: 'ola@example.org', name: 'Ola' }],
    cc: [],
    subject: 'Hello',
    text: 'Hi <Kai>',
    html: null,
    messageId: '<m1@type.elum.services>',
    inReplyTo: '<prev@outside.org>',
    references: ['<first@type.elum.services>'],
    auto: false,
    signature: 'Rae',
    attachments: [],
  };
  const rows: OutboxRow[] = [
    { outbox_id: 1, attempts: 1, address: 'kai@outside.org', name: 'Kai', kind: 'to', message },
    { outbox_id: 2, attempts: 1, address: 'boss@outside.org', name: null, kind: 'bcc', message },
  ];

  it('builds the Brevo request', () => {
    const body = outboundBody(message, (h) => h);
    expect(body.text).toBe('Hi <Kai>\n\n-- \nRae');
    expect(body.html).toContain('Hi &lt;Kai&gt;');
    const p = brevoPayload(rows, 'type.elum.services', body, []);
    // Outside recipients and Type addresses are shown; an external account's login email is not emailed.
    expect(p.to).toEqual([{ email: 'kai@outside.org', name: 'Kai' }, { email: 'fen@type.elum.services', name: 'Fen' }]);
    expect(p.bcc).toEqual([{ email: 'boss@outside.org' }]);
    expect(p.sender).toEqual({ email: 'rae@type.elum.services', name: 'Rae Reed' });
    expect(p.headers).toMatchObject({
      'Message-Id': '<m1@type.elum.services>',
      'In-Reply-To': '<prev@outside.org>',
      References: '<first@type.elum.services> <prev@outside.org>',
    });
  });

  it('marks automatic replies', () => {
    const p = brevoPayload([{ ...rows[0], message: { ...message, auto: true } }], 'type.elum.services', { html: '', text: '' }, []);
    expect((p.headers as Record<string, string>)['Auto-Submitted']).toBe('auto-replied');
  });

  it('retries only what can succeed later', () => {
    expect(outcome(201)).toBe('sent');
    expect(outcome(429)).toBe('retry');
    expect(outcome(503)).toBe('retry');
    expect(outcome(400)).toBe('failed');
  });
});

describe('cards', () => {
  const row: Delivery = {
    event_id: 7,
    attempts: 1,
    type: 'write.document.shared',
    actor_id: 'a',
    recipient_id: 'r',
    recipient_address: null,
    subject: 'write:document:d',
    payload: { docId: 'd', notification: { title: 'Ola shared “Field notes” with you', body: 'You can comment.', link: '/d/d' } },
    created_at: '',
    channel: 'type_inbox',
  };
  it('turns Write shares into cards that open Write', () => {
    expect(cardFor(row, { write: 'https://elumwrite.netlify.app' })).toEqual({
      service: 'write',
      title: 'Ola shared “Field notes” with you',
      body: 'You can comment.',
      actionLabel: 'Open in Write',
      actionUrl: 'https://elumwrite.netlify.app/d/d',
    });
  });
  it('skips people who read email, invites and events without a notification', () => {
    expect(cardFor({ ...row, channel: 'email' }, {})).toBeNull();
    expect(cardFor({ ...row, recipient_id: null }, {})).toBeNull();
    expect(cardFor({ ...row, payload: {} }, {})).toBeNull();
    expect(cardFor({ ...row, type: 'elum.account.created' }, {})).toBeNull();
  });
});

describe('helpers', () => {
  it('checks secrets from a header or the URL', () => {
    expect(hasSecret(new Request('https://x/f', { headers: { Authorization: 'Bearer s3cret' } }), 's3cret')).toBe(true);
    expect(hasSecret(new Request('https://x/f?token=s3cret'), 's3cret')).toBe(true);
    expect(hasSecret(new Request('https://x/f?token=nope'), 's3cret')).toBe(false);
    expect(hasSecret(new Request('https://x/f'), undefined)).toBe(false);
  });
  it('answers errors in the ELUM shape', async () => {
    const res = fail('conflict', 'That name is taken.');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: { code: 'conflict', message: 'That name is taken.', details: {} } });
  });
  it('makes six-digit codes and spots throwaway domains', () => {
    expect(sixDigitCode(() => new Uint32Array([42]))).toBe('000042');
    expect(sixDigitCode()).toMatch(/^\d{6}$/);
    expect(isDisposable('x@mailinator.com')).toBe(true);
    expect(isDisposable('x@gmail.com')).toBe(false);
  });
});
