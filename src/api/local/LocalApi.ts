import { MAX_ATTACHMENTS_BYTES, MAX_RECIPIENTS, type NotificationsApi, type TypeApi } from '../client';
import { ApiError } from '../errors';
import type {
  Address,
  AppNotification,
  Attachment,
  Contact,
  Counts,
  Draft,
  DraftInput,
  Folder,
  InboxCard,
  InboxView,
  LiveEvent,
  Mailbox,
  Message,
  MessageStatus,
  Person,
  SendResult,
  Session,
  SignInInput,
  SignUpInput,
  Thread,
  ThreadKind,
  ThreadSummary,
  TypePreferences,
  TypeStart,
  User,
} from '../types';
import { checkPassword, cleanName, handleProblem, isEmail, loginToEmail } from '../validation';
import { DEFAULT_ITERATIONS, hashPassword, verifyPassword, type PasswordHash } from './passwords';
import { seedPeople, seedWelcome, OUTSIDE_FRIEND } from './seed';

/**
 * ELUM Type, running inside this browser for previews and development. It keeps the same rules
 * as the database (supabase/migrations/*_type_schema.sql): per-mailbox copies, Bcc, external
 * accounts that cannot email outside, draft versions, muting and vacation replies. Outside email
 * is simulated: it is marked delivered, and one demo contact writes back.
 */

const KEY = 'elum.type.preview';
const SESSION_KEY = 'elum.type.preview.session';
const ACCOUNT_DATA_KEY = 'elum.type.preview.account';
const MAX_LOCAL_FILE = 2 * 1024 * 1024;
const COLORS = ['#f59a52', '#3fc4a0', '#9b84ee', '#ec7fa9', '#e9b949', '#7093f8'];

export interface UserRow extends User {
  password: PasswordHash;
  seeded?: boolean;
}
export interface MailboxRow extends Mailbox {
  ownerId: string;
  createdAt: string;
}
export interface ThreadRow {
  id: string;
  kind: ThreadKind;
  subject: string | null;
  lastMessageAt: string;
  createdAt: string;
}
export interface ParticipantRow {
  threadId: string;
  address: string;
  mailboxId: string | null;
  name: string | null;
  folder: Folder;
  lastReadAt: string | null;
  muted: boolean;
  hidden: boolean;
  joinedAt: string;
}
export interface MessageRow {
  id: string;
  threadId: string;
  senderAddress: string;
  senderName: string | null;
  senderMailbox: string | null;
  to: Address[];
  cc: Address[];
  subject: string | null;
  text: string;
  html: string | null;
  headers: Record<string, string> | null;
  messageId: string;
  status: MessageStatus;
  hasRemoteImages: boolean;
  auto: boolean;
  createdAt: string;
  sentAt: string | null;
}
export interface RecipientRow {
  messageId: string;
  mailboxId: string;
  kind: 'from' | 'to' | 'cc' | 'bcc';
}
interface OutboxRow {
  messageId: string;
  address: string;
  name: string | null;
  kind: 'to' | 'cc' | 'bcc';
  status: 'pending' | 'sent' | 'failed';
}
interface DraftRow extends DraftInput {
  version: number;
  updatedAt: string;
}
interface AttachmentRow extends Attachment {
  messageId: string | null;
  draftId: string | null;
  dataUrl: string;
}
interface CardRow extends InboxCard {
  mailboxId: string;
}
interface NotificationRow extends AppNotification {
  accountId: string;
}

export interface Db {
  users: Record<string, UserRow>;
  mailboxes: Record<string, MailboxRow>;
  prefs: Record<string, TypePreferences>;
  imageSenders: Record<string, string[]>;
  threads: Record<string, ThreadRow>;
  participants: ParticipantRow[];
  messages: Record<string, MessageRow>;
  recipients: RecipientRow[];
  outbox: OutboxRow[];
  drafts: Record<string, DraftRow>;
  attachments: Record<string, AttachmentRow>;
  cards: Record<string, CardRow>;
  notifications: NotificationRow[];
  vacationLog: Record<string, string>;
}

const empty = (): Db => ({
  users: {},
  mailboxes: {},
  prefs: {},
  imageSenders: {},
  threads: {},
  participants: [],
  messages: {},
  recipients: [],
  outbox: [],
  drafts: {},
  attachments: {},
  cards: {},
  notifications: [],
  vacationLog: {},
});

const now = () => new Date().toISOString();
const snippet = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 160);
const uuid = () => crypto.randomUUID();

export interface LocalApiOptions {
  storage?: Storage;
  typeDomain?: string;
  /** Lower in tests to keep hashing fast. */
  passwordIterations?: number;
  /** Seed demo people and a welcome inbox. */
  demo?: boolean;
  /** Delay for simulated outside delivery and replies, in ms. 0 runs them at once (tests). */
  simulateDelay?: number;
}

export class LocalApi implements TypeApi {
  readonly mode = 'local' as const;
  readonly typeDomain: string;
  private readonly storage: Storage;
  private readonly iterations: number;
  private readonly demo: boolean;
  private readonly delay: number;
  private readonly listeners = new Set<(e: LiveEvent) => void>();
  private readonly noticeListeners = new Set<(n: AppNotification) => void>();
  private readonly unauthorizedHandlers = new Set<() => void>();
  private readonly channel: BroadcastChannel | null;

