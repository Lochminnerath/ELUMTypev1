export type ApiErrorCode =
  | 'unauthorized'
  | 'invalid_credentials'
  | 'confirm_email'
  | 'email_taken'
  | 'invalid'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'too_large'
  | 'storage_full'
  | 'rate_limited'
  | 'network'
  | 'approval_required'
  | 'server';

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  invalid_credentials: 401,
  confirm_email: 202,
  email_taken: 409,
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_large: 413,
  storage_full: 507,
  rate_limited: 429,
  network: 0,
  approval_required: 403,
  server: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Extra data, such as the current version on a conflict. */
  readonly details?: Record<string, unknown>;

  constructor(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
    this.details = details;
  }
}

export function isApiError(error: unknown, code?: ApiErrorCode): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

/** A sentence that is safe to show to people. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}

/** What Supabase, PostgREST and edge functions put in their errors. */
export interface RawError {
  code?: string;
  message?: string;
  details?: string | null;
  status?: number;
  statusCode?: string | number;
  name?: string;
}

/**
 * Translates backend errors into the one ELUM vocabulary (handoff 5.2). Database functions
 * raise PT400/401/403/404/409/429 with messages already written for people.
 */
export function toApiError(error: RawError | null | undefined, fallback = 'Something went wrong. Please try again.'): ApiError {
  const code = String(error?.code ?? '');
  const status = Number(error?.status ?? error?.statusCode ?? 0);
  const message = error?.message ?? '';
  if (code === 'PT409') {
    const version = Number(error?.details);
    return new ApiError('conflict', message, Number.isFinite(version) ? { version } : undefined);
  }
  if (code === 'PT403') return new ApiError('forbidden', message);
  if (code === 'PT404') return new ApiError('not_found', message);
  if (code === 'PT400') return new ApiError('invalid', message);
  if (code === 'PT429' || status === 429) return new ApiError('rate_limited', message || 'Too many requests. Wait a little and try again.');
  if (code === 'PT401' || code === 'PGRST301' || code === 'PGRST303' || status === 401) {
    return new ApiError('unauthorized', 'Your session has ended. Sign in again.');
  }
  if (code === '42501' || status === 403) return new ApiError('forbidden', 'You do not have permission to do that.');
  if (code === 'PGRST116' || code === '22P02') return new ApiError('not_found', 'That does not exist or was deleted.');
  if (code === '23505') return new ApiError('invalid', 'That already exists.');
  if (code === '23514' || code === '23502') return new ApiError('invalid', 'Some of that is not allowed. Check it and try again.');
  if (status === 413 || /exceeded the maximum allowed size/i.test(message)) return new ApiError('too_large', 'Attachments can add up to 25 MB.');
  if (error?.name === 'AuthRetryableFetchError' || /failed to fetch|network/i.test(message)) {
    return new ApiError('network', 'We could not reach ELUM. Check your connection and try again.');
  }
  return new ApiError('server', fallback);
}
