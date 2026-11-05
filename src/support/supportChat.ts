import type { SupportChat } from '../api';

declare global {
  interface Window {
    Tawk_API?: TawkApi;
    Tawk_LoadStart?: Date;
  }
}

/** The parts of the Tawk.to widget that Type uses. */
export interface TawkApi {
  visitor?: { name?: string; email?: string };
  customStyle?: unknown;
  onLoad?: () => void;
  maximize?: () => void;
  setAttributes?: (attributes: Record<string, string>, callback?: (error?: unknown) => void) => void;
}

const ID = /^[A-Za-z0-9]{1,40}$/;
const OPENED_KEY = 'type.supportChat.opened';

/** Only ids that look like Tawk.to's; anything else never reaches a script address. */
export function validChat(chat: SupportChat | null | undefined): chat is SupportChat {
  return !!chat && ID.test(chat.property) && ID.test(chat.widget) && !!chat.request?.id;
}

/** The request this browser already opened the chat for, so it pops up once and not on every visit. */
export function alreadyOpened(requestId: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(OPENED_KEY) === requestId;
  } catch {
    return false;
  }
}

export function rememberOpened(requestId: string, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(OPENED_KEY, requestId);
  } catch {
    // Private windows may refuse; the chat then opens again next time, which is fine.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Where the chat bubble sits: bottom-left, past the tool rail, so it never covers Send, the
 * composer or the hosting badge in the bottom-right corner.
 */
export const CHAT_STYLE = {
  visibility: {
    desktop: { position: 'bl', xOffset: 76, yOffset: 20 },
    mobile: { position: 'bl', xOffset: 12, yOffset: 84 },
  },
};

/**
 * Loads the ELUM Support chat (Tawk.to) for an open request, as the signed-in person, and opens
 * it the first time for that request. Returns false if the chat was already on the page.
 */
export function openSupportChat(chat: SupportChat, person: { name: string; email: string }, doc: Document = document): boolean {
  const win = doc.defaultView as (Window & typeof globalThis) | null;
  if (!win || win.Tawk_API?.maximize || doc.getElementById('elum-support-chat')) return false;
  const popUp = !alreadyOpened(chat.request.id);
  win.Tawk_API = {
    visitor: { name: person.name, email: person.email },
    customStyle: CHAT_STYLE,
    onLoad: () => {
      // The ELUM team sees which request this chat is about.
      win.Tawk_API?.setAttributes?.({ 'support-request': chat.request.id, ...(chat.request.kind ? { topic: chat.request.kind.slice(0, 60) } : {}) }, () => undefined);
      if (popUp) {
        win.Tawk_API?.maximize?.();
        rememberOpened(chat.request.id);
      }
    },
  };
  win.Tawk_LoadStart = new Date();
  const script = doc.createElement('script');
  script.id = 'elum-support-chat';
  script.async = true;
  script.src = `https://embed.tawk.to/${chat.property}/${chat.widget}`;
  script.charset = 'UTF-8';
  script.setAttribute('crossorigin', '*');
  doc.body.appendChild(script);
  return true;
}