  constructor(options: LocalApiOptions = {}) {
    this.storage = options.storage ?? localStorage;
    this.typeDomain = options.typeDomain ?? 'type.elum.services';
    this.iterations = options.passwordIterations ?? DEFAULT_ITERATIONS;
    this.demo = options.demo ?? true;
    this.delay = options.simulateDelay ?? 1500;
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('elum-type-preview') : null;
    // Other tabs (another account, or the same one) see changes live.
    this.channel?.addEventListener('message', (e: MessageEvent<LiveEvent>) => this.listeners.forEach((l) => l(e.data)));
  }

  // ------------------------------------------------------------------ storage

  private read(): Db {
    try {
      const raw = this.storage.getItem(KEY);
      if (raw) return { ...empty(), ...(JSON.parse(raw) as Db) };
    } catch {
      // Start again.
    }
    return empty();
  }

  private write(db: Db) {
    try {
      this.storage.setItem(KEY, JSON.stringify(db));
    } catch {
      throw new ApiError('storage_full', 'This browser is out of space for the preview. Remove some attachments and try again.');
    }
  }

  /** Runs a change against a fresh copy and saves it. */
  private change<T>(fn: (db: Db) => T): T {
    const db = this.read();
    if (this.demo) seedPeople(db, this.typeDomain);
    const result = fn(db);
    this.write(db);
    return result;
  }

  private emit(event: LiveEvent) {
    this.listeners.forEach((l) => l(event));
    this.channel?.postMessage(event);
  }

  private me(db: Db): UserRow {
    const id = this.storage.getItem(SESSION_KEY);
    const user = id ? db.users[id] : undefined;
    if (!user) {
      this.unauthorizedHandlers.forEach((h) => h());
      throw new ApiError('unauthorized', 'Your session has ended. Sign in again.');
    }
    return user;
  }

  // ---------------------------------------------------------------- accounts

  async restoreSession(): Promise<Session | null> {
    const db = this.read();
    const id = this.storage.getItem(SESSION_KEY);
    const user = id ? db.users[id] : undefined;
    return user ? { user: publicUser(user) } : null;
  }

  async signIn(input: SignInInput): Promise<Session> {
    const db = this.read();
    if (this.demo) seedPeople(db, this.typeDomain);
    this.write(db);
    const email = loginToEmail(input.login, this.typeDomain);
    const user = Object.values(db.users).find((u) => u.email === email || addressesOf(db, u.id).includes(email));
    if (!user || !(await verifyPassword(input.password, user.password))) {
      throw new ApiError('invalid_credentials', 'That address and password do not match.');
    }
    this.storage.setItem(SESSION_KEY, user.id);
    return { user: publicUser(user) };
  }

  async signUp(input: SignUpInput): Promise<Session> {
    const name = cleanName(input.name);
    checkPassword(input.password);
    let email: string;
    let handle: string | null = null;
    if (input.kind === 'type') {
      const problem = handleProblem(input.handle);
      if (problem) throw new ApiError('invalid', problem, { field: 'handle' });
      if (input.recoveryEmail && !isEmail(input.recoveryEmail)) {
        throw new ApiError('invalid', 'Enter a valid recovery email, or leave it empty.', { field: 'recoveryEmail' });
      }
      handle = input.handle.trim().toLowerCase();
      email = `${handle}@${this.typeDomain}`;
    } else {
      email = input.email.trim().toLowerCase();
      if (!isEmail(email)) throw new ApiError('invalid', 'Enter a valid email address.', { field: 'email' });
    }
    const password = await hashPassword(input.password, this.iterations);
    const user = this.change((db) => {
      if (Object.values(db.users).some((u) => u.email === email || (handle !== null && u.handle === handle))) {
        throw input.kind === 'type'
          ? new ApiError('conflict', 'That name is taken.', { field: 'handle' })
          : new ApiError('email_taken', 'An account with this email already exists. Sign in instead.', { field: 'email' });
      }
      const row: UserRow = {
        id: uuid(),
        name,
        email,
        color: COLORS[Object.keys(db.users).length % COLORS.length],
        accountType: input.kind,
        handle,
        createdAt: now(),
        password,
      };
      db.users[row.id] = row;
      return row;
    });
    this.storage.setItem(SESSION_KEY, user.id);
    return { user: publicUser(user) };
  }

  async signOut(): Promise<void> {
    this.storage.removeItem(SESSION_KEY);
  }

