import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ACCOUNT_SETTINGS_KEY, parseSettings, readLocalSettings, writeLocalSettings, type TypeSettings } from '../settings/typeSettings';
import { api, errorMessage, type Attachment, type Counts, type DraftInput, type LiveEvent, type Mailbox, type TypePreferences, type TypeStart } from '../api';

/** What opens the composer: a new message, a reply, a forward, or a saved draft. */
export interface ComposeRequest {
  draft: Partial<DraftInput>;
  version?: number;
  attachments?: Attachment[];
}

interface TypeContextValue {
  start: TypeStart | null;
  startError: string | null;
  retryStart: () => void;
  /** The address to send from unless the person picks another. */
  defaultMailbox: Mailbox | null;
  counts: Counts;
  refreshCounts: () => void;
  /** Goes up on every live change, so lists and threads know to reload. */
  tick: number;
  lastEvent: LiveEvent | null;
  compose: ComposeRequest | null;
  openCompose: (request?: ComposeRequest) => void;
  closeCompose: () => void;
  setPreferences: (prefs: TypePreferences) => void;
  setMailbox: (mailbox: Mailbox) => void;
  clearPendingRecovery: () => void;
  imageSenders: Set<string>;
  allowImages: (address: string, allow: boolean) => Promise<void>;
  /** How Type looks and behaves (reading pane, density, undo send and the rest). */
  settings: TypeSettings;
  updateSettings: (patch: Partial<TypeSettings>) => void;
}

const TypeContext = createContext<TypeContextValue | null>(null);

export function TypeProvider({ children }: { children: ReactNode }) {
  const [start, setStart] = useState<TypeStart | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [counts, setCounts] = useState<Counts>({ unread: 0, cards: 0 });
  const [tick, setTick] = useState(0);
  const [lastEvent, setLastEvent] = useState<LiveEvent | null>(null);
  const [compose, setCompose] = useState<ComposeRequest | null>(null);
  const [settings, setSettings] = useState<TypeSettings>(readLocalSettings);

  // The account's copy wins over this browser's, so settings follow people between devices.
  useEffect(() => {
    let cancelled = false;
    api.accountData?.().then(
      (data) => {
        if (cancelled || !data[ACCOUNT_SETTINGS_KEY]) return;
        const next = parseSettings(data[ACCOUNT_SETTINGS_KEY]);
        writeLocalSettings(next);
        setSettings(next);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const updateSettings = useCallback((patch: Partial<TypeSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      writeLocalSettings(next);
      void api.updateAccountData?.({ [ACCOUNT_SETTINGS_KEY]: next }).catch(() => undefined);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.dataset.density = settings.density;
    return () => {
      delete document.documentElement.dataset.density;
    };
  }, [settings.density]);

  useEffect(() => {
    let cancelled = false;
    setStartError(null);
    api.start().then(
      (s) => !cancelled && setStart(s),
      (e) => !cancelled && setStartError(errorMessage(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const refreshCounts = useCallback(() => {
    api.counts().then(setCounts, () => undefined);
  }, []);

  useEffect(() => {
    if (!start) return;
    refreshCounts();
    const off = api.subscribe((event) => {
      setLastEvent(event);
      setTick((t) => t + 1);
      refreshCounts();
    });
    // Live updates can drop on flaky networks; a slow poll keeps the counts honest.
    const timer = window.setInterval(() => document.visibilityState === 'visible' && setTick((t) => t + 1), 60_000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [start, refreshCounts]);

  useEffect(() => {
    if (start) refreshCounts();
  }, [tick, start, refreshCounts]);

  const defaultMailbox = useMemo(() => {
    if (!start) return null;
    return start.mailboxes.find((m) => m.id === start.preferences.defaultMailbox) ?? start.mailboxes[0] ?? null;
  }, [start]);

  const imageSenders = useMemo(() => new Set(start?.imageSenders ?? []), [start]);

  const allowImages = useCallback(async (address: string, allow: boolean) => {
    await api.allowImages(address, allow);
    setStart((s) =>
      s ? { ...s, imageSenders: allow ? [...new Set([...s.imageSenders, address])] : s.imageSenders.filter((a) => a !== address) } : s,
    );
  }, []);

  const value = useMemo<TypeContextValue>(
    () => ({
      start,
      startError,
      retryStart: () => setAttempt((a) => a + 1),
      defaultMailbox,
      counts,
      refreshCounts,
      tick,
      lastEvent,
      compose,
      openCompose: (request = { draft: {} }) => setCompose(request),
      closeCompose: () => setCompose(null),
      setPreferences: (preferences) => setStart((s) => (s ? { ...s, preferences } : s)),
      setMailbox: (mailbox) => setStart((s) => (s ? { ...s, mailboxes: s.mailboxes.map((m) => (m.id === mailbox.id ? mailbox : m)) } : s)),
      imageSenders,
      allowImages,
      clearPendingRecovery: () => setStart((s) => (s ? { ...s, pendingRecovery: null } : s)),
      settings,
      updateSettings,
    }),
    [start, startError, defaultMailbox, counts, refreshCounts, tick, lastEvent, compose, imageSenders, allowImages, settings, updateSettings],
  );
  return <TypeContext.Provider value={value}>{children}</TypeContext.Provider>;
}

export function useType() {
  const ctx = useContext(TypeContext);
  if (!ctx) throw new Error('useType must be used inside TypeProvider');
  return ctx;
}
