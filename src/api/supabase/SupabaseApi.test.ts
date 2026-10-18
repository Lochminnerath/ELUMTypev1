import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { SupabaseApi } from './SupabaseApi';

/** Just enough of a Supabase client to see which address a sign-in uses. */
function fakeClient(serverDomain: string | null) {
  const tried: string[] = [];
  const client = {
    rpc: async (name: string) => (name === 'type_domain' && serverDomain ? { data: serverDomain, error: null } : { data: null, error: { message: 'missing' } }),
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithPassword: async ({ email }: { email: string }) => {
        tried.push(email);
        return { data: { session: null }, error: { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' } };
      },
    },
  };
  return { client: client as unknown as SupabaseClient, tried };
}

describe('signing in with a handle', () => {
  it('uses the Type domain the database has, not the one the build assumed', async () => {
    const { client, tried } = fakeClient('type.elum.example');
    const api = new SupabaseApi('https://x.supabase.co', 'anon', { typeDomain: 'type.elum.services', client });
    await expect(api.signIn({ login: 'Fen', password: 'secret-password' })).rejects.toThrow();
    expect(tried).toEqual(['fen@type.elum.example']);
  });

  it('falls back to the configured domain when the database cannot say', async () => {
    const { client, tried } = fakeClient(null);
    const api = new SupabaseApi('https://x.supabase.co', 'anon', { typeDomain: 'type.elum.services', client });
    await expect(api.signIn({ login: 'fen', password: 'secret-password' })).rejects.toThrow();
    expect(tried).toEqual(['fen@type.elum.services']);
  });

  it('signs in with a full address as typed', async () => {
    const { client, tried } = fakeClient('type.elum.example');
    const api = new SupabaseApi('https://x.supabase.co', 'anon', { client });
    await expect(api.signIn({ login: 'Ola@Example.org', password: 'secret-password' })).rejects.toThrow();
    expect(tried).toEqual(['ola@example.org']);
  });
});
