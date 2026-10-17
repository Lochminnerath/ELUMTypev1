import { createClient, type RealtimeChannel, type Session as AuthSession, type SupabaseClient } from '@supabase/supabase-js';
import { MAX_ATTACHMENTS_BYTES, type NotificationsApi, type TypeApi } from '../client';
import { ApiError, toApiError, type RawError } from '../errors';
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
  Person,
  SendResult,
  Session,
  SignInInput,
  SignUpInput,
  Thread,
  ThreadSummary,
  TypePreferences,
  TypeStart,
  User,
} from '../types';
import { checkPassword, cleanName, handleProblem, isEmail, loginToEmail } from '../validation';
import { cookieStorage } from './cookieStorage';

/**
 * ELUM Type on the shared ELUM Supabase project.
 *
 * - Auth: one account for every ELUM service. With VITE_ELUM_COOKIE_DOMAIN set, the session
 *   lives in cookies on the family domain, so signing in to Write signs you in here too.
 * - Database: only through public.type_* (Type's own functions) and public.elum_* (the
 *   platform's). Every permission is checked there; this class shapes requests and errors.
 * - Storage: attachments in the private type-attachments bucket.
 * - Realtime: new messages, inbox changes, cards and notifications arrive live.
 * - Edge functions: type-signup creates Type accounts; type-send delivers outside mail.
 */

const BUCKET = 'type-attachments';
const SIGNED_URL_SECONDS = 60 * 30;

interface ProfileRow {
  id: string;
  name: string;
  email: string;
  color: string;
  account_type: 'type' | 'external';
  handle: string | null;
  created_at: string;
}

interface ThreadRow {
  thread_id: string;
  kind: 'elum' | 'email';
  subject: string | null;
  snippet: string;
  last_message_at: string;
  unread: boolean;
  folder: Folder;
  muted: boolean;
  has_attachments: boolean;
  message_count: number;
  last_sender: Address;
  participants: Person[];
}

interface CardRow {
  id: string;
  service_id: string;
  title: string;
  body: string | null;
  action_label: string | null;
  action_url: string | null;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
  actor: InboxCard['actor'];
}

interface NotificationRow {
  id: string;
  service_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
  actor: AppNotification['actor'];
}

export class SupabaseApi implements TypeApi {
  readonly mode = 'remote' as const;
  readonly typeDomain: string;
  readonly sb: SupabaseClient;
  private readonly unauthorizedHandlers = new Set<() => void>();
  private readonly signedUrls = new Map<string, { url: string; expires: number }>();
  private mailboxIds: string[] = [];

