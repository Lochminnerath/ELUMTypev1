import type { TypeApi } from './client';
import { LocalApi } from './local/LocalApi';
import { SupabaseApi } from './supabase/SupabaseApi';

/**
 * The one API instance the app uses:
 * - VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set: the ELUM platform on Supabase
 * - neither: preview mode, with everything kept in this browser
 */
const env = import.meta.env;
const supabaseUrl = env.VITE_SUPABASE_URL?.trim();
const supabaseKey = env.VITE_SUPABASE_ANON_KEY?.trim();
const typeDomain = env.VITE_ELUM_TYPE_DOMAIN?.trim() || 'type.elum.services';

export const api: TypeApi = supabaseUrl && supabaseKey ? new SupabaseApi(supabaseUrl, supabaseKey, { typeDomain }) : new LocalApi({ typeDomain });

export * from './types';
export type { TypeApi } from './client';
export { ApiError, errorMessage, isApiError } from './errors';
