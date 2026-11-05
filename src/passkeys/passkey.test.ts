import { describe, expect, it } from 'vitest';
import { fromBase64url, passkeyHost, toBase64url } from './passkey';

describe('passkey sign-in', () => {
  it('is offered on ELUM apps at elum.space and on this computer', () => {
    expect(passkeyHost({ protocol: 'https:', hostname: 'write.elum.space' })).toBe(true);
    expect(passkeyHost({ protocol: 'https:', hostname: 'elum.space' })).toBe(true);
    expect(passkeyHost({ protocol: 'http:', hostname: 'localhost' })).toBe(true);
  });
  it('is not offered anywhere else', () => {
    expect(passkeyHost({ protocol: 'https:', hostname: 'writebyelum.netlify.app' })).toBe(false);
    expect(passkeyHost({ protocol: 'http:', hostname: 'write.elum.space' })).toBe(false);
    expect(passkeyHost({ protocol: 'https:', hostname: 'evilelum.space' })).toBe(false);
    expect(passkeyHost({ protocol: 'https:', hostname: 'elum.space.evil.example' })).toBe(false);
  });
  it('turns bytes into base64url and back', () => {
    const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    const text = toBase64url(bytes.buffer)!;
    expect(text).not.toMatch(/[+/=]/);
    expect([...new Uint8Array(fromBase64url(text))]).toEqual([...bytes]);
    expect(toBase64url(null)).toBeUndefined();
  });
});
