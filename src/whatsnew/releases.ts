import type { Art } from './scenes';

/**
 * What changed in Type, newest first. Add a release at the top whenever an update ships: people
 * get a short animated tour of it the next time they open Type, and can replay every release
 * from the account menu (What's new). Give each release a new id; the date is shown as written.
 *
 * Each feature is one step of the tour. `art` picks its animated picture (see scenes.tsx):
 * mark, share, devices, layers, check or spark.
 */

export interface Feature {
  title: string;
  text: string;
  art: Art;
}

export interface Release {
  /** Unique and never reused, such as 2026-10-18. */
  id: string;
  date: string;
  title: string;
  /** One or two sentences under the title on the opening step. */
  intro: string;
  features: Feature[];
}

export const APP_NAME = 'Type';

export const RELEASES: Release[] = [
  {
    id: '2026-10-22-phones-motion',
    date: '22 October 2026',
    title: 'Made for your phone',
    intro: 'Type now feels at home on a phone, and moves a little more gently everywhere.',
    features: [
      {
        title: 'Built for your thumb',
        text: 'A tab bar along the bottom, Compose always in reach, and fields that no longer make your phone zoom in.',
        art: 'devices',
      },
      {
        title: 'Gentle motion',
        text: 'Conversations slide in and out, new messages settle into the list, and the inbox shows its shape while it loads. If you prefer less motion, Type stays still.',
        art: 'spark',
      },
      {
        title: 'Type, your way',
        text: 'New settings for the reading pane, density, when messages count as read, reply or reply all, a moment to undo sending, and swiping on phones.',
        art: 'layers',
      },
      {
        title: 'What is new, once',
        text: 'Your account now remembers which updates you have seen, so this tour shows once, not on every browser.',
        art: 'check',
      },
    ],
  },
  {
    id: '2026-10-19-symbols',
    date: '19 October 2026',
    title: 'Symbols, redrawn',
    intro: 'Every action now has a symbol built from ELUM circles.',
    features: [
      {
        title: 'Symbols drawn from circles',
        text: 'Archive, delete, send, attach, lock and the rest are now drawn from the rings and discs of the ELUM marks, each with its own colour.',
        art: 'layers',
      },
      {
        title: 'Your tab shows what is open',
        text: 'An open conversation shows the Type message symbol in your browser tab, so you can find it among your tabs.',
        art: 'mark',
      },
    ],
  },
  {
    id: '2026-10-19',
    date: '19 October 2026',
    title: "A fresh coat for Type",
    intro: "Small touches that make Type feel like part of the ELUM family.",
    features: [
      {
        title: 'Approve new sign-ins',
        text: 'Turn it on in ELUM Account, under Security. Anyone signing in with your password then waits until you pick the matching number on a device you are signed in to.',
        art: 'check',
      },
      {
        title: 'Every action, its own symbol',
        text: 'Archive, delete, share, reply, download and more each have their own ELUM symbol and colour, so you can tell them apart at a glance.',
        art: 'layers',
      },
      {
        title: 'Move between apps',
        text: 'Open the ELUM apps window from the dots at the top of the page, and jump to Write, Type, Make or your account in one click.',
        art: 'spark',
      },
      {
        title: "The right icon, everywhere",
        text: "Browsers now show the Type icon in your tabs and bookmarks, matching Write, Make and ELUM Account.",
        art: 'mark',
      },
      {
        title: "Updates, told properly",
        text: "This tour. You will see one like it after each update, and can replay them any time from your account menu.",
        art: 'spark',
      },
    ],
  },
  {
    id: '2026-10-18',
    date: '18 October 2026',
    title: "ELUM Type is live",
    intro: "Mail and messages with your own ELUM address.",
    features: [
      {
        title: "Your own address",
        text: "Get an address on type.elum.services, and sign in with it or with just your name.",
        art: 'check',
      },
      {
        title: "One account, every app",
        text: "Your account is saved to ELUM, so the same account works in Write, Make and ELUM Account.",
        art: 'devices',
      },
      {
        title: "People know it is you",
        text: "Every account gets a profile, so people see your name on your messages.",
        art: 'share',
      },
      {
        title: "Clearer when things go wrong",
        text: "Signing up and signing in now say what happened and what to do next.",
        art: 'check',
      },
    ],
  },
];

export interface WhatsNewPlan {
  /** Releases to show now, newest first. */
  show: Release[];
  /** A release id to remember straight away, without showing anything. */
  record: string | null;
}

/**
 * What to show, given the last release remembered on the account and in this browser. Only
 * releases newer than the last one seen are shown. Someone with nothing remembered anywhere (a
 * new account) sees nothing: we quietly remember the latest so the next update is their first tour.
 */
export function planWhatsNew(releases: Release[], seen: { account: string | null; local: string | null }): WhatsNewPlan {
  const latest = releases[0];
  if (!latest) return { show: [], record: null };
  const index = (id: string | null) => (id ? releases.findIndex((r) => r.id === id) : -1);
  const known = [index(seen.account), index(seen.local)].filter((i) => i !== -1);
  if (!known.length) return { show: [], record: seen.account === latest.id ? null : latest.id };
  // The newest of the two wins, so a tour seen on another device is not shown again here.
  const at = Math.min(...known);
  if (at === 0) return { show: [], record: seen.account === latest.id ? null : latest.id };
  return { show: releases.slice(0, at), record: null };
}

export interface Step {
  key: string;
  eyebrow: string;
  title: string;
  text: string;
  art: Art;
}

/** The tour for some releases: each opens with its title, then one step per feature. */
export function tourSteps(releases: Release[]): Step[] {
  return releases.flatMap((r) => [
    { key: `${r.id}:intro`, eyebrow: `New in ${APP_NAME} · ${r.date}`, title: r.title, text: r.intro, art: 'mark' as const },
    ...r.features.map((f, i) => ({ key: `${r.id}:${i}`, eyebrow: r.title, title: f.title, text: f.text, art: f.art })),
  ]);
}
