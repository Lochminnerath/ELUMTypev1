/**
 * How Type looks and behaves for one person. Remembered on the account (as `type_settings` in
 * its metadata) so it follows them to every device, with this browser as a quick cache.
 */
export interface TypeSettings {
  /** Desktop: the open conversation sits beside the list. Off: it takes the whole width. */
  readingPane: boolean;
  density: 'comfortable' | 'compact';
  /** Email: earlier messages fold away under the latest. Off: every message is shown open. */
  conversationView: boolean;
  /** When an opened conversation counts as read. */
  markRead: 'open' | 'delay';
  /** What the reply bar does in email with more than one person. */
  replyDefault: 'reply' | 'all';
  /** Seconds to wait before a message goes, with Undo. */
  undoSeconds: 0 | 5 | 10 | 20;
  /** Phones: what swiping a conversation to the left does. */
  swipe: 'off' | 'archive' | 'read';
}

export const DEFAULT_SETTINGS: TypeSettings = {
  readingPane: true,
  density: 'comfortable',
  conversationView: true,
  markRead: 'open',
  replyDefault: 'all',
  undoSeconds: 5,
  swipe: 'archive',
};

export const ACCOUNT_SETTINGS_KEY = 'type_settings';
export const LOCAL_SETTINGS_KEY = 'elum.type.settings';
/** How long an opened conversation waits before it counts as read, with markRead 'delay'. */
export const MARK_READ_DELAY = 2000;

const oneOf = <T>(value: unknown, options: readonly T[], fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);

/** Reads settings from anywhere they were stored, keeping only values Type understands. */
export function parseSettings(raw: unknown): TypeSettings {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_SETTINGS;
  return {
    readingPane: typeof o.readingPane === 'boolean' ? o.readingPane : d.readingPane,
    density: oneOf(o.density, ['comfortable', 'compact'] as const, d.density),
    conversationView: typeof o.conversationView === 'boolean' ? o.conversationView : d.conversationView,
    markRead: oneOf(o.markRead, ['open', 'delay'] as const, d.markRead),
    replyDefault: oneOf(o.replyDefault, ['reply', 'all'] as const, d.replyDefault),
    undoSeconds: oneOf(o.undoSeconds, [0, 5, 10, 20] as const, d.undoSeconds),
    swipe: oneOf(o.swipe, ['off', 'archive', 'read'] as const, d.swipe),
  };
}

export function readLocalSettings(): TypeSettings {
  try {
    return parseSettings(JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY) ?? 'null'));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeLocalSettings(settings: TypeSettings) {
  try {
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // The account still has them.
  }
}

/**
 * Waits `seconds` before calling `send`, unless `cancel` is called first. Resolves true when the
 * message went, false when it was undone.
 */
export function delayedSend(seconds: number, send: () => Promise<unknown>) {
  let cancel = () => {};
  const done = new Promise<boolean>((resolve, reject) => {
    if (seconds <= 0) {
      send().then(() => resolve(true), reject);
      return;
    }
    const timer = window.setTimeout(() => send().then(() => resolve(true), reject), seconds * 1000);
    cancel = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
  });
  return { done, cancel: () => cancel() };
}
