/**
 * What people see when something goes wrong: a plain sentence, never the inside of ELUM.
 *
 * Messages that name the systems behind ELUM (Supabase, the database, SQL, functions, tables,
 * migrations), or carry codes, brackets, paths or links, become one calm sentence instead. So do
 * network failures and the moments ELUM is busy, such as during maintenance. Everything else,
 * the plain messages ELUM writes for people ("Enter a valid email address."), passes through.
 * The full detail still reaches the browser console and support codes; it is just not shown.
 */

export const GENERIC_ERROR = 'Something went wrong. Please try again.';
export const OFFLINE_ERROR = 'We could not reach ELUM. Check your connection and try again.';
export const BUSY_ERROR = 'ELUM is busy for a moment. Please try again shortly.';

const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|err_network|\boffline\b/i;
const BUSY = /\b50[234]\b|time(d)? ?out|too many connections|connection (refused|reset|terminated)|upstream|maintenance|temporarily unavailable|service unavailable|bad gateway/i;
const TECHNICAL = new RegExp(
  [
    'supabase', 'postgres', 'postgrest', 'pgrst', '\\bsql\\b', 'database', '\\bdb\\b', 'migration', 'readme',
    '\\brelation\\b', '\\bcolumn\\b', '\\bschema\\b', '\\bsyntax\\b', 'constraint', 'violates', 'duplicate key',
    'null value', '\\bjwt\\b', '\\brpc\\b', 'edge function', 'does not exist in', 'permission denied', 'row-level',
    '\\brls\\b', 'stack', '\\bundefined\\b', 'exception', 'typeerror', 'referenceerror', 'syntaxerror',
    'unexpected token', '\\bjson\\b', 'status code', 'deno', 'brevo', 'api key', 'secret',
    '[(){}\\[\\]<>]', '::', '\\b[a-z]+_[a-z0-9_]+\\b', '\\b(PT|P0|PG|22|23|42)[0-9A-Z]{3}\\b',
    'https?://', '\\w+\\.(sql|md|ts|js|tsx)\\b',
  ].join('|'),
  'i',
);

/** SQL written in capitals, as Postgres reports it: "UPDATE requires a WHERE clause". */
const SQL_WORDS = /\b(SELECT|INSERT|UPDATE|DELETE|WHERE|FROM|TABLE|INDEX|TRIGGER|FUNCTION|RETURNING|NULL)\b/;

/** A sentence that is safe and kind to show. `code` is an ApiError code, when there is one. */
export function friendly(message: string | null | undefined, code?: string): string {
  const m = (message ?? '').trim();
  if (code === 'network' || NETWORK.test(m)) return OFFLINE_ERROR;
  if (!m) return GENERIC_ERROR;
  if (BUSY.test(m)) return BUSY_ERROR;
  if (TECHNICAL.test(m) || SQL_WORDS.test(m)) return GENERIC_ERROR;
  return m;
}
