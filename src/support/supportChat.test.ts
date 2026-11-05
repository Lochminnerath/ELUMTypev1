import { afterEach, describe, expect, it } from 'vitest';
import type { SupportChat } from '../api';
import { alreadyOpened, openSupportChat, rememberOpened, validChat } from './supportChat';

const chat: SupportChat = {
  property: '6aecc260d754783c42dec4a2',
  widget: '1k6mdei2u',
  request: { id: 'req-1', createdAt: '2026-11-05T10:00:00Z', status: 'open', kind: 'Signing in' },
};

afterEach(() => {
  document.getElementById('elum-support-chat')?.remove();
  delete window.Tawk_API;
  localStorage.clear();
});

describe('support chat', () => {
  it('accepts only ids that look like Tawk.to ids', () => {
    expect(validChat(chat)).toBe(true);
    expect(validChat(null)).toBe(false);
    expect(validChat({ ...chat, property: 'x/../evil' })).toBe(false);
    expect(validChat({ ...chat, widget: '' })).toBe(false);
  });

  it('loads the chat once, as the signed-in person', () => {
    expect(openSupportChat(chat, { name: 'Rae Reed', email: 'rae@elum.space' })).toBe(true);
    const script = document.getElementById('elum-support-chat') as HTMLScriptElement;
    expect(script.src).toBe('https://embed.tawk.to/6aecc260d754783c42dec4a2/1k6mdei2u');
    expect(window.Tawk_API?.visitor).toEqual({ name: 'Rae Reed', email: 'rae@elum.space' });
    expect(openSupportChat(chat, { name: 'Rae Reed', email: 'rae@elum.space' })).toBe(false);
  });

  it('pops up the first time for a request, then stays a bubble', () => {
    openSupportChat(chat, { name: 'Rae', email: 'rae@elum.space' });
    let opened = 0;
    window.Tawk_API!.maximize = () => void opened++;
    window.Tawk_API!.onLoad!();
    expect(opened).toBe(1);
    expect(alreadyOpened('req-1')).toBe(true);
    expect(alreadyOpened('req-2')).toBe(false);
  });

  it('does not pop up again for a request it already opened', () => {
    rememberOpened('req-1');
    openSupportChat(chat, { name: 'Rae', email: 'rae@elum.space' });
    let opened = 0;
    window.Tawk_API!.maximize = () => void opened++;
    window.Tawk_API!.onLoad!();
    expect(opened).toBe(0);
  });
});
