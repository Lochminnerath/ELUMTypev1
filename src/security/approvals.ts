import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Approving new sign-ins (ELUM Account > Security > Approve new sign-ins). The database enforces
 * it: an unapproved session gets tokens with role elum_pending, which can read nothing. This file
 * is how an app notices and talks to the two sides:
 * - the new device, which shows a number and waits;
 * - a device already signed in, which is asked "Is this you?" and picks that number.
 */

export const PENDING_ROLE = 'elum_pending';

/** The role inside an access token (a JWT), without verifying it: the server does that. */
export function tokenRole(accessToken: string | null | undefined): string | null {
  try {
    const payload = accessToken?.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='));
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

export type MySignInStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface MySignIn {
  status: MySignInStatus;
  code?: number;
  expiresAt?: string;
}

export interface SignInRequest {
  id: string;
  device: string;
  ip: string | null;
  at: string;
  expiresAt: string;
  numbers: number[];
}

/** For the waiting device: approved yet, and which number to show. */
export async function mySignIn(sb: SupabaseClient): Promise<MySignIn> {
  const { data, error } = await sb.rpc('elum_my_sign_in');
  if (error) throw error;
  return data as MySignIn;
}

/** For signed-in devices: sign-ins waiting for this account. Null when the database has no approvals yet. */
export async function signInRequests(sb: SupabaseClient): Promise<SignInRequest[] | null> {
  const { data, error } = await sb.rpc('elum_sign_in_requests');
  if (error) return null;
  return (data as SignInRequest[]) ?? [];
}

/** Picks a number (approve if it is the right one), or null for "No, it's not me". */
export async function answerSignIn(sb: SupabaseClient, id: string, number: number | null): Promise<'approved' | 'denied'> {
  const { data, error } = await sb.rpc('elum_answer_sign_in', { p_session: id, p_number: number });
  if (error) throw error;
  return data as 'approved' | 'denied';
}