  async accountData(): Promise<Record<string, unknown>> {
    const id = this.storage.getItem(SESSION_KEY);
    if (!id) return {};
    try {
      return JSON.parse(this.storage.getItem(`${ACCOUNT_DATA_KEY}.${id}`) ?? '{}') as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  async updateAccountData(patch: Record<string, unknown>): Promise<void> {
    const id = this.storage.getItem(SESSION_KEY);
    if (!id) return;
    const next = { ...(await this.accountData()), ...patch };
    try {
      this.storage.setItem(`${ACCOUNT_DATA_KEY}.${id}`, JSON.stringify(next));
    } catch {
      // Nothing important is lost: these are conveniences.
    }
  }

  async updateName(name: string): Promise<User> {
    const clean = cleanName(name);
    return this.change((db) => {
      const me = this.me(db);
      me.name = clean;
      for (const mb of Object.values(db.mailboxes)) if (mb.ownerId === me.id) mb.displayName = clean;
      return publicUser(me);
    });
  }

  async handleAvailable(handle: string): Promise<boolean> {
    if (handleProblem(handle)) return false;
    const db = this.read();
    if (this.demo) seedPeople(db, this.typeDomain);
    const h = handle.trim().toLowerCase();
    return !Object.values(db.users).some((u) => u.handle === h);
  }

  onUnauthorized(handler: () => void): () => void {
    this.unauthorizedHandlers.add(handler);
    return () => this.unauthorizedHandlers.delete(handler);
  }

  // -------------------------------------------------------------------- Type

  async start(): Promise<TypeStart> {
    const result = this.change((db) => {
      const me = this.me(db);
      ensureMailbox(db, me.id, this.typeDomain);
      if (this.demo && !me.seeded) {
        me.seeded = true;
        seedWelcome(db, me.id, this.typeDomain, {
          send: (input) => this.deliverInternal(db, input),
          receive: (input) => this.receiveInto(db, input),
        });
      }
      return startFor(db, me.id, this.typeDomain);
    });
    return result;
  }

  async listThreads({ view, query, before, limit = 50 }: { view: InboxView; query?: string; before?: string; limit?: number }): Promise<ThreadSummary[]> {
    const db = this.read();
    const me = this.me(db);
    const q = query?.trim().toLowerCase();
    const rows: ThreadSummary[] = [];
    for (const p of myParticipants(db, me.id)) {
      const thread = db.threads[p.threadId];
      const messages = visibleMessages(db, p.threadId, p.mailboxId!);
      if (!thread || !messages.length) continue;
      const last = messages[messages.length - 1];
      const unread = messages.some((m) => m.senderMailbox !== p.mailboxId && (!p.lastReadAt || m.createdAt > p.lastReadAt));
      const include =
        view === 'inbox' ? p.folder === 'inbox'
        : view === 'unread' ? p.folder === 'inbox' && unread
        : view === 'elum' ? p.folder === 'inbox' && thread.kind === 'elum'
        : view === 'email' ? p.folder === 'inbox' && thread.kind === 'email'
        : p.folder === view;
      if (!include || (before && last.createdAt >= before)) continue;
      const others = people(db, p.threadId, p.mailboxId!, false);
      if (q) {
        const hay = [thread.subject ?? '', ...others.map((o) => `${o.name ?? ''} ${o.address}`), ...messages.map((m) => m.text)].join(' ').toLowerCase();
        if (!hay.includes(q)) continue;
      }
      rows.push({
        id: thread.id,
        kind: thread.kind,
        subject: thread.subject,
        snippet: snippet(last.text),
        lastMessageAt: last.createdAt,
        unread,
        folder: p.folder,
        muted: p.muted,
        hasAttachments: messages.some((m) => Object.values(db.attachments).some((a) => a.messageId === m.id)),
        messageCount: messages.length,
        lastSender: { address: last.senderAddress, name: last.senderName },
        participants: others,
      });
    }
    return rows.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)).slice(0, Math.min(limit, 100));
  }

  async getThread(id: string): Promise<Thread> {
    const db = this.read();
    const me = this.me(db);
    const p = myParticipants(db, me.id).find((x) => x.threadId === id);
    const thread = db.threads[id];
    if (!p || !thread) throw new ApiError('not_found', 'This conversation does not exist or was deleted.');
    const mailboxId = p.mailboxId!;
    return {
      id,
      kind: thread.kind,
      subject: thread.subject,
      lastMessageAt: thread.lastMessageAt,
      me: { mailboxId, address: p.address, folder: p.folder, muted: p.muted, lastReadAt: p.lastReadAt },
      participants: people(db, id, mailboxId, true),
      messages: visibleMessages(db, id, mailboxId).map((m) => toMessage(db, m, mailboxId)),
    };
  }

  async markRead(threadId: string, read = true): Promise<void> {
    this.change((db) => {
      const me = this.me(db);
      for (const p of myParticipants(db, me.id)) if (p.threadId === threadId) p.lastReadAt = read ? now() : null;
    });
    this.emit({ kind: 'inbox' });
  }

  async move(threadIds: string[], folder: Folder): Promise<void> {
    if (!['inbox', 'archive', 'trash', 'spam'].includes(folder)) throw new ApiError('invalid', 'Choose inbox, archive, spam or trash.');
    this.change((db) => {
      const me = this.me(db);
      for (const p of myParticipants(db, me.id)) if (threadIds.includes(p.threadId)) p.folder = folder;
    });
    this.emit({ kind: 'inbox' });
  }

  async setMuted(threadId: string, muted: boolean): Promise<void> {
    this.change((db) => {
      const me = this.me(db);
      for (const p of myParticipants(db, me.id)) if (p.threadId === threadId) p.muted = muted;
    });
    this.emit({ kind: 'inbox' });
  }

  async counts(): Promise<Counts> {
    const unread = (await this.listThreads({ view: 'unread', limit: 100 })).length;
    const db = this.read();
    const me = this.me(db);
    const mine = mailboxIdsOf(db, me.id);
    const cards = Object.values(db.cards).filter((c) => mine.includes(c.mailboxId) && !c.readAt && !c.archivedAt).length;
    return { unread, cards };
  }

