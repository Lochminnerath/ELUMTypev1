import { ApiError } from './errors';
import type { Address } from './types';

/** Input rules shared by every API implementation and the forms, matching the database's. */

export const EMAIL_RE = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[^\s@<>(),;:"[\]]+$/;
export const MIN_PASSWORD = 8;
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/;

export const RESERVED_HANDLES = new Set([
  'admin', 'administrator', 'elum', 'support', 'help', 'security', 'abuse', 'postmaster', 'hostmaster', 'webmaster',
  'noreply', 'no-reply', 'mailer-daemon', 'root', 'system', 'write', 'type', 'browse', 'make', 'store', 'billing',
  'privacy', 'legal', 'team', 'hello',
]);

/** Why a handle cannot be used, or null when its format is fine (it may still be taken). */
export function handleProblem(raw: string): string | null {
  const handle = raw.trim().toLowerCase();
  if (handle.length < 3) return 'Use at least 3 characters.';
  if (handle.length > 30) return 'Use at most 30 characters.';
  if (!/^[a-z0-9._-]+$/.test(handle)) return 'Use letters, numbers, dots, dashes or underscores.';
  if (!HANDLE_RE.test(handle)) return 'Start and end with a letter or number.';
  if (/[._-]{2}/.test(handle)) return 'Do not put two symbols in a row.';
  if (RESERVED_HANDLES.has(handle)) return 'That name is not available.';
  return null;
}

export function isEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim()) && value.trim().length <= 254;
}

/** A handle on its own signs in as handle@typeDomain. */
export function loginToEmail(login: string, typeDomain: string): string {
  const value = login.trim().toLowerCase();
  return value.includes('@') ? value : `${value}@${typeDomain}`;
}

export function cleanName(name: string): string {
  const value = name.replace(/\s+/g, ' ').trim();
  if (!value) throw new ApiError('invalid', 'Enter your name.', { field: 'name' });
  return value.slice(0, 80);
}

export function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD) {
    throw new ApiError('invalid', `Use at least ${MIN_PASSWORD} characters for your password.`, { field: 'password' });
  }
}

/**
 * Reads what people type or paste into an address field: "Rae <rae@x.org>, kai@y.org; fen".
 * Returns the addresses found and whatever could not be read.
 */
export function parseAddresses(input: string): { addresses: Address[]; rest: string[] } {
  const addresses: Address[] = [];
  const rest: string[] = [];
  for (const part of input.split(/[,;\n]+/)) {
    const piece = part.trim();
    if (!piece) continue;
    const angled = piece.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    const address = (angled ? angled[2] : piece).trim().toLowerCase();
    const name = angled ? angled[1].trim() || null : null;
    if (isEmail(address)) addresses.push({ address, name });
    else rest.push(piece);
  }
  return { addresses, rest };
}

/** "Rae Reed <rae@type.elum.example>" for headers and copy. */
export function formatAddress(a: Address): string {
  return a.name ? `${a.name} <${a.address}>` : a.address;
}

/** The name to show for an address: its name, or the part before @. */
export function displayName(a: Address): string {
  return a.name?.trim() || a.address.split('@')[0];
}

/** Adds "Re: " once, the way mail apps do. */
export function replySubject(subject: string | null): string {
  const s = (subject ?? '').trim();
  if (!s) return '';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export function forwardSubject(subject: string | null): string {
  const s = (subject ?? '').trim();
  return /^fwd?:/i.test(s) ? s : `Fwd: ${s}`;
}

/** `next` may be a path on this site or an https URL on the ELUM family domain (handoff 3.5). */
export function safeNext(next: string | null, familyDomain = 'elum.example'): string {
  if (!next) return '/';
  if (next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next;
  try {
    const url = new URL(next);
    const host = url.hostname.toLowerCase();
    if (url.protocol === 'https:' && (host === familyDomain || host.endsWith(`.${familyDomain}`))) return url.toString();
  } catch {
    // Not a URL.
  }
  return '/';
}
