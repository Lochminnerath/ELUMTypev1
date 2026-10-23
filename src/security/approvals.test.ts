import { describe, expect, it } from 'vitest';
import { pickRequest, tokenRole, type SignInRequest } from './approvals';

const jwt = (payload: object) => `x.${btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')}.y`;

describe('tokenRole', () => {
  it('reads the role from an access token', () => {
    expect(tokenRole(jwt({ role: 'elum_pending', sub: 'a' }))).toBe('elum_pending');
    expect(tokenRole(jwt({ role: 'authenticated', name: 'Zoë ✓' }))).toBe('authenticated');
  });
  it('is null for anything else', () => {
    expect(tokenRole(null)).toBeNull();
    expect(tokenRole('not a token')).toBeNull();
    expect(tokenRole('a.%%%.b')).toBeNull();
  });
});

describe('pickRequest', () => {
  const r = (id: string, nearby = false): SignInRequest => ({ id, device: 'd', ip: null, at: '', expiresAt: '', numbers: [1, 2, 3], nearby });
  it('asks about nearby sign-ins first', () => {
    expect(pickRequest([r('a'), r('b', true)], null)?.id).toBe('b');
    expect(pickRequest([r('a'), r('b')], null)?.id).toBe('a');
  });
  it('keeps the one already open while it waits', () => {
    expect(pickRequest([r('a'), r('b', true)], 'a')?.id).toBe('a');
    expect(pickRequest([r('b', true)], 'a')?.id).toBe('b');
    expect(pickRequest([], 'a')).toBeNull();
  });
});
