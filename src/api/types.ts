/**
 * Shared data shapes for ELUM Type. The preview API and the Supabase API both speak these
 * types, so the UI never knows which one is behind it.
 */

/** `type`: has an ELUM Type address. `external`: signs in with their own email provider. */
export type AccountType = 'type' | 'external';

export interface User {
  id: string;
  name: string;
  /** The address they sign in with. */
  email: string;
  /** Avatar colour, one of the product colours. */
  color: string;
  accountType: AccountType;
  /** The part before @ in their Type address. */
  handle: string | null;
  createdAt: string;
}

export interface Session {
  user: User;
}

export type SignUpInput =
  | { kind: 'type'; handle: string; name: string; password: string; recoveryEmail?: string }
  | { kind: 'external'; name: string; email: string; password: string };

export interface SignInInput {
  /** An email address, or just a Type handle. */
  login: string;
  password: string;
}

/** An address as it appears on a message. */
export interface Address {
  address: string;
  name?: string | null;
}

/** Someone in a conversation. ELUM people have an account; everyone else is an address. */
export interface Person extends Address {
  isElum: boolean;
  color?: string | null;
}

export interface Mailbox {
  id: string;
  address: string;
  displayName: string;
  signature: string | null;
  /** True for Type addresses, which can email anyone. Login-address mailboxes reach ELUM people only. */
  canEmail: boolean;
}

export interface TypePreferences {
  defaultMailbox: string | null;
  loadImages: 'ask' | 'always';
  vacationOn: boolean;
  vacationSubject: string | null;
  vacationBody: string | null;
  vacationUntil: string | null;
  version: number;
}

export interface TypeStart {
  typeDomain: string;
  mailboxes: Mailbox[];
  preferences: TypePreferences;
  /** Senders whose remote images always load. */
  imageSenders: string[];
}

export type InboxView = 'inbox' | 'unread' | 'elum' | 'email' | 'archive' | 'spam' | 'trash';
export type Folder = 'inbox' | 'archive' | 'trash' | 'spam';
export type ThreadKind = 'elum' | 'email';

export interface ThreadSummary {
  id: string;
  kind: ThreadKind;
  subject: string | null;
  snippet: string;
  lastMessageAt: string;
  unread: boolean;
  folder: Folder;
  muted: boolean;
  hasAttachments: boolean;
  messageCount: number;
  lastSender: Address;
  /** Everyone in the thread except you. */
  participants: Person[];
}

export interface Attachment {
  id: string;
  path: string;
  name: string;
  mime: string;
  bytes: number;
}

export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'failed' | 'received';

export interface Message {
  id: string;
  from: Person;
  mine: boolean;
  to: Address[];
  cc: Address[];
  /** Only on your own messages. */
  bcc: Address[];
  subject: string | null;
  text: string;
  /** Untrusted. Always shown through lib/sanitize. */
  html: string | null;
  headers: Record<string, string> | null;
  messageId: string | null;
  status: MessageStatus;
  auto: boolean;
  hasRemoteImages: boolean;
  createdAt: string;
  sentAt: string | null;
  /** Outside addresses this message could not be delivered to (your messages only). */
  failed: string[];
  attachments: Attachment[];
}

export interface Thread {
  id: string;
  kind: ThreadKind;
  subject: string | null;
  lastMessageAt: string;
  me: { mailboxId: string; address: string; folder: Folder; muted: boolean; lastReadAt: string | null };
  participants: Person[];
  messages: Message[];
}

export interface DraftInput {
  /** Chosen by the app. It becomes the message id when sent, so a retried send is harmless. */
  id: string;
  mailboxId: string;
  threadId: string | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  text: string;
  html: string | null;
}

export interface Draft extends DraftInput {
  version: number;
  updatedAt: string;
  attachments: Attachment[];
}

export interface SendResult {
  messageId: string;
  threadId: string;
  status: MessageStatus;
}

export interface InboxCard {
  id: string;
  service: string;
  title: string;
  body: string | null;
  actionLabel: string | null;
  actionUrl: string | null;
  createdAt: string;
  readAt: string | null;
  archivedAt: string | null;
  actor: { id: string; name: string; color: string } | null;
}

export interface Contact extends Person {
  lastContactAt: string | null;
}

export interface Counts {
  unread: number;
  cards: number;
}

export interface AppNotification {
  id: string;
  service: 'elum' | 'write' | 'type' | 'browse' | 'make' | 'store';
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
  actor: { id: string; name: string; color: string } | null;
}

/** What changed, for live updates. */
export type LiveEvent = { kind: 'inbox' } | { kind: 'message'; threadId: string } | { kind: 'card' };
