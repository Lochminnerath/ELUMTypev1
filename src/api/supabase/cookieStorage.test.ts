import { describe, expect, it } from 'vitest';
import { cookieStorage, usableCookieDomain } from './cookieStorage';

/** A tiny cookie jar that understands Max-Age=0. */
function fakeDocument() {
  const jar = new Map<string, string>();
  return {
    jar,
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(line: string) {
      const [pair, ...attrs] = line.split('; ');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      if (attrs.includes('Max-Age=0')) jar.delete(name);
      else jar.set(name, pair.slice(i + 1));
      if (!attrs.includes('Domain=.elum.services')) throw new Error('missing domain');
    },
  };
}

describe('shared sign-in cookies', () => {
  it('stores large sessions across several cookies and reads them back', () => {
    const doc = fakeDocument();
    const s = cookieStorage({ domain: '.elum.services', doc });
    const session = JSON.stringify({ access_token: 'a'.repeat(7000), user: { name: 'Zoë; “quoted”' } });
    s.setItem('elum-auth', session);
    expect(doc.jar.get('elum-auth')).toBe('3');
    expect(s.getItem('elum-auth')).toBe(session);
  });

  it('removes every piece, including from a longer earlier session', () => {
    const doc = fakeDocument();
    const s = cookieStorage({ domain: '.elum.services', doc });
    s.setItem('elum-auth', 'x'.repeat(9000));
    s.setItem('elum-auth', 'short');
    expect([...doc.jar.keys()].sort()).toEqual(['elum-auth', 'elum-auth.0']);
    s.removeItem('elum-auth');
    expect(doc.jar.size).toBe(0);
    expect(s.getItem('elum-auth')).toBeNull();
  });
});

describe('usableCookieDomain', () => {
  it('shares cookies across the subdomains of a domain you own', () => {
    expect(usableCookieDomain('.elum.services', 'write.elum.services')).toBe('.elum.services');
    expect(usableCookieDomain('elum.services', 'elum.services')).toBe('.elum.services');
  });

  it('falls back to site storage when a browser would refuse the cookie', () => {
    // Set for elum.services but served from netlify.app: every sign-in would vanish.
    expect(usableCookieDomain('.elum.services', 'elumwrite.netlify.app')).toBeNull();
    // netlify.app is a public suffix; its sites cannot share cookies.
    expect(usableCookieDomain('.netlify.app', 'elumwrite.netlify.app')).toBeNull();
    expect(usableCookieDomain('', 'localhost')).toBeNull();
    expect(usableCookieDomain(undefined, 'elumtype.netlify.app')).toBeNull();
  });

  it('shares the ELUM sign-in on elum.services even when the setting is missing', () => {
    expect(usableCookieDomain(undefined, 'type.elum.services')).toBe('.elum.services');
    expect(usableCookieDomain('', 'write.elum.services')).toBe('.elum.services');
  });
});
