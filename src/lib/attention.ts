/**
 * ELUM's notification chime and tab badge, the same in every ELUM app.
 *
 * - arrived(): call when a notification comes in live. It plays the ELUM chime (made here with the
 *   Web Audio API, no sound files) and, while the tab is in the background, counts it on the tab:
 *   a numbered badge on the favicon and "(1)" before the title. Coming back to the tab clears both.
 * - The chime plays once even with several ELUM apps open: the first tab to hear a notification
 *   claims it in a cookie shared across elum.space.
 * - Sound can be turned off per device (soundOn / setSoundOn), and never plays for old
 *   notifications replayed after a reconnect.
 */

const SOUND_KEY = 'elum-notification-sound';
const CLAIM_COOKIE = 'elum_chime';
const FRESH_MS = 2 * 60_000;
const QUIET_MS = 1500;

// ------------------------------------------------------------------ setting

const listeners = new Set<(on: boolean) => void>();

export function soundOn(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Private windows may refuse storage; the choice then lasts for this page only.
  }
  listeners.forEach((l) => l(on));
  if (on) void chime();
}

export function onSoundChange(listener: (on: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ------------------------------------------------------------------ the chime

let context: AudioContext | null = null;
let room: ConvolverNode | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    context = new Ctor();
    // A small, soft room: a short burst of decaying noise as the reverb's impulse.
    const seconds = 1.6;
    const ir = context.createBuffer(2, Math.floor(context.sampleRate * seconds), context.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 3.2);
    }
    room = context.createConvolver();
    room.buffer = ir;
    const wet = context.createGain();
    wet.gain.value = 0.22;
    room.connect(wet).connect(context.destination);
  }
  return context;
}

// Browsers only allow sound after someone has used the page, so the first tap or key wakes it.
if (typeof window !== 'undefined') {
  const wake = () => {
    const ctx = audio();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('pointerdown', wake, { once: true, capture: true });
  window.addEventListener('keydown', wake, { once: true, capture: true });
}

/** One bell-like note: a soft sine with a few bell partials that fade faster than the tone. */
function bell(ctx: AudioContext, out: AudioNode, freq: number, at: number, level: number) {
  const partials: [ratio: number, gain: number, decay: number][] = [
    [1, 1, 1.5],
    [2.0, 0.22, 0.7],
    [2.76, 0.12, 0.45],
    [5.4, 0.04, 0.2],
  ];
  for (const [ratio, gain, decay] of partials) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(level * gain, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

let lastChime = 0;

/** The ELUM chime: two rising glass notes (E6, then B6) with a little room around them. */
export async function chime(): Promise<void> {
  const ctx = audio();
  if (!ctx) return;
  if (Date.now() - lastChime < QUIET_MS) return;
  lastChime = Date.now();
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return;
    }
  }
  if (ctx.state !== 'running') return;
  const master = ctx.createGain();
  master.gain.value = 0.32;
  master.connect(ctx.destination);
  if (room) master.connect(room);
  const t = ctx.currentTime + 0.02;
  bell(ctx, master, 1318.51, t, 0.5);
  bell(ctx, master, 1975.53, t + 0.11, 0.42);
}

// ------------------------------------------------------------------ one chime across tabs

/** True for the first ELUM tab to claim this notification; the others stay quiet. */
export function claim(id: string, doc: Document = document): boolean {
  const current = doc.cookie.split('; ').find((c) => c.startsWith(`${CLAIM_COOKIE}=`))?.slice(CLAIM_COOKIE.length + 1) ?? '';
  const ids = decodeURIComponent(current).split(',').filter(Boolean);
  if (ids.includes(id)) return false;
  const next = [id, ...ids].slice(0, 20).join(',');
  const shared = doc.location?.hostname?.endsWith('elum.space') ? '; domain=elum.space' : '';
  doc.cookie = `${CLAIM_COOKIE}=${encodeURIComponent(next)}; max-age=60; path=/; samesite=lax${shared}`;
  return true;
}

// ------------------------------------------------------------------ the tab badge

let away = 0;
let baseIcon: string | null = null;
let baseTitle: string | null = null;

function iconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
}

/** "(3) Inbox · ELUM Type" from "Inbox · ELUM Type", replacing any count already there. */
export function badgeTitle(title: string, count: number): string {
  const bare = title.replace(/^\(\d+\+?\)\s/, '');
  return count > 0 ? `(${count > 99 ? '99+' : count}) ${bare}` : bare;
}

