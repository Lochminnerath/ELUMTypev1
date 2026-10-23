import { describe, expect, it } from 'vitest';
import { RELEASES, planWhatsNew, tourSteps, type Release } from './releases';

const r = (id: string): Release => ({ id, date: id, title: id, intro: 'i', features: [{ title: 't', text: 'x', art: 'spark' }] });
const list = [r('c'), r('b'), r('a')];

describe("what's new", () => {
  it('opens each release with its title, then one step per feature', () => {
    const steps = tourSteps(list.slice(0, 2));
    expect(steps.map((s) => s.key)).toEqual(['c:intro', 'c:0', 'b:intro', 'b:0']);
    expect(steps[0].art).toBe('mark');
  });

  it('has unique ids and something to show in every release', () => {
    expect(new Set(RELEASES.map((x) => x.id)).size).toBe(RELEASES.length);
    for (const release of RELEASES) expect(release.features.length).toBeGreaterThan(0);
    const keys = tourSteps(RELEASES).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  describe('plan', () => {
    it('shows nothing to someone brand new, and remembers the latest quietly', () => {
      expect(planWhatsNew(list, { account: null, local: null })).toEqual({ show: [], record: 'c' });
    });

    it('shows only releases newer than the one seen on the account', () => {
      expect(planWhatsNew(list, { account: 'a', local: null }).show.map((x) => x.id)).toEqual(['c', 'b']);
      expect(planWhatsNew(list, { account: 'b', local: null })).toEqual({ show: [list[0]], record: null });
    });

    it('trusts the newer of the account and this browser', () => {
      expect(planWhatsNew(list, { account: 'a', local: 'b' }).show.map((x) => x.id)).toEqual(['c']);
      expect(planWhatsNew(list, { account: 'c', local: 'a' })).toEqual({ show: [], record: null });
    });

    it('copies a browser-only record to the account without showing anything', () => {
      expect(planWhatsNew(list, { account: null, local: 'c' })).toEqual({ show: [], record: 'c' });
    });

    it('shows nothing for an id we no longer know', () => {
      expect(planWhatsNew(list, { account: 'gone', local: null })).toEqual({ show: [], record: 'c' });
    });

    it('does nothing without releases', () => {
      expect(planWhatsNew([], { account: null, local: null })).toEqual({ show: [], record: null });
    });
  });
});