  async send(input: DraftInput): Promise<SendResult> {
    const result = this.change((db) => {
      const me = this.me(db);
      const mailbox = db.mailboxes[input.mailboxId];
      if (!mailbox || mailbox.ownerId !== me.id) throw new ApiError('forbidden', 'You can only send from your own addresses.');
      const existing = db.messages[input.id];
      if (existing) {
        if (existing.senderMailbox === mailbox.id) return { messageId: existing.id, threadId: existing.threadId, status: existing.status };
        throw new ApiError('conflict', 'That message id is already used.');
      }
      return this.deliverInternal(db, { ...input, auto: false });
    });
    this.emit({ kind: 'inbox' });
    this.emit({ kind: 'message', threadId: result.threadId });
    if (result.status === 'queued') this.simulateOutside(result.messageId);
    return result;
  }

  async saveDraft(input: DraftInput, version: number): Promise<{ version: number; updatedAt: string }> {
    return this.change((db) => {
      const me = this.me(db);
      const mailbox = db.mailboxes[input.mailboxId];
      if (!mailbox || mailbox.ownerId !== me.id) throw new ApiError('forbidden', 'You can only write from your own addresses.');
      const existing = db.drafts[input.id];
      if (!existing) {
        if (db.messages[input.id]) throw new ApiError('conflict', 'This message was already sent.', { version: 0 });
        db.drafts[input.id] = { ...input, version: 1, updatedAt: now() };
      } else {
        if (db.mailboxes[existing.mailboxId]?.ownerId !== me.id) throw new ApiError('not_found', 'That draft does not exist.');
        if (existing.version !== version) throw new ApiError('conflict', 'This draft changed on another device.', { version: existing.version });
        db.drafts[input.id] = { ...input, version: existing.version + 1, updatedAt: now() };
      }
      const d = db.drafts[input.id];
      return { version: d.version, updatedAt: d.updatedAt };
    });
  }

  async listDrafts(): Promise<Draft[]> {
    const db = this.read();
    const me = this.me(db);
    const mine = mailboxIdsOf(db, me.id);
    return Object.values(db.drafts)
      .filter((d) => mine.includes(d.mailboxId))
      .map((d) => ({ ...d, attachments: Object.values(db.attachments).filter((a) => a.draftId === d.id).map(publicAttachment) }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async deleteDraft(id: string): Promise<void> {
    this.change((db) => {
      const me = this.me(db);
      const d = db.drafts[id];
      if (d && db.mailboxes[d.mailboxId]?.ownerId === me.id) {
        delete db.drafts[id];
        for (const a of Object.values(db.attachments)) if (a.draftId === id) delete db.attachments[a.id];
      }
    });
  }

  async attach(draftId: string, file: File): Promise<Attachment> {
    if (file.size > MAX_LOCAL_FILE) throw new ApiError('too_large', 'In preview mode, files can be up to 2 MB. Connected to ELUM, up to 25 MB.');
    const dataUrl = await readAsDataUrl(file);
    return this.change((db) => {
      const me = this.me(db);
      const d = db.drafts[draftId];
      if (!d || db.mailboxes[d.mailboxId]?.ownerId !== me.id) throw new ApiError('not_found', 'Save the message first, then attach files.');
      const total = Object.values(db.attachments).filter((a) => a.draftId === draftId).reduce((n, a) => n + a.bytes, 0);
      if (total + file.size > MAX_ATTACHMENTS_BYTES) throw new ApiError('too_large', 'Attachments can add up to 25 MB.');
      const row: AttachmentRow = {
        id: uuid(),
        path: `${draftId}/${file.name}`,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        bytes: file.size,
        messageId: null,
        draftId,
        dataUrl,
      };
      db.attachments[row.id] = row;
      return publicAttachment(row);
    });
  }

  async removeAttachment(id: string): Promise<void> {
    this.change((db) => {
      const me = this.me(db);
      const a = db.attachments[id];
      const d = a?.draftId ? db.drafts[a.draftId] : undefined;
      if (a && d && db.mailboxes[d.mailboxId]?.ownerId === me.id) delete db.attachments[id];
    });
  }

  async attachmentUrl(attachment: Attachment): Promise<string> {
    const db = this.read();
    this.me(db);
    const row = db.attachments[attachment.id];
    if (!row) throw new ApiError('not_found', 'That file is no longer available.');
    return row.dataUrl;
  }

  async contacts(query?: string): Promise<Contact[]> {
    const db = this.read();
    const me = this.me(db);
    const q = query?.trim().toLowerCase() ?? '';
    const mine = mailboxIdsOf(db, me.id);
    const known = new Map<string, Contact>();
    for (const p of myParticipants(db, me.id)) {
      const thread = db.threads[p.threadId];
      for (const o of db.participants.filter((x) => x.threadId === p.threadId && !x.hidden && !(x.mailboxId && mine.includes(x.mailboxId)))) {
        const prev = known.get(o.address);
        const color = o.mailboxId ? db.users[db.mailboxes[o.mailboxId]?.ownerId]?.color : null;
        if (!prev || (prev.lastContactAt ?? '') < thread.lastMessageAt) {
          known.set(o.address, { address: o.address, name: o.name ?? prev?.name ?? null, isElum: !!o.mailboxId, color, lastContactAt: thread.lastMessageAt });
        }
      }
    }
    let list = [...known.values()].filter((c) => !q || c.address.includes(q) || (c.name ?? '').toLowerCase().includes(q));
    if (q.length >= 2) {
      for (const u of Object.values(db.users)) {
        if (u.id === me.id) continue;
        if (!(u.name.toLowerCase().includes(q) || u.email.startsWith(q) || (u.handle ?? '').startsWith(q))) continue;
        const address = u.handle ? `${u.handle}@${this.typeDomain}` : u.email;
        if (!list.some((c) => c.address === address)) list.push({ address, name: u.name, isElum: true, color: u.color, lastContactAt: null });
      }
    }
    list = list.sort((a, b) => (b.lastContactAt ?? '').localeCompare(a.lastContactAt ?? '') || (a.name ?? a.address).localeCompare(b.name ?? b.address));
    return list.slice(0, 30);
  }

  async listCards({ archived = false }: { archived?: boolean } = {}): Promise<InboxCard[]> {
    const db = this.read();
    const me = this.me(db);
    const mine = mailboxIdsOf(db, me.id);
    return Object.values(db.cards)
      .filter((c) => mine.includes(c.mailboxId) && !!c.archivedAt === archived)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ mailboxId: _mailbox, ...card }) => card);
  }

