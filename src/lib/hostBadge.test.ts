import { afterEach, describe, expect, it } from 'vitest';
import { applyHostBadge, HOST_BADGE_ID, watchHostBadge } from './hostBadge';

function addBadge(height = 64) {
  const frame = document.createElement('iframe');
  frame.id = HOST_BADGE_ID;
  frame.getBoundingClientRect = () => ({ width: 201, height, top: 0, left: 0, right: 201, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  document.body.appendChild(frame);
  return frame;
}

afterEach(() => {
  document.getElementById(HOST_BADGE_ID)?.remove();
  applyHostBadge();
});

describe('host badge room', () => {
  it('makes no room when there is no badge', () => {
    expect(applyHostBadge()).toBe(0);
    expect(document.documentElement.classList.contains('has-host-badge')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--host-badge-h')).toBe('');
  });

  it('makes room the height of the badge', () => {
    addBadge(64);
    expect(applyHostBadge()).toBe(64);
    expect(document.documentElement.classList.contains('has-host-badge')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--host-badge-h')).toBe('64px');
  });

  it('notices the badge arriving and leaving', async () => {
    const stop = watchHostBadge();
    const frame = addBadge(58);
    await Promise.resolve();
    expect(document.documentElement.style.getPropertyValue('--host-badge-h')).toBe('58px');
    frame.remove();
    await Promise.resolve();
    expect(document.documentElement.classList.contains('has-host-badge')).toBe(false);
    stop();
  });
});
