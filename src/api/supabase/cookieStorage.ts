/**
 * Session storage in cookies on a shared parent domain (such as `.elum.services`), so signing
 * in to one ELUM service signs you in to all of them: write.elum.services, type.elum.services ...
 *
 * Sessions can be larger than one cookie, so values are split across numbered cookies
 * (`name.0`, `name.1` ...) with a count in `name`. Supabase's own refresh-token rotation still
 * applies; every service reads and writes the same cookies.
 */
const CHUNK = 2400;
const MAX_AGE = 60 * 60 * 24 * 400; // The longest browsers keep a cookie.

export interface CookieStorageOptions {
  domain: string;
  /** Defaults to true; turn off only for http://localhost development. */
  secure?: boolean;
  /** For tests. */
  doc?: { cookie: string };
}

export function cookieStorage({ domain, secure = true, doc = document }: CookieStorageOptions) {
  const read = (): Map<string, string> => {
    const jar = new Map<string, string>();
    for (const part of doc.cookie.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) jar.set(decodeURIComponent(part.slice(0, i).trim()), decodeURIComponent(part.slice(i + 1).trim()));
    }
    return jar;
  };
  const write = (name: string, value: string, maxAge: number) => {
    doc.cookie = [
      `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
      `Domain=${domain}`,
      'Path=/',
      `Max-Age=${maxAge}`,
      'SameSite=Lax',
      ...(secure ? ['Secure'] : []),
    ].join('; ');
  };

  const removeItem = (key: string) => {
    const jar = read();
    const count = parseInt(jar.get(key) ?? '0', 10) || 0;
    for (let i = 0; i < Math.max(count, 1) + 2; i++) if (jar.has(`${key}.${i}`)) write(`${key}.${i}`, '', 0);
    if (jar.has(key)) write(key, '', 0);
  };

  return {
    getItem(key: string): string | null {
      const jar = read();
      const count = parseInt(jar.get(key) ?? '', 10);
      if (!Number.isFinite(count) || count < 1) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = jar.get(`${key}.${i}`);
        if (part === undefined) return null;
        parts.push(part);
      }
      return parts.join('');
    },
    setItem(key: string, value: string) {
      removeItem(key);
      const parts = value.match(new RegExp(`[\\s\\S]{1,${CHUNK}}`, 'g')) ?? [''];
      parts.forEach((part, i) => write(`${key}.${i}`, part, MAX_AGE));
      write(key, String(parts.length), MAX_AGE);
    },
    removeItem,
  };
}