  async markCard(id: string, change: { read?: boolean; archived?: boolean }): Promise<void> {
    this.change((db) => {
      const me = this.me(db);
      const card = db.cards[id];
      if (!card || !mailboxIdsOf(db, me.id).includes(card.mailboxId)) return;
      if (change.read !== undefined) card.readAt = change.read ? (card.readAt ?? now()) : null;
      if (change.archived !== undefined) card.archivedAt = change.archived ? (card.archivedAt ?? now()) : null;
    });
    this.emit({ kind: 'card' });
  }

  async updatePreferences(patch: Partial<Omit<TypePreferences, 'version'>>, version: number): Promise<TypePreferences> {
    return this.change((db) => {
      const me = this.me(db);
      ensureMailbox(db, me.id, this.typeDomain);
      const prefs = db.prefs[me.id];
      if (prefs.version !== version) throw new ApiError('conflict', 'Your settings changed on another device.', { version: prefs.version });
      if (patch.defaultMailbox && db.mailboxes[patch.defaultMailbox]?.ownerId !== me.id) throw new ApiError('invalid', 'Choose one of your addresses.');
      db.prefs[me.id] = { ...prefs, ...patch, version: prefs.version + 1 };
      return db.prefs[me.id];
    });
  }

  async updateMailbox(id: string, change: { displayName?: string; signature?: string }): Promise<Mailbox> {
    return this.change((db) => {
      const me = this.me(db);
      const mb = db.mailboxes[id];
      if (!mb || mb.ownerId !== me.id) throw new ApiError('not_found', 'That address is not yours.');
      if (change.displayName !== undefined) mb.displayName = cleanName(change.displayName);
      if (change.signature !== undefined) mb.signature = change.signature.slice(0, 2000) || null;
      return publicMailbox(mb);
    });
  }

  async allowImages(address: string, allow: boolean): Promise<void> {
    this.change((db) => {
      const me = this.me(db);
      const list = new Set(db.imageSenders[me.id] ?? []);
      if (allow) list.add(address.toLowerCase());
      else list.delete(address.toLowerCase());
      db.imageSenders[me.id] = [...list];
    });
  }

  async confirmRecovery(): Promise<string> {
    throw new ApiError('not_found', 'Recovery emails are confirmed once ELUM is connected.');
  }

  async resendRecovery(): Promise<void> {
    throw new ApiError('not_found', 'Recovery emails are confirmed once ELUM is connected.');
  }

  async handoff(): Promise<string> {
    throw new ApiError('not_found', 'Signing in to other ELUM apps works once ELUM is connected.');
  }

  async completeHandoff(): Promise<Session> {
    throw new ApiError('not_found', 'Signing in from other ELUM apps works once ELUM is connected.');
  }

  subscribe(onChange: (event: LiveEvent) => void): () => void {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  }

  readonly notifications: NotificationsApi = {
    list: async ({ unreadOnly = false, limit = 30 } = {}) => {
      const db = this.read();
      const me = this.me(db);
      return db.notifications
        .filter((n) => n.accountId === me.id && (!unreadOnly || !n.readAt))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(({ accountId: _account, ...n }) => n);
    },
    markRead: async (ids) => {
      this.change((db) => {
        const me = this.me(db);
        for (const n of db.notifications) if (n.accountId === me.id && !n.readAt && (!ids || ids.includes(n.id))) n.readAt = now();
      });
    },
    subscribe: (onNew) => {
      this.noticeListeners.add(onNew);
      return () => this.noticeListeners.delete(onNew);
    },
  };

  // ---------------------------------------------------------------- delivery

