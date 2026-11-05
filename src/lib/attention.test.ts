import { describe, expect, it } from 'vitest';
import { badgeTitle, claim } from './attention';

function fakeDoc(hostname = 'write.elum.space') {
  const jar = new Map<string, string>();
  return {
    location: { hostname },
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(value: string) {
      const [pair] = value.split('; ');
      const [k, v] = pair.split('=');
      jar.set(k, v);
    },
  } as unknown as Document;
}

describe('badgeTitle', () => {
  it('puts the count before the title and replaces an old one', () => {
    expect(badgeTitle('Inbox · ELUM Type', 1)).toBe('(1) Inbox · ELUM Type');
    expect(badgeTitle('(1) Inbox · ELUM Type', 3)).toBe('(3) Inbox · ELUM Type');
    expect(badgeTitle('(3) Inbox · ELUM Type', 0)).toBe('Inbox · ELUM Type');
    expect(badgeTitle('Inbox', 120)).toBe('(99+) Inbox');
  });
});

describe('claim', () => {
  it('lets only the first ELUM tab chime for a notification', () => {
    const doc = fakeDoc();
    expect(claim('a', doc)).toBe(true);
    expect(claim('a', doc)).toBe(false);
    expect(claim('b', doc)).toBe(true);
  });
});
