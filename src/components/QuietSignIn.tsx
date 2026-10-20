import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { quietSignIn } from '../lib/elum';

/**
 * Signed out here but signed in to ELUM Account? Then Type signs you in too, without a
 * click: moving between ELUM apps never asks twice (see quietSignIn).
 */
export function QuietSignIn() {
  const { status } = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (status !== 'signed-out' || location.pathname.startsWith('/auth/')) return;
    quietSignIn(location.pathname + location.search);
    // Once, when the app learns it is signed out; the page they are on comes back with them.
  }, [status]);
  return null;
}