  /**
   * The local twin of public.type_send_message: resolves recipients, writes the message and every
   * copy, queues outside mail, notifies, and answers with vacation replies.
   */
  private deliverInternal(db: Db, input: DraftInput & { auto: boolean }): SendResult {
    const mailbox = db.mailboxes[input.mailboxId];
    const recipients = new Map<string, { address: string; name: string | null; kind: 'to' | 'cc' | 'bcc'; mailbox: string | null }>();
    for (const [kind, list] of [['to', input.to], ['cc', input.cc], ['bcc', input.bcc]] as const) {
      for (const r of list) {
        const address = r.address.trim().toLowerCase();
        if (!address || recipients.has(address)) continue;
        if (!isEmail(address)) throw new ApiError('invalid', `${address} is not a valid email address.`);
        recipients.set(address, { address, name: r.name?.trim() || null, kind, mailbox: null });
      }
    }
    if (!recipients.size) throw new ApiError('invalid', 'Add someone to send to.');
    if (recipients.size > MAX_RECIPIENTS) throw new ApiError('invalid', `You can send to up to ${MAX_RECIPIENTS} people at once.`);
    for (const r of recipients.values()) {
      r.mailbox = mailboxForAddress(db, r.address, this.typeDomain);
      if (r.mailbox) r.name = r.name ?? db.mailboxes[r.mailbox].displayName;
    }
    const external = [...recipients.values()].filter((r) => !r.mailbox);
    const files = Object.values(db.attachments).filter((a) => a.draftId === input.id);
    if (!input.text.trim() && !files.length) throw new ApiError('invalid', 'Write something first.');
    if (external.length && !mailbox.canEmail) throw new ApiError('forbidden', 'Get an ELUM address to email people outside ELUM.');

    let threadId = input.threadId;
    let subject = input.subject.trim().slice(0, 300) || null;
    let inReplyTo: string | null = null;
    if (threadId) {
      if (!db.participants.some((p) => p.threadId === threadId && p.mailboxId === mailbox.id)) {
        throw new ApiError('not_found', 'This conversation does not exist or was deleted.');
      }
      const thread = db.threads[threadId];
      if (external.length) thread.kind = 'email';
      subject = subject ?? thread.subject;
      inReplyTo = visibleMessages(db, threadId, mailbox.id).at(-1)?.messageId ?? null;
    } else {
      threadId = uuid();
      db.threads[threadId] = { id: threadId, kind: external.length ? 'email' : 'elum', subject, lastMessageAt: now(), createdAt: now() };
    }

    const status: MessageStatus = external.length ? 'queued' : 'sent';
    const message: MessageRow = {
      id: input.id,
      threadId,
      senderAddress: mailbox.address,
      senderName: mailbox.displayName,
      senderMailbox: mailbox.id,
      to: [...recipients.values()].filter((r) => r.kind === 'to').map(({ address, name }) => ({ address, name })),
      cc: [...recipients.values()].filter((r) => r.kind === 'cc').map(({ address, name }) => ({ address, name })),
      subject,
      text: input.text,
      html: input.html,
      headers: inReplyTo ? { 'In-Reply-To': inReplyTo } : null,
      messageId: `<${input.id}@${this.typeDomain}>`,
      status,
      hasRemoteImages: false,
      auto: input.auto,
      createdAt: now(),
      sentAt: now(),
    };
    db.messages[message.id] = message;
    for (const f of files) {
      f.messageId = message.id;
      f.draftId = null;
    }
    delete db.drafts[input.id];

    db.recipients.push({ messageId: message.id, mailboxId: mailbox.id, kind: 'from' });
    const own = upsertParticipant(db, threadId, mailbox.address, mailbox.id, mailbox.displayName, 'inbox', false);
    own.lastReadAt = now();
    own.hidden = false;
    if (own.folder === 'archive' || own.folder === 'trash') own.folder = 'inbox';
    for (const r of external) {
      if (r.kind !== 'bcc') upsertParticipant(db, threadId, r.address, null, r.name, 'inbox', false);
      db.outbox.push({ messageId: message.id, address: r.address, name: r.name, kind: r.kind, status: 'pending' });
    }
    for (const r of recipients.values()) if (r.mailbox) this.deliverCopy(db, message, r.mailbox, r.kind);
    if (!input.auto) {
      for (const r of recipients.values()) {
        if (r.mailbox && r.mailbox !== mailbox.id) this.vacationReply(db, r.mailbox, threadId, mailbox.address, mailbox.displayName, subject);
      }
    }
    db.threads[threadId].lastMessageAt = now();
    return { messageId: message.id, threadId, status };
  }

  private deliverCopy(db: Db, m: MessageRow, mailboxId: string, kind: RecipientRow['kind'], folder: Folder = 'inbox') {
    if (db.recipients.some((r) => r.messageId === m.id && r.mailboxId === mailboxId)) return;
    const mb = db.mailboxes[mailboxId];
    db.recipients.push({ messageId: m.id, mailboxId, kind });
    const p = upsertParticipant(db, m.threadId, mb.address, mb.id, mb.displayName, folder, kind === 'bcc');
    p.hidden = p.hidden && kind === 'bcc';
    if (p.folder === 'archive') p.folder = 'inbox';
    if (mailboxId === m.senderMailbox || folder === 'spam' || p.muted) return;
    const note: NotificationRow = {
      id: uuid(),
      accountId: mb.ownerId,
      service: 'type',
      type: 'type.message.received',
      title: `${m.senderName || m.senderAddress} sent you a message`,
      body: m.subject || snippet(m.text),
      link: `/t/${m.threadId}`,
      createdAt: now(),
      readAt: null,
      actor: m.senderMailbox ? pickActor(db, db.mailboxes[m.senderMailbox]?.ownerId) : null,
    };
    db.notifications.push(note);
    const session = this.storage.getItem(SESSION_KEY);
    if (session === mb.ownerId) queueMicrotask(() => this.noticeListeners.forEach((l) => l(note)));
  }

