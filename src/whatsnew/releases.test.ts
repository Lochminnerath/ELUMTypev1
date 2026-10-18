import { describe, expect, it } from 'vitest';
import { RELEASES, unseenReleases, type Release } from './releases';

const r = (id: string): Release => ({ id, date: id, title: id, items: ['x'] });
const list = [r('c'), r('b'), r('a')];

describe("what's new", () => {
  it('shows only the latest release to someone new', () => {
    expect(unseenReleases(list, null).map((x) => x.id)).toEqual(['c']);
  });

  it('shows every release since the last one seen', () => {
    expect(unseenReleases(list, 'a').map((x) => x.id)).toEqual(['c', 'b']);
  });

  it('shows nothing once the latest was seen', () => {
    expect(unseenReleases(list, 'c')).toEqual([]);
  });

  it('shows the latest when the last one seen no longer exists', () => {
    expect(unseenReleases(list, 'gone').map((x) => x.id)).toEqual(['c']);
  });

  it('has unique ids and something to say in every release', () => {
    expect(new Set(RELEASES.map((x) => x.id)).size).toBe(RELEASES.length);
    for (const release of RELEASES) expect(release.items.length).toBeGreaterThan(0);
  });
});