  constructor(url: string, anonKey: string, options: { typeDomain?: string; client?: SupabaseClient } = {}) {
    this.typeDomain = options.typeDomain ?? 'type.elum.example';
    const cookieDomain = import.meta.env.VITE_ELUM_COOKIE_DOMAIN?.trim();
    this.sb =
      options.client ??
      createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          // The same storage key and cookie domain as Write and every other ELUM app (handoff 3.6).
          ...(cookieDomain ? { storageKey: 'elum-auth', storage: cookieStorage({ domain: cookieDomain, secure: location.protocol === 'https:' }) } : {}),
        },
      });
    this.sb.auth.onAuthStateChange((event) => {
      // Signing out in any ELUM app clears the shared cookies, which lands here too.
      if (event === 'SIGNED_OUT') {
        this.signedUrls.clear();
        this.mailboxIds = [];
        this.unauthorizedHandlers.forEach((h) => h());
      }
    });
  }

  // ---------------------------------------------------------------- accounts

  async restoreSession(): Promise<Session | null> {
    const { data, error } = await this.sb.auth.getSession();
    if (error || !data.session) return null;
    try {
      return await this.sessionFor(data.session);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'unauthorized' || e.code === 'not_found')) return null;
      throw e;
    }
  }

  async signIn(input: SignInInput): Promise<Session> {
    const email = loginToEmail(input.login, this.typeDomain);
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password: input.password });
    if (error) {
      if (error.code === 'email_not_confirmed') {
        throw new ApiError('confirm_email', 'Confirm your email first. We sent you a link when you signed up.');
      }
      if (error.code === 'invalid_credentials' || error.status === 400) {
        throw new ApiError('invalid_credentials', 'That address and password do not match.');
      }
      throw toApiError(error);
    }
    return this.sessionFor(data.session);
  }

  async signUp(input: SignUpInput): Promise<Session> {
    const name = cleanName(input.name);
    checkPassword(input.password);
    if (input.kind === 'type') {
      const problem = handleProblem(input.handle);
      if (problem) throw new ApiError('invalid', problem, { field: 'handle' });
      if (input.recoveryEmail && !isEmail(input.recoveryEmail)) {
        throw new ApiError('invalid', 'Enter a valid recovery email, or leave it empty.', { field: 'recoveryEmail' });
      }
      // The server creates the account: Type addresses are verified by construction and only the
      // platform may set account_type and handle (handoff 3.4).
      const { data, error } = await this.sb.functions.invoke<{ data?: { address: string }; error?: RawError }>('type-signup', {
        body: { handle: input.handle.trim().toLowerCase(), name, password: input.password, recoveryEmail: input.recoveryEmail?.trim() || undefined },
      });
      if (error) throw await functionError(error);
      if (data?.error) throw toApiError(data.error);
      return this.signIn({ login: input.handle, password: input.password });
    }

    const email = input.email.trim().toLowerCase();
    if (!isEmail(email)) throw new ApiError('invalid', 'Enter a valid email address.', { field: 'email' });
    const { data, error } = await this.sb.auth.signUp({
      email,
      password: input.password,
      // account_type is ignored by the platform; accounts start external.
      options: { data: { name }, emailRedirectTo: `${window.location.origin}/` },
    });
    if (error) {
      if (error.code === 'user_already_exists' || error.code === 'email_exists') {
        throw new ApiError('email_taken', 'An account with this email already exists. Sign in instead.', { field: 'email' });
      }
      if (error.code === 'weak_password') throw new ApiError('invalid', error.message, { field: 'password' });
      throw toApiError(error);
    }
    if (!data.session) {
      throw new ApiError('confirm_email', `We sent a link to ${email}. Open it to confirm your email, then sign in.`);
    }
    return this.sessionFor(data.session);
  }

  async signOut(): Promise<void> {
    this.signedUrls.clear();
    await this.sb.auth.signOut();
  }

  async updateName(name: string): Promise<User> {
    const me = await this.me();
    const { data, error } = await this.sb
      .from('profiles')
      .update({ name: cleanName(name) })
      .eq('id', me)
      .select('id, name, email, color, account_type, handle, created_at')
      .single<ProfileRow>();
    if (error) throw toApiError(error);
    return toUser(data);
  }

  async handleAvailable(handle: string): Promise<boolean> {
    if (handleProblem(handle)) return false;
    const { data, error } = await this.sb.rpc('elum_handle_available', { p_handle: handle.trim().toLowerCase() });
    if (error) throw toApiError(error);
    return data === true;
  }

  onUnauthorized(handler: () => void): () => void {
    this.unauthorizedHandlers.add(handler);
    return () => this.unauthorizedHandlers.delete(handler);
  }

  // -------------------------------------------------------------------- Type

  async start(): Promise<TypeStart> {
    await this.me();
    // Records that this account uses Type: the first time emits elum.service.joined.
    const joined = await this.sb.rpc('elum_join_service', { p_service: 'type' });
    if (joined.error) throw toApiError(joined.error);
    const result = await this.rpc<TypeStart>('type_start');
    this.mailboxIds = result.mailboxes.map((m) => m.id);
    return { ...result, typeDomain: result.typeDomain || this.typeDomain };
  }

  async listThreads({ view, query, before, limit = 50 }: { view: InboxView; query?: string; before?: string; limit?: number }): Promise<ThreadSummary[]> {
    const rows = await this.rpc<ThreadRow[]>('type_inbox', { p_view: view, p_query: query?.trim() || null, p_before: before ?? null, p_limit: limit });
    return (rows ?? []).map((r) => ({
      id: r.thread_id,
      kind: r.kind,
      subject: r.subject,
      snippet: r.snippet,
      lastMessageAt: r.last_message_at,
      unread: r.unread,
      folder: r.folder,
      muted: r.muted,
      hasAttachments: r.has_attachments,
      messageCount: r.message_count,
      lastSender: r.last_sender,
      participants: r.participants ?? [],
    }));
  }

  async getThread(id: string): Promise<Thread> {
    const thread = await this.rpc<Thread>('type_thread', { p_thread: id });
    return { ...thread, messages: thread.messages.map(normalizeMessage) };
  }

  async markRead(threadId: string, read = true): Promise<void> {
    await this.rpc('type_mark_read', { p_thread: threadId, p_read: read });
  }

  async move(threadIds: string[], folder: Folder): Promise<void> {
    await this.rpc('type_move', { p_threads: threadIds, p_folder: folder });
  }

  async setMuted(threadId: string, muted: boolean): Promise<void> {
    await this.rpc('type_set_muted', { p_thread: threadId, p_muted: muted });
  }

  async counts(): Promise<Counts> {
    return this.rpc<Counts>('type_counts');
  }

  async send(input: DraftInput): Promise<SendResult> {
    const result = await this.rpc<SendResult>('type_send_message', {
      p_id: input.id,
      p_mailbox: input.mailboxId,
      p_thread: input.threadId,
      p_to: input.to,
      p_cc: input.cc,
      p_bcc: input.bcc,
      p_subject: input.subject,
      p_body_text: input.text,
      p_body_html: input.html,
    });
    // Outside mail goes out within a minute on the schedule; this asks for it now.
    if (result.status === 'queued') {
      void this.sb.functions.invoke('type-send', { body: { messageId: result.messageId } }).catch(() => undefined);
    }
    return result;
  }

  async saveDraft(input: DraftInput, version: number): Promise<{ version: number; updatedAt: string }> {
    return this.rpc('type_save_draft', {
      p_id: input.id,
      p_mailbox: input.mailboxId,
      p_version: version,
      p_thread: input.threadId,
      p_to: input.to,
      p_cc: input.cc,
      p_bcc: input.bcc,
      p_subject: input.subject,
      p_body_text: input.text,
      p_body_html: input.html,
    });
  }

  async listDrafts(): Promise<Draft[]> {
    const rows = await this.rpc<(Draft & { subject: string | null; text: string })[]>('type_drafts');
    return rows.map((d) => ({ ...d, subject: d.subject ?? '', text: d.text ?? '' }));
  }

  async deleteDraft(id: string): Promise<void> {
    await this.rpc('type_delete_draft', { p_id: id });
  }

  async attach(draftId: string, file: File): Promise<Attachment> {
    await this.me();
    if (file.size > MAX_ATTACHMENTS_BYTES) throw new ApiError('too_large', 'Attachments can add up to 25 MB.');
    const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(-120) || 'file';
    const path = `${draftId}/${crypto.randomUUID().slice(0, 8)}-${safe}`;
    const uploaded = await this.sb.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (uploaded.error) throw toApiError(uploaded.error as RawError, 'That file could not be uploaded.');
    try {
      const id = await this.rpc<string>('type_add_attachment', {
        p_draft: draftId,
        p_path: path,
        p_name: file.name,
        p_mime: file.type || 'application/octet-stream',
        p_bytes: file.size,
      });
      return { id, path, name: file.name, mime: file.type || 'application/octet-stream', bytes: file.size };
    } catch (e) {
      await this.sb.storage.from(BUCKET).remove([path]);
      throw e;
    }
  }

  async removeAttachment(id: string): Promise<void> {
    const path = await this.rpc<string | null>('type_remove_attachment', { p_id: id });
    if (path) await this.sb.storage.from(BUCKET).remove([path]);
  }

  async attachmentUrl(attachment: Attachment): Promise<string> {
    const cached = this.signedUrls.get(attachment.path);
    if (cached && cached.expires - Date.now() > 60_000) return cached.url;
    const { data, error } = await this.sb.storage.from(BUCKET).createSignedUrl(attachment.path, SIGNED_URL_SECONDS, { download: attachment.name });
    if (error || !data) throw new ApiError('not_found', 'That file is no longer available.');
    this.signedUrls.set(attachment.path, { url: data.signedUrl, expires: Date.now() + SIGNED_URL_SECONDS * 1000 });
    return data.signedUrl;
  }

  async contacts(query?: string): Promise<Contact[]> {
    const rows = await this.rpc<{ address: string; name: string | null; is_elum: boolean; color: string | null; last_contact_at: string | null }[]>(
      'type_contacts',
      { p_query: query?.trim() || null, p_limit: 30 },
    );
    return rows.map((r) => ({ address: r.address, name: r.name, isElum: r.is_elum, color: r.color, lastContactAt: r.last_contact_at }));
  }

  async listCards({ archived = false }: { archived?: boolean } = {}): Promise<InboxCard[]> {
    const rows = await this.rpc<CardRow[]>('type_inbox_cards', { p_before: null, p_limit: 50, p_archived: archived });
    return rows.map((r) => ({
      id: r.id,
      service: r.service_id,
      title: r.title,
      body: r.body,
      actionLabel: r.action_label,
      actionUrl: r.action_url,
      createdAt: r.created_at,
      readAt: r.read_at,
      archivedAt: r.archived_at,
      actor: r.actor,
    }));
  }

  async markCard(id: string, change: { read?: boolean; archived?: boolean }): Promise<void> {
    await this.rpc('type_mark_card', { p_id: id, p_read: change.read ?? null, p_archived: change.archived ?? null });
  }

  async updatePreferences(patch: Partial<Omit<TypePreferences, 'version'>>, version: number): Promise<TypePreferences> {
    return this.rpc<TypePreferences>('type_update_preferences', { p_patch: patch, p_version: version });
  }

  async updateMailbox(id: string, change: { displayName?: string; signature?: string }): Promise<Mailbox> {
    await this.rpc('type_update_mailbox', { p_mailbox: id, p_display_name: change.displayName ?? null, p_signature: change.signature ?? null });
    const start = await this.rpc<TypeStart>('type_start');
    const mailbox = start.mailboxes.find((m) => m.id === id);
    if (!mailbox) throw new ApiError('not_found', 'That address is not yours.');
    return mailbox;
  }

  async allowImages(address: string, allow: boolean): Promise<void> {
    await this.rpc('type_allow_images', { p_address: address, p_allow: allow });
  }

  async confirmRecovery(code: string): Promise<string> {
    return this.rpc<string>('type_recovery_confirm', { p_code: code.trim() });
  }

  async resendRecovery(): Promise<void> {
    await this.me();
    const { data, error } = await this.sb.functions.invoke<{ error?: RawError }>('type-signup', { body: { action: 'resend-recovery' } });
    if (error) throw await functionError(error);
    if (data?.error) throw toApiError(data.error);
  }

  subscribe(onChange: (event: LiveEvent) => void): () => void {
    const channels: RealtimeChannel[] = [];
    let stopped = false;
    void (async () => {
      if (!this.mailboxIds.length) await this.start().catch(() => undefined);
      if (stopped) return;
      for (const mailbox of this.mailboxIds) {
        // Row level security decides what each subscriber receives; the filters keep it small.
        const channel = this.sb
          .channel(`type-${mailbox}`)
          .on('postgres_changes', { event: '*', schema: 'type', table: 'participants', filter: `mailbox_id=eq.${mailbox}` }, () =>
            onChange({ kind: 'inbox' }),
          )
          .on('postgres_changes', { event: '*', schema: 'type', table: 'inbox_cards', filter: `mailbox_id=eq.${mailbox}` }, () =>
            onChange({ kind: 'card' }),
          )
          .subscribe();
        channels.push(channel);
      }
      channels.push(
        this.sb
          .channel('type-messages')
          .on('postgres_changes', { event: '*', schema: 'type', table: 'messages' }, (change) => {
            const row = (change.new ?? change.old) as { thread_id?: string };
            if (row?.thread_id) onChange({ kind: 'message', threadId: row.thread_id });
          })
          .subscribe(),
      );
    })();
    return () => {
      stopped = true;
      channels.forEach((c) => void this.sb.removeChannel(c));
    };
  }

  /** The ELUM bell: the platform's notifications from every service (handoff 6.3). */
  readonly notifications: NotificationsApi = {
    list: async ({ before, unreadOnly = false, limit = 30 } = {}) => {
      const rows = await this.rpc<NotificationRow[]>('elum_notifications', { p_limit: limit, p_before: before ?? null, p_unread_only: unreadOnly });
      return rows.map(toNotification);
    },
    markRead: async (ids) => {
      await this.rpc('elum_mark_notifications_read', { p_ids: ids ?? null });
    },
    subscribe: (onNew) => {
      let channel: RealtimeChannel | null = null;
      let stopped = false;
      void this.sb.auth.getSession().then(({ data }) => {
        const me = data.session?.user.id;
        if (!me || stopped) return;
        channel = this.sb
          .channel(`elum-notifications-${me}`)
          .on('postgres_changes', { event: 'INSERT', schema: 'elum', table: 'notifications', filter: `account_id=eq.${me}` }, (change) => {
            const row = change.new as Record<string, unknown>;
            onNew(
              toNotification({
                id: String(row.id),
                service_id: String(row.service_id),
                type: String(row.type),
                title: String(row.title),
                body: (row.body as string | null) ?? null,
                link: (row.link as string | null) ?? null,
                created_at: String(row.created_at),
                read_at: null,
                actor: null,
              }),
            );
          })
          .subscribe();
      });
      return () => {
        stopped = true;
        if (channel) void this.sb.removeChannel(channel);
      };
    },
  };

  // ----------------------------------------------------------------- helpers

  private async me(): Promise<string> {
    const { data } = await this.sb.auth.getSession();
    const id = data.session?.user.id;
    if (!id) {
      this.unauthorizedHandlers.forEach((h) => h());
      throw new ApiError('unauthorized', 'Your session has ended. Sign in again.');
    }
    return id;
  }

  private async rpc<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
    await this.me();
    const { data, error } = await this.sb.rpc(name, args);
    if (error) {
      const e = toApiError(error);
      if (e.code === 'unauthorized') this.unauthorizedHandlers.forEach((h) => h());
      throw e;
    }
    return data as T;
  }

  private async sessionFor(session: AuthSession): Promise<Session> {
    const { data, error } = await this.sb
      .from('profiles')
      .select('id, name, email, color, account_type, handle, created_at')
      .eq('id', session.user.id)
      .single<ProfileRow>();
    if (error) throw toApiError(error);
    return { user: toUser(data) };
  }
}