  private vacationReply(db: Db, mailboxId: string, threadId: string, to: string, toName: string | null, subject: string | null) {
    const mb = db.mailboxes[mailboxId];
    const prefs = db.prefs[mb.ownerId];
    if (!prefs?.vacationOn || (prefs.vacationUntil && prefs.vacationUntil < now())) return;
    const key = `${mailboxId}|${to}`;
    const last = db.vacationLog[key];
    if (last && Date.now() - Date.parse(last) < 4 * 24 * 3600 * 1000) return;
    db.vacationLog[key] = now();
    this.deliverInternal(db, {
      id: uuid(),
      mailboxId,
      threadId,
      to: [{ address: to, name: toName }],
      cc: [],
      bcc: [],
      subject: prefs.vacationSubject || `Away: ${subject ?? 'your message'}`,
      text: prefs.vacationBody || 'I am away at the moment and will reply when I am back.',
      html: null,
      auto: true,
    });
  }

  /** Outside mail in preview: delivered after a moment; the demo contact writes back. */
  private simulateOutside(messageId: string) {
    const run = () => {
      let reply: { threadId: string; to: string } | null = null;
      this.change((db) => {
        const m = db.messages[messageId];
        if (!m) return;
        for (const o of db.outbox) if (o.messageId === messageId) o.status = 'sent';
        m.status = 'delivered';
        if (db.outbox.some((o) => o.messageId === messageId && o.address === OUTSIDE_FRIEND.address) && !m.auto) {
          reply = { threadId: m.threadId, to: m.senderAddress };
        }
      });
      this.emit({ kind: 'message', threadId: this.read().messages[messageId]?.threadId ?? '' });
      if (reply) {
        const { threadId, to } = reply;
        const later = () => {
          this.receiveEmail({
            threadId,
            from: OUTSIDE_FRIEND,
            to,
            subject: null,
            text: 'Thanks, got it. I will send the final proofs on Thursday.\n\nKai',
            html: '<p>Thanks, got it. I will send the final proofs on Thursday.</p><p>Kai</p>',
          });
        };
        if (this.delay) setTimeout(later, this.delay * 2);
        else later();
      }
    };
    if (this.delay) setTimeout(run, this.delay);
    else run();
  }

  private receiveEmail(input: ReceiveInput & { threadId: string }) {
    this.change((db) => this.receiveInto(db, input));
    this.emit({ kind: 'inbox' });
    this.emit({ kind: 'message', threadId: input.threadId });
  }

