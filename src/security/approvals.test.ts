import { describe, expect, it } from 'vitest';
import { tokenRole } from './approvals';

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
