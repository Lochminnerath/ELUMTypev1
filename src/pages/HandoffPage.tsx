import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api, errorMessage } from '../api';
import { TypeMark } from '../components/Brand';
import { FullPageLoader } from '../components/Loader';

/**
 * /auth/handoff#token_hash=…&next=…: ELUM Account sent someone here signed in. The token works
 * once; it signs them in to Type and they land on `next` (a thread, the inbox).
 */
export function HandoffPage() {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const tokenHash = fragment.get('token_hash');
    const next = fragment.get('next') ?? '/';
    history.replaceState(null, '', window.location.pathname);
    if (!tokenHash) {
      setError('This sign-in link is not complete.');
      return;
    }
    api.completeHandoff(tokenHash).then(
      () => window.location.replace(next.startsWith('/') && !next.startsWith('//') ? next : '/'),
      (e) => setError(errorMessage(e)),
    );
  }, []);
  if (!error) return <FullPageLoader brand label="Signing you in" />;
  return (
    <div className="empty-state" style={{ minHeight: '100%', justifyContent: 'center' }}>
      <TypeMark size={72} />
      <h2>We could not sign you in</h2>
      <p>{error}</p>
      <Link to="/signin" className="elum-btn elum-btn--primary">
        Sign in
      </Link>
    </div>
  );
}
