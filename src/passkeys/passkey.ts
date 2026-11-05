/**
 * Signing in with a passkey, in any ELUM app. The same file is in every app.
 *
 * Passkeys belong to elum.space itself, so the one a person made in ELUM Account works on every
 * app at *.elum.space. Off elum.space (a *.netlify.app address) the button is not shown: a passkey
 * there belongs to that exact address, and only ELUM Account's addresses can have one.
 *
 * The browser asks for the passkey; ELUM Account's passkey function checks it and answers with a
 * one-time sign-in token, which this app trades for its own session. No extra packages are needed.
 */

/** True when this page is on ELUM's own domain (or this computer) and the browser has passkeys. */
export function passkeySignInShown(location: Pick<Location, 'protocol' | 'hostname'> = window.location): boolean {
  if (typeof window === 'undefined' || typeof window.PublicKeyCredential !== 'function') return false;
  return passkeyHost(location);
}

/** Whether passkeys work on this address. Separate from the browser check, for tests. */
export function passkeyHost({ protocol, hostname }: Pick<Location, 'protocol' | 'hostname'>): boolean {
  if (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) return true;
  return protocol === 'https:' && (hostname === 'elum.space' || hostname.endsWith('.elum.space'));
}

export function fromBase64url(value: string): ArrayBuffer {
  const b = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b.padEnd(Math.ceil(b.length / 4) * 4, '='));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function toBase64url(buffer: ArrayBuffer | null | undefined): string | undefined {
  if (!buffer) return undefined;
  let s = '';
  for (const b of new Uint8Array(buffer)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** What the passkey function sends to start a sign-in (WebAuthn request options, as JSON). */
export interface PasskeyRequestOptions {
  challenge: string;
  rpId?: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: { id: string; type: 'public-key'; transports?: AuthenticatorTransport[] }[];
}

/** The browser's answer, as JSON the passkey function reads. */
export interface PasskeyAnswer {
  id: string;
  rawId: string;
  type: 'public-key';
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string };
  clientExtensionResults: Record<string, unknown>;
  authenticatorAttachment?: string;
}

/** Thrown when the person closes the passkey window or no passkey was chosen. */
export class PasskeyCancelled extends Error {
  constructor() {
    super('No passkey was used.');
    this.name = 'PasskeyCancelled';
  }
}

/** Asks the browser for a passkey. */
export async function askForPasskey(options: PasskeyRequestOptions): Promise<PasskeyAnswer> {
  let credential: Credential | null;
  try {
    credential = await navigator.credentials.get({
      publicKey: {
        challenge: fromBase64url(options.challenge),
        rpId: options.rpId,
        timeout: options.timeout,
        userVerification: options.userVerification ?? 'preferred',
        allowCredentials: (options.allowCredentials ?? []).map((c) => ({ id: fromBase64url(c.id), type: c.type, transports: c.transports })),
      },
    });
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === 'NotAllowedError' || name === 'AbortError') throw new PasskeyCancelled();
    throw new Error('This browser could not use a passkey. Try again, or use your password.');
  }
  if (!credential) throw new PasskeyCancelled();
  const c = credential as PublicKeyCredential;
  const r = c.response as AuthenticatorAssertionResponse;
  return {
    id: c.id,
    rawId: toBase64url(c.rawId)!,
    type: 'public-key',
    response: {
      clientDataJSON: toBase64url(r.clientDataJSON)!,
      authenticatorData: toBase64url(r.authenticatorData)!,
      signature: toBase64url(r.signature)!,
      userHandle: toBase64url(r.userHandle),
    },
    clientExtensionResults: c.getClientExtensionResults() as Record<string, unknown>,
    authenticatorAttachment: c.authenticatorAttachment ?? undefined,
  };
}
