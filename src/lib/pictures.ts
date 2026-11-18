import { useEffect, useState } from 'react';
import { api } from '../api';

/**
 * Pictures for the people in Type. ELUM people show the picture from their ELUM Account, when
 * their privacy lets you see it. People outside ELUM show their public Gravatar picture, when they
 * have one. Everyone else, and anyone whose picture is private, gets a circle in one of the ELUM
 * colours, always the same one for the same address.
 */

/** The ELUM colours a picture can fall back to. */
export const PICTURE_COLOURS = ['#f59a52', '#3fc4a0', '#ec7fa9', '#9b84ee', '#e9b949', '#f06a5f', '#48bfe3', '#d27fe0', '#5ec46f', '#7093f8'];

/** The same colour every time for the same address. */
export function colourFor(address: string): string {
  let h = 2166136261;
  for (const c of address.trim().toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return PICTURE_COLOURS[h % PICTURE_COLOURS.length];
}

const elumCache = new Map<string, Promise<string | null>>();
let queue: { address: string; resolve: (url: string | null) => void }[] = [];
let flushing = false;

/** ELUM pictures are asked for together: one request for everything a screen shows. */
function elumPicture(address: string): Promise<string | null> {
  const key = address.trim().toLowerCase();
  const hit = elumCache.get(key);
  if (hit) return hit;
  const promise = new Promise<string | null>((resolve) => {
    queue.push({ address: key, resolve });
    if (!flushing) {
      flushing = true;
      queueMicrotask(() => {
        const batch = queue;
        queue = [];
        flushing = false;
        const fetch = api.pictures?.([...new Set(batch.map((b) => b.address))]) ?? Promise.resolve({} as Record<string, string | null>);
        fetch.then(
          (found) => batch.forEach((b) => b.resolve(found[b.address] ?? null)),
          () => batch.forEach((b) => b.resolve(null)),
        );
      });
    }
  });
  elumCache.set(key, promise);
  return promise;
}

const gravatarCache = new Map<string, Promise<string>>();

/** The Gravatar address for an email (SHA-256 of the address, as Gravatar asks). */
export function gravatarUrl(address: string, size = 128): Promise<string> {
  const key = address.trim().toLowerCase();
  let hit = gravatarCache.get(key);
  if (!hit) {
    hit = crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)).then((buf) => {
      const hex = Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
      // d=404: no picture means no picture, so the colour shows instead.
      return `https://gravatar.com/avatar/${hex}?s=${size}&d=404`;
    });
    gravatarCache.set(key, hit);
  }
  return hit;
}

/** A picture for this person, or null for their colour. */
export function usePicture(person: { address?: string | null; isElum?: boolean } | null | undefined): string | null {
  const address = person?.address?.trim().toLowerCase() || '';
  const elum = !!person?.isElum;
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!address) return;
    let live = true;
    setUrl(null);
    const find = elum ? elumPicture(address) : typeof crypto !== 'undefined' && crypto.subtle ? gravatarUrl(address) : Promise.resolve(null);
    find.then(
      (u) => live && setUrl(u),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [address, elum]);
  return url;
}

/** For tests: forget what was looked up. */
export function forgetPictures() {
  elumCache.clear();
  gravatarCache.clear();
}
