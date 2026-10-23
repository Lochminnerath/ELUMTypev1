import type { ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';
import { safeNext } from '../api/validation';
import { FullPageLoader } from '../components/Loader';
import { accountsSignIn, signInThroughAccount } from '../lib/elum';
import { useAuth } from './AuthProvider';

/** Sends signed-out visitors to sign in, then brings them back. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') return <FullPageLoader brand />;
  // Waiting for another device to approve: the approval screen covers everything.
  if (status === 'approval') return null;
  if (status === 'signed-out') {
    const next = location.pathname + location.search;
    // One sign-in for every ELUM app: ELUM Account sends people straight back, signed in.
    if (accountsSignIn && signInThroughAccount(next, true)) return <FullPageLoader brand label="Signing you in" />;
    return <Navigate to={next === '/' ? '/signin' : `/signin?next=${encodeURIComponent(next)}`} replace />;
  }
  return <>{children}</>;
}

/** Sign-in and sign-up pages: skip them when already signed in. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const next = useSafeNext();
  if (status === 'loading') return <FullPageLoader brand />;
  if (status === 'signed-in') {
    if (/^https:/.test(next)) {
      window.location.assign(next);
      return <FullPageLoader brand />;
    }
    return <Navigate to={next} replace />;
  }
  return <>{children}</>;
}

/** The `next` query parameter: a path here, or an https URL on the ELUM family domain. */
export function useSafeNext(): string {
  const [params] = useSearchParams();
  return safeNext(params.get('next'));
}
