import type {
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
  SendResult,
  Session,
  SignInInput,
  SignUpInput,
  Thread,
  ThreadSummary,
  TypePreferences,
  TypeStart,
  User,
} from './types';

/**
 * Everything ELUM Type asks of its backend. `SupabaseApi` implements it against the ELUM
 * platform (the public.type_* and public.elum_* database functions, Storage and Realtime);
 * `LocalApi` implements it inside the browser for previews. The UI never imports Supabase.
 *
 * Every call except the auth ones acts as the signed-in person and fails with
 * `ApiError('unauthorized')` when there is no valid session.
 */
export interface TypeApi {
  readonly mode: 'local' | 'remote';
  /** The domain Type addresses live on, such as type.elum.services. */
  readonly typeDomain: string;

  // Accounts (one ELUM account for every service)
  restoreSession(): Promise<Session | null>;
  signIn(input: SignInInput): Promise<Session>;
  /** Type accounts get handle@typeDomain; external accounts confirm their own email first. */
  signUp(input: SignUpInput): Promise<Session>;
  signOut(): Promise<void>;
  updateName(name: string): Promise<User>;
  /** Whether a Type handle can be taken, for checking as people type. */
  handleAvailable(handle: string): Promise<boolean>;
  onUnauthorized(handler: () => void): () => void;

  // Type
  /** Joins the Type service, makes the mailbox, returns addresses and settings. Call on every start. */
  start(): Promise<TypeStart>;
  listThreads(options: { view: InboxView; query?: string; before?: string; limit?: number }): Promise<ThreadSummary[]>;
  getThread(id: string): Promise<Thread>;
  markRead(threadId: string, read?: boolean): Promise<void>;
  move(threadIds: string[], folder: Folder): Promise<void>;
  setMuted(threadId: string, muted: boolean): Promise<void>;
  counts(): Promise<Counts>;

  /** Sends a message. ELUM people get it at once; outside addresses go out as email. */
  send(input: DraftInput): Promise<SendResult>;
  /** Saves a draft. `version` is the last one seen (0 for new); a mismatch is a conflict. */
  saveDraft(input: DraftInput, version: number): Promise<{ version: number; updatedAt: string }>;
  listDrafts(): Promise<Draft[]>;
  deleteDraft(id: string): Promise<void>;
  /** Uploads a file to a saved draft. */
  attach(draftId: string, file: File): Promise<Attachment>;
  removeAttachment(id: string): Promise<void>;
  /** A short-lived link to open or download an attachment. */
  attachmentUrl(attachment: Attachment): Promise<string>;

  contacts(query?: string): Promise<Contact[]>;
  listCards(options?: { archived?: boolean }): Promise<InboxCard[]>;
  markCard(id: string, change: { read?: boolean; archived?: boolean }): Promise<void>;

  updatePreferences(patch: Partial<Omit<TypePreferences, 'version'>>, version: number): Promise<TypePreferences>;
  updateMailbox(id: string, change: { displayName?: string; signature?: string }): Promise<Mailbox>;
  allowImages(address: string, allow: boolean): Promise<void>;
  /** Confirms the pending recovery email with the code we sent it. Returns the address. */
  confirmRecovery(code: string): Promise<string>;
  /** Sends a new code to the pending recovery email. */
  resendRecovery(): Promise<void>;

  /** A one-time sign-in for another ELUM app (account-handoff): where to send the browser. */
  handoff(to: string, next: string): Promise<string>;
  /** Trades a handoff token from ELUM Account for a session here. */
  completeHandoff(tokenHash: string): Promise<Session>;

  /** Calls back when something changes for the signed-in person. Returns an unsubscribe function. */
  subscribe(onChange: (event: LiveEvent) => void): () => void;

  // The ELUM bell: notifications from every service.
  readonly notifications: NotificationsApi;
}

export interface NotificationsApi {
  list(options?: { before?: string; unreadOnly?: boolean; limit?: number }): Promise<AppNotification[]>;
  markRead(ids?: string[]): Promise<void>;
  subscribe(onNew: (n: AppNotification) => void): () => void;
}

export const MAX_ATTACHMENTS_BYTES = 25 * 1024 * 1024;
export const MAX_RECIPIENTS = 50;
