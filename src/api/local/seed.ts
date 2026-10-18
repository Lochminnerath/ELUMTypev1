import type { Address, DraftInput, SendResult } from '../types';
import type { Db, ReceiveInput } from './LocalApi';
import { ensureMailbox } from './LocalApi';

/**
 * Demo people and a first inbox for preview mode, so every part of Type has something to show:
 * an ELUM conversation, an email from outside with a blocked image and a file, and a Write share.
 */

/** The outside contact who answers emails in preview mode. */
export const OUTSIDE_FRIEND: Address = { address: 'kai@studio.example', name: 'Kai Moreno' };

// Demo accounts cannot be signed in to: this hash never matches.
const LOCKED = { salt: '00', hash: '', iterations: 1 };

const PEOPLE = [
  { id: 'demo-fen', name: 'Fen Field', handle: 'fen', email: null, color: '#9b84ee' },
  { id: 'demo-rae', name: 'Rae Reed', handle: 'rae', email: null, color: '#ec7fa9' },
  { id: 'demo-ola', name: 'Ola Owner', handle: null, email: 'ola@example.org', color: '#f59a52' },
];

export function seedPeople(db: Db, typeDomain: string) {
  for (const p of PEOPLE) {
    if (db.users[p.id]) continue;
    db.users[p.id] = {
      id: p.id,
      name: p.name,
      email: p.email ?? `${p.handle}@${typeDomain}`,
      color: p.color,
      accountType: p.handle ? 'type' : 'external',
      handle: p.handle,
      createdAt: '2026-09-01T09:00:00.000Z',
      password: LOCKED,
      seeded: true,
    };
    ensureMailbox(db, p.id, typeDomain);
  }
  // Rae is away, so writing to her shows a vacation reply.
  const rae = db.prefs['demo-rae'];
  if (rae && !rae.vacationOn && rae.version === 1) {
    db.prefs['demo-rae'] = { ...rae, vacationOn: true, vacationBody: 'I am away until Monday and will reply then. Rae', version: 2 };
  }
}

const TEXT_FILE = `data:text/plain;base64,${btoa('Spring catalogue\n\n- Cover: matte, 300gsm\n- 48 pages\n- Proofs due Thursday\n')}`;

export function seedWelcome(
  db: Db,
  userId: string,
  typeDomain: string,
  tools: { send: (input: DraftInput & { auto: boolean }) => SendResult; receive: (input: ReceiveInput) => string | null },
) {
  const me = ensureMailbox(db, userId, typeDomain);
  const myAddress = db.mailboxes[me].address;
  const fen = ensureMailbox(db, 'demo-fen', typeDomain);
  const firstName = db.users[userId].name.split(' ')[0];

  if (db.mailboxes[me].canEmail) {
    tools.receive({
      from: OUTSIDE_FRIEND,
      to: myAddress,
      subject: 'Proofs for the spring catalogue',
      text: `Hi ${firstName},\n\nHere are the notes for the spring catalogue. The cover proof is below; the final files follow on Thursday.\n\nKai`,
      html: `<p>Hi ${escape(firstName)},</p><p>Here are the notes for the spring catalogue. The cover proof is below; the final files follow on Thursday.</p><p><img src="https://images.studio.example/proofs/cover.png" alt="Cover proof" width="480"></p><p>Kai</p><script>alert('never runs')</script>`,
      files: [{ name: 'catalogue-notes.txt', mime: 'text/plain', bytes: 78, dataUrl: TEXT_FILE }],
    });
  }

  tools.send({
    id: crypto.randomUUID(),
    mailboxId: fen,
    threadId: null,
    to: [{ address: myAddress, name: db.users[userId].name }],
    cc: [],
    bcc: [],
    subject: '',
    text: `Welcome to Type, ${firstName}. Messages between ELUM people arrive the moment they are sent. Reply here to try it.`,
    html: null,
    auto: false,
  });

  const cardId = crypto.randomUUID();
  db.cards[cardId] = {
    id: cardId,
    mailboxId: me,
    service: 'write',
    title: 'Ola Owner shared “Field notes” with you',
    body: 'You can comment.',
    actionLabel: 'Open in Write',
    actionUrl: 'https://elumwrite.netlify.app/d/field-notes',
    createdAt: new Date().toISOString(),
    readAt: null,
    archivedAt: null,
    actor: { id: 'demo-ola', name: 'Ola Owner', color: '#f59a52' },
  };
  db.notifications.push({
    id: crypto.randomUUID(),
    accountId: userId,
    service: 'write',
    type: 'write.document.shared',
    title: 'Ola Owner shared “Field notes” with you',
    body: 'You can comment.',
    link: 'https://elumwrite.netlify.app/d/field-notes',
    createdAt: new Date().toISOString(),
    readAt: null,
    actor: { id: 'demo-ola', name: 'Ola Owner', color: '#f59a52' },
  });
}

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
