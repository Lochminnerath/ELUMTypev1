import { useEffect } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/AuthProvider';
import { openSupportChat, validChat } from './supportChat';

/**
 * When someone has an open request to ELUM Support, Type carries on that request as a chat: it
 * pops up once, and stays as a small bubble in the bottom-left after that. Nobody else gets the
 * chat loaded, so it follows only people who asked ELUM for help.
 */
export function SupportChat() {
  const { user } = useAuth();
  const name = user?.name;
  const email = user?.email;

  useEffect(() => {
    if (!name || !email || !api.supportChat) return;
    let live = true;
    api.supportChat().then(
      (chat) => {
        if (live && validChat(chat)) openSupportChat(chat, { name, email });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [name, email]);

  return null;
}
