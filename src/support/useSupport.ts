import { useEffect, useSyncExternalStore } from 'react';
import { api, type SupportSummary } from '../api';

/**
 * The person's conversations with ELUM Support, shared by the tool rail (for its badge) and the
 * inbox (for the pinned row). Checked once a minute while Type is open and in view.
 */
let list: SupportSummary[] = [];
const listeners = new Set<() => void>();
let users = 0;
let timer: number | undefined;

export async function refreshSupport() {
  if (!api.support) return;
  try {
    list = await api.support.list();
    listeners.forEach((l) => l());
  } catch {
    // The rail and inbox simply show nothing new.
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSupportList(): SupportSummary[] {
  useEffect(() => {
    users++;
    if (users === 1) {
      void refreshSupport();
      timer = window.setInterval(() => document.visibilityState === 'visible' && void refreshSupport(), 60_000);
    }
    return () => {
      users--;
      if (users === 0) window.clearInterval(timer);
    };
  }, []);
  return useSyncExternalStore(subscribe, () => list);
}