  /** The local twin of type-inbound and public.type_receive_email. */
  private receiveInto(db: Db, input: ReceiveInput): string | null {
    const mbId = Object.values(db.mailboxes).find((m) => m.address === input.to)?.id;
    if (!mbId) return null;
    let thread = input.threadId ? db.threads[input.threadId] : undefined;
    if (!thread) {
      thread = { id: uuid(), kind: 'email', subject: input.subject, lastMessageAt: now(), createdAt: now() };
      db.threads[thread.id] = thread;
    }
    {
      const id = uuid();
      const m: MessageRow = {
        id,
        threadId: thread.id,
        senderAddress: input.from.address,
        senderName: input.from.name ?? null,
        senderMailbox: null,
        to: [{ address: input.to, name: db.mailboxes[mbId].displayName }],
        cc: [],
        subject: input.subject ?? (thread.subject ? `Re: ${thread.subject.replace(/^re:\s*/i, '')}` : null),
        text: input.text,
        html: input.html,
        headers: { From: input.from.name ? `${input.from.name} <${input.from.address}>` : input.from.address, 'Message-ID': `<${id}@${input.from.address.split('@')[1]}>` },
        messageId: `<${id}@${input.from.address.split('@')[1]}>`,
        status: 'received',
        hasRemoteImages: /<img[^>]+src=["']?https?:/i.test(input.html ?? ''),
        auto: false,
        createdAt: now(),
        sentAt: now(),
      };
      db.messages[id] = m;
      for (const f of input.files ?? []) {
        const fid = uuid();
        db.attachments[fid] = { id: fid, path: `${id}/${f.name}`, name: f.name, mime: f.mime, bytes: f.bytes, messageId: id, draftId: null, dataUrl: f.dataUrl };
      }
      upsertParticipant(db, thread.id, input.from.address, null, input.from.name ?? null, 'inbox', false);
      this.deliverCopy(db, m, mbId, 'to');
      thread.lastMessageAt = now();
    }
    return thread.id;
  }
}

export interface ReceiveInput {
  threadId?: string;
  from: Address;
  to: string;
  subject: string | null;
  text: string;
  html: string | null;
  files?: { name: string; mime: string; bytes: number; dataUrl: string }[];
}

// ------------------------------------------------------------------ helpers

function publicUser({ password: _p, seeded: _s, ...user }: UserRow): User {
  return user;
}

function publicMailbox({ ownerId: _o, createdAt: _c, ...mb }: MailboxRow): Mailbox {
  return mb;
}

function publicAttachment({ messageId: _m, draftId: _d, dataUrl: _u, ...a }: AttachmentRow): Attachment {
  return a;
}

function pickActor(db: Db, userId: string | undefined) {
  const u = userId ? db.users[userId] : undefined;
  return u ? { id: u.id, name: u.name, color: u.color } : null;
}

function addressesOf(db: Db, userId: string): string[] {
  return Object.values(db.mailboxes).filter((m) => m.ownerId === userId).map((m) => m.address);
}

function mailboxIdsOf(db: Db, userId: string): string[] {
  return Object.values(db.mailboxes).filter((m) => m.ownerId === userId).map((m) => m.id);
}

/** Mirrors type.ensure_mailbox: the Type address when there is one, else the login address. */
export function ensureMailbox(db: Db, userId: string, typeDomain: string): string {
  const u = db.users[userId];
  const address = u.handle ? `${u.handle}@${typeDomain}` : u.email;
  let mb = Object.values(db.mailboxes).find((m) => m.address === address);
  if (!mb) {
    mb = { id: crypto.randomUUID(), ownerId: userId, address, displayName: u.name, signature: null, canEmail: !!u.handle, createdAt: now() };
    db.mailboxes[mb.id] = mb;
  }
  db.prefs[userId] ??= { defaultMailbox: mb.id, loadImages: 'ask', vacationOn: false, vacationSubject: null, vacationBody: null, vacationUntil: null, version: 1 };
  return db.prefs[userId].defaultMailbox ?? mb.id;
}

/** Mirrors type.mailbox_for_address: any address of an ELUM account reaches its inbox. */
function mailboxForAddress(db: Db, address: string, typeDomain: string): string | null {
  const direct = Object.values(db.mailboxes).find((m) => m.address === address);
  if (direct) return direct.id;
  const user = Object.values(db.users).find((u) => u.email === address || (u.handle && `${u.handle}@${typeDomain}` === address));
  return user ? ensureMailbox(db, user.id, typeDomain) : null;
}

function startFor(db: Db, userId: string, typeDomain: string): TypeStart {
  return {
    typeDomain,
    mailboxes: Object.values(db.mailboxes)
      .filter((m) => m.ownerId === userId)
      .sort((a, b) => Number(b.canEmail) - Number(a.canEmail))
      .map(publicMailbox),
    preferences: db.prefs[userId],
    imageSenders: db.imageSenders[userId] ?? [],
  };
}

function myParticipants(db: Db, userId: string): ParticipantRow[] {
  const mine = mailboxIdsOf(db, userId);
  return db.participants.filter((p) => p.mailboxId && mine.includes(p.mailboxId));
}

function visibleMessages(db: Db, threadId: string, mailboxId: string): MessageRow[] {
  const ids = new Set(db.recipients.filter((r) => r.mailboxId === mailboxId).map((r) => r.messageId));
  return Object.values(db.messages)
    .filter((m) => m.threadId === threadId && ids.has(m.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function people(db: Db, threadId: string, mailboxId: string, includeMe: boolean): Person[] {
  return db.participants
    .filter((p) => p.threadId === threadId && (p.mailboxId === mailboxId ? includeMe : !p.hidden))
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))
    .map((p) => ({
      address: p.address,
      name: p.name,
      isElum: !!p.mailboxId,
      color: p.mailboxId ? (db.users[db.mailboxes[p.mailboxId]?.ownerId]?.color ?? null) : null,
    }));
}

function upsertParticipant(db: Db, threadId: string, address: string, mailboxId: string | null, name: string | null, folder: Folder, hidden: boolean) {
  let p = db.participants.find((x) => x.threadId === threadId && x.address === address);
  if (!p) {
    p = { threadId, address, mailboxId, name, folder, lastReadAt: null, muted: false, hidden, joinedAt: now() };
    db.participants.push(p);
  } else {
    p.mailboxId = mailboxId ?? p.mailboxId;
    p.name = p.name ?? name;
  }
  return p;
}

function toMessage(db: Db, m: MessageRow, mailboxId: string): Message {
  const mine = m.senderMailbox === mailboxId;
  const sender = m.senderMailbox ? db.mailboxes[m.senderMailbox] : undefined;
  return {
    id: m.id,
    from: { address: m.senderAddress, name: m.senderName, isElum: !!m.senderMailbox, color: sender ? db.users[sender.ownerId]?.color : null },
    mine,
    to: m.to,
    cc: m.cc,
    bcc: mine
      ? [
          ...db.outbox.filter((o) => o.messageId === m.id && o.kind === 'bcc').map((o) => ({ address: o.address, name: o.name })),
          ...db.recipients
            .filter((r) => r.messageId === m.id && r.kind === 'bcc')
            .map((r) => ({ address: db.mailboxes[r.mailboxId].address, name: db.mailboxes[r.mailboxId].displayName })),
        ]
      : [],
    subject: m.subject,
    text: m.text,
    html: m.html,
    headers: m.headers,
    messageId: m.messageId,
    status: m.status,
    auto: m.auto,
    hasRemoteImages: m.hasRemoteImages,
    createdAt: m.createdAt,
    sentAt: m.sentAt,
    failed: mine ? db.outbox.filter((o) => o.messageId === m.id && o.status === 'failed').map((o) => o.address) : [],
    attachments: Object.values(db.attachments).filter((a) => a.messageId === m.id).map(publicAttachment),
  };
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ApiError('invalid', 'That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

export const LOCAL_KEYS = { data: KEY, session: SESSION_KEY };
