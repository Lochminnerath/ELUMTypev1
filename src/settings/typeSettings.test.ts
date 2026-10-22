import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, delayedSend, parseSettings } from './typeSettings';

describe('Type settings', () => {
  afterEach(() => vi.useRealTimers());

  it('falls back to the defaults for anything missing or unknown', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ density: 'tiny', undoSeconds: 7, readingPane: 'no' })).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps values Type understands', () => {
    const s = parseSettings({ density: 'compact', undoSeconds: 20, readingPane: false, swipe: 'read', replyDefault: 'reply', markRead: 'delay', conversationView: false });
    expect(s).toEqual({ density: 'compact', undoSeconds: 20, readingPane: false, swipe: 'read', replyDefault: 'reply', markRead: 'delay', conversationView: false });
  });

  it('sends at once with no delay', async () => {
    const send = vi.fn(() => Promise.resolve());
    await expect(delayedSend(0, send).done).resolves.toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });

  it('waits before sending, and can be undone', async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => Promise.resolve());
    const later = delayedSend(5, send);
    vi.advanceTimersByTime(4000);
    expect(send).not.toHaveBeenCalled();
    later.cancel();
    vi.advanceTimersByTime(5000);
    await expect(later.done).resolves.toBe(false);
    expect(send).not.toHaveBeenCalled();

    const sent = delayedSend(5, send);
    vi.advanceTimersByTime(5000);
    await expect(sent.done).resolves.toBe(true);
    expect(send).toHaveBeenCalledOnce();
  });
});
