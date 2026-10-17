/**
 * Responses in the one ELUM shape (handoff 5.2): { data } on success, { error: { code, message,
 * details } } with the matching HTTP status on failure. Plain TypeScript, so it runs in Deno and in tests.
 */

export type ErrorCode = 'invalid' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited' | 'server';

const STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  server: 500,
};

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function ok(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

export function fail(code: ErrorCode, message: string, details: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ error: { code, message, details } }), {
    status: STATUS[code],
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/** Database errors (PT400 ...) as the same codes. */
export function fromDbError(error: { code?: string; message?: string } | null | undefined): Response {
  const map: Record<string, ErrorCode> = {
    PT400: 'invalid',
    PT401: 'unauthorized',
    PT403: 'forbidden',
    PT404: 'not_found',
    PT409: 'conflict',
    PT429: 'rate_limited',
  };
  const code = map[error?.code ?? ''] ?? 'server';
  return fail(code, code === 'server' ? 'Something went wrong. Please try again.' : (error?.message ?? 'Something went wrong.'));
}

/** Compares secrets without leaking how much matched. */
export function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** True when the request carries the shared secret, as a Bearer token or a ?token= parameter. */
export function hasSecret(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get('Authorization') ?? '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const token = new URL(req.url).searchParams.get('token') ?? '';
  return safeEqual(bearer, secret) || safeEqual(token, secret);
}