function toUser(p: ProfileRow): User {
  return { id: p.id, name: p.name, email: p.email, color: p.color, accountType: p.account_type, handle: p.handle, createdAt: p.created_at };
}

function toNotification(r: NotificationRow): AppNotification {
  return {
    id: r.id,
    service: r.service_id as AppNotification['service'],
    type: r.type,
    title: r.title,
    body: r.body,
    link: r.link,
    createdAt: r.created_at,
    readAt: r.read_at,
    actor: r.actor,
  };
}

function normalizeMessage(m: Message): Message {
  return { ...m, to: m.to ?? [], cc: m.cc ?? [], bcc: m.bcc ?? [], failed: m.failed ?? [], attachments: m.attachments ?? [] };
}

/** Edge functions answer { error: { code, message } } with an HTTP status (handoff 5.2). */
async function functionError(error: unknown): Promise<ApiError> {
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    try {
      const body = (await context.json()) as { error?: { code?: string; message?: string } };
      const code = body.error?.code;
      const message = body.error?.message ?? 'Something went wrong. Please try again.';
      if (code === 'conflict') return new ApiError('conflict', message, { field: 'handle' });
      if (code === 'invalid') return new ApiError('invalid', message);
      if (code === 'rate_limited') return new ApiError('rate_limited', message);
      if (code === 'forbidden') return new ApiError('forbidden', message);
      return new ApiError('server', message);
    } catch {
      // Fall through.
    }
  }
  return toApiError(error as RawError);
}