/** An SVG icon without a width and height draws as nothing on a canvas, so give it one. */
async function drawable(href: string, size: number): Promise<string> {
  if (!/\.svg(\?|#|$)|^data:image\/svg/i.test(href)) return href;
  try {
    const svg = await (await fetch(href)).text();
    const sized = svg.replace(/<svg\b([^>]*)>/i, (tag, attrs: string) =>
      /\swidth=/.test(attrs) ? tag : `<svg${attrs} width="${size}" height="${size}">`,
    );
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
  } catch {
    return href;
  }
}

/**
 * The tab icon while something waits, drawn on ELUM's two-circle mark: the count in a larger soft
 * coral circle at the top right, and the app's own icon in a smaller circle at the bottom left,
 * with a thin clear gap where they meet.
 */
async function drawBadge(href: string, count: number): Promise<string | null> {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const app = { x: 20, y: 44, r: 20 };
  const badge = { x: 41, y: 23, r: 22 };
  const circle = (c: { x: number; y: number; r: number }, extra = 0) => {
    g.beginPath();
    g.arc(c.x, c.y, c.r + extra, 0, Math.PI * 2);
  };

  // The app, bottom left.
  g.save();
  circle(app);
  g.clip();
  g.fillStyle = '#0e1220';
  g.fillRect(0, 0, size, size);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = await drawable(href, size);
    await img.decode();
    // App icons are a symbol on a rounded square: drawn larger than the circle so the symbol
    // itself fills it and stays recognisable at tab size.
    const d = app.r * 2.9;
    g.drawImage(img, app.x - d / 2, app.y - d / 2, d, d);
  } catch {
    // No readable icon: the dark circle stands in for it.
  }
  g.restore();
  // A faint rim so the app circle still shows on dark tab bars.
  circle(app, -0.75);
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(186, 202, 252, 0.55)';
  g.stroke();

  // The gap where the circles meet, then the count, top right.
  g.save();
  g.globalCompositeOperation = 'destination-out';
  circle(badge, 3);
  g.fill();
  g.restore();
  const fill = g.createLinearGradient(badge.x - badge.r, badge.y - badge.r, badge.x + badge.r, badge.y + badge.r);
  fill.addColorStop(0, '#f08a7e');
  fill.addColorStop(1, '#d9574b');
  circle(badge);
  g.fillStyle = fill;
  g.fill();
  // A soft highlight on the upper left, like the glass in ELUM's circles.
  const glow = g.createRadialGradient(badge.x - 9, badge.y - 11, 1, badge.x - 9, badge.y - 11, badge.r);
  glow.addColorStop(0, 'rgba(255,255,255,0.38)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  circle(badge);
  g.fillStyle = glow;
  g.fill();

  const text = count > 9 ? '9+' : String(count);
  g.fillStyle = '#ffffff';
  g.font = `700 ${text.length > 1 ? 25 : 32}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, badge.x, badge.y + 2);
  return canvas.toDataURL('image/png');
}

async function showBadge(count: number) {
  const link = iconLink();
  if (baseTitle === null) baseTitle = document.title;
  document.title = badgeTitle(document.title, count);
  if (!link) return;
  if (baseIcon === null) baseIcon = link.href;
  const url = await drawBadge(baseIcon, count);
  if (url && away === count) link.href = url;
}

function clearBadge() {
  away = 0;
  document.title = badgeTitle(document.title, 0);
  const link = iconLink();
  if (link && baseIcon !== null) link.href = baseIcon;
  baseIcon = null;
  baseTitle = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && clearBadge());
  window.addEventListener('focus', clearBadge);
}

// ------------------------------------------------------------------ the one call apps make

const heard = new Set<string>();

/** A notification came in live. Chimes (once across ELUM tabs) and badges the tab if it is in the background. */
export function arrived(n: { id: string; createdAt?: string | null }): void {
  if (typeof document === 'undefined' || heard.has(n.id)) return;
  heard.add(n.id);
  if (n.createdAt && Date.now() - Date.parse(n.createdAt) > FRESH_MS) return;
  if (document.visibilityState !== 'visible') {
    away += 1;
    void showBadge(away);
  }
  if (soundOn() && claim(n.id)) void chime();
}
