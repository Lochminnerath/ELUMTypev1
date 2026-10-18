// Creates ELUM Type accounts (handoff 3.4), and confirms recovery emails. Runs on Supabase Edge
// Functions (Deno) with the service role, because only the server may create a user with a
// confirmed Type address and set account_type and handle.
//
//   POST { handle, name, password, recoveryEmail?, captchaToken? }   create an account
//   POST { action: "resend-recovery" } with the person's session      send a new recovery code
//
// Secrets (supabase secrets set ...):
//   CAPTCHA_PROVIDER   turnstile or hcaptcha. With CAPTCHA_SECRET set, sign-up needs a token.
//   CAPTCHA_SECRET     The provider's secret key.
//   BREVO_API_KEY      For recovery codes. Without it, the code is not sent (the person can resend later).
//   TYPE_EMAIL_FROM    Sender, for example "ELUM Type <hello@type.elum.services>".
//   APP_URL            Where Type is hosted, for images in emails, for example https://elumtype.netlify.app
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy with --no-verify-jwt: people signing up have no session yet.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { recoveryCodeEmail } from '../_shared/email.ts';
import { CORS, fail, fromDbError, ok } from '../_shared/http.ts';
import { cleanAddress, isDisposable, sixDigitCode } from '../_shared/mail.ts';

const HANDLE_RE = /^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$/;

interface SignupBody {
  action?: 'resend-recovery';
  handle?: string;
  name?: string;
  password?: string;
  recoveryEmail?: string;
  captchaToken?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('invalid', 'Use POST.');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  let body: SignupBody;
  try {
    body = await req.json();
  } catch {
    return fail('invalid', 'Send the details as JSON.');
  }

  if (body.action === 'resend-recovery') return resendRecovery(req, db);

  // 1. Abuse limits: captcha, then 5 sign-ups an hour from one address.
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const captcha = await checkCaptcha(body.captchaToken, ip);
  if (!captcha) return fail('forbidden', 'Confirm you are a person and try again.');
  const guard = await db.rpc('type_signup_guard', { p_ip: ip });
  if (guard.error) return fromDbError(guard.error);
  if (guard.data !== true) return fail('rate_limited', 'Too many new accounts from here. Try again in an hour.');

  // 2. The details.
  const handle = String(body.handle ?? '').trim().toLowerCase();
  const name = String(body.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const password = String(body.password ?? '');
  const recovery = body.recoveryEmail ? cleanAddress(body.recoveryEmail) : null;
  if (!name) return fail('invalid', 'Enter your name.', { field: 'name' });
  if (!HANDLE_RE.test(handle) || /[._-]{2}/.test(handle)) {
    return fail('invalid', 'Addresses are 3 to 30 letters, numbers, dots, dashes or underscores.', { field: 'handle' });
  }
  if (password.length < 8) return fail('invalid', 'Use at least 8 characters for your password.', { field: 'password' });
  if (body.recoveryEmail && !recovery) return fail('invalid', 'Enter a valid recovery email, or leave it empty.', { field: 'recoveryEmail' });
  if (recovery && isDisposable(recovery)) return fail('invalid', 'Use a recovery email you will keep.', { field: 'recoveryEmail' });

  const available = await db.rpc('elum_handle_available', { p_handle: handle });
  if (available.error) return fromDbError(available.error);
  if (available.data !== true) return fail('conflict', 'That name is taken.', { field: 'handle' });

  const domain = await typeDomain(db);
  if (recovery?.endsWith(`@${domain}`)) return fail('invalid', 'Use a recovery email outside ELUM Type.', { field: 'recoveryEmail' });

  // 3. The user, with the Type address as a confirmed login. The profile and login address follow by trigger.
  const created = await db.auth.admin.createUser({ email: `${handle}@${domain}`, password, email_confirm: true, user_metadata: { name } });
  if (created.error || !created.data.user) {
    const message = created.error?.message ?? '';
    if (/already|registered|exists/i.test(message)) return fail('conflict', 'That name is taken.', { field: 'handle' });
    if (/password/i.test(message)) return fail('invalid', message, { field: 'password' });
    return fail('server', 'We could not create your account. Please try again.');
  }
  const userId = created.data.user.id;

  // 4. The Type address. If someone took the name a moment ago, undo.
  const assigned = await db.rpc('elum_assign_type_address', { p_account: userId, p_handle: handle });
  if (assigned.error) {
    await db.auth.admin.deleteUser(userId);
    return fromDbError(assigned.error);
  }

  // 5. The recovery email, confirmed later with a code.
  let recoveryPending = false;
  if (recovery) recoveryPending = await sendRecoveryCode(db, userId, recovery, assigned.data as string);

  // 6. The app signs in with the password and joins Type (elum_join_service) on start.
  return ok({ address: assigned.data, recoveryPending }, 201);
});

/** The domain Type addresses live on (elum.config type_domain). */
async function typeDomain(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.rpc('type_domain');
  if (error || typeof data !== 'string') throw new Error('type_domain unavailable');
  return data;
}

async function checkCaptcha(token: string | undefined, ip: string): Promise<boolean> {
  const secret = Deno.env.get('CAPTCHA_SECRET');
  if (!secret) return true;
  if (!token) return false;
  const provider = Deno.env.get('CAPTCHA_PROVIDER') ?? 'turnstile';
  const url = provider === 'hcaptcha' ? 'https://api.hcaptcha.com/siteverify' : 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  const form = new URLSearchParams({ secret, response: token, remoteip: ip });
  try {
    const res = await fetch(url, { method: 'POST', body: form });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

async function sendRecoveryCode(db: SupabaseClient, userId: string, address: string, typeAddress: string): Promise<boolean> {
  const code = sixDigitCode();
  const stored = await db.rpc('type_recovery_start', { p_account: userId, p_address: address, p_code: code });
  if (stored.error) return false;
  const key = Deno.env.get('BREVO_API_KEY');
  const from = Deno.env.get('TYPE_EMAIL_FROM');
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/+$/, '');
  if (!key || !from || !appUrl) return true;
  const sender = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  const email = recoveryCodeEmail({ code, address, typeAddress }, { assetBase: appUrl });
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: sender ? { name: sender[1] || 'ELUM Type', email: sender[2] } : { name: 'ELUM Type', email: from.trim() },
      to: [{ email: address }],
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
      tags: ['type-recovery'],
    }),
  });
  return res.ok;
}

/** A new code for the signed-in person's pending recovery email. */
async function resendRecovery(req: Request, db: SupabaseClient): Promise<Response> {
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth.user) return fail('unauthorized', 'Your session has ended. Sign in again.');
  const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const start = await asUser.rpc('type_start');
  if (start.error) return fromDbError(start.error);
  const pending = (start.data as { pendingRecovery?: string | null }).pendingRecovery;
  if (!pending) return fail('not_found', 'There is no recovery email waiting to be confirmed.');
  const guard = await db.rpc('type_signup_guard', { p_ip: `recovery:${auth.user.id}` });
  if (guard.data !== true) return fail('rate_limited', 'You asked for a lot of codes. Try again in an hour.');
  const sent = await sendRecoveryCode(db, auth.user.id, pending, auth.user.email ?? '');
  return sent ? ok({ sent: true }) : fail('server', 'We could not send the code. Try again in a minute.');
}
