/**
 * Password hashing for the local API. Even though local accounts never leave
 * the browser, passwords are stored only as salted PBKDF2-SHA256 hashes.
 * On Supabase, Auth hashes passwords on the server; this file is for preview mode only.
 */

export interface PasswordHash {
  salt: string;
  hash: string;
  iterations: number;
}

export const DEFAULT_ITERATIONS = 210_000;

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

export async function hashPassword(password: string, iterations = DEFAULT_ITERATIONS): Promise<PasswordHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toHex(salt), hash: await derive(password, salt, iterations), iterations };
}

export async function verifyPassword(password: string, stored: PasswordHash): Promise<boolean> {
  const candidate = await derive(password, fromHex(stored.salt), stored.iterations);
  // Constant-time comparison.
  let diff = candidate.length ^ stored.hash.length;
  for (let i = 0; i < candidate.length && i < stored.hash.length; i++) {
    diff |= candidate.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  }
  return diff === 0;
}

export function randomToken(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
