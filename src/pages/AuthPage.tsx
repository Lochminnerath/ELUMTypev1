import { BadgeCheck, Eye, EyeOff, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, errorMessage, isApiError } from '../api';
import { handleProblem } from '../api/validation';
import { useAuth } from '../auth/AuthProvider';
import { useSafeNext } from '../auth/guards';
import { TypeLockup } from '../components/Brand';
import { Loader } from '../components/Loader';
import { ThemeToggle } from '../theme/ThemeToggle';
import './AuthPage.css';

type Mode = 'signin' | 'signup';
type Kind = 'type' | 'external';
type Field = 'name' | 'email' | 'handle' | 'password' | 'recoveryEmail' | 'login';
type HandleState = { kind: 'idle' } | { kind: 'checking' } | { kind: 'ok' } | { kind: 'bad'; message: string };

/**
 * Sign in and sign up, shared by every ELUM product (handoff 9.6). In Type, a new account gets an
 * ELUM address by default; people can sign up with their own email instead.
 */
export function AuthPage({ mode }: { mode: Mode }) {
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();
  const next = useSafeNext();
  const [kind, setKind] = useState<Kind>('type');
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [email, setEmail] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [handleState, setHandleState] = useState<HandleState>({ kind: 'idle' });
  const [error, setError] = useState<{ message: string; field?: Field; notice?: boolean } | null>(null);
  const isSignUp = mode === 'signup';
  const switchHref = `${isSignUp ? '/signin' : '/signup'}${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`;

  // Checked as you type (handoff 8.6): format here, availability on the server.
  useEffect(() => {
    if (!isSignUp || kind !== 'type' || !handle) {
      setHandleState({ kind: 'idle' });
      return;
    }
    const problem = handleProblem(handle);
    if (problem) {
      setHandleState({ kind: 'bad', message: problem });
      return;
    }
    setHandleState({ kind: 'checking' });
    let cancelled = false;
    const t = window.setTimeout(() => {
      api.handleAvailable(handle).then(
        (ok) => !cancelled && setHandleState(ok ? { kind: 'ok' } : { kind: 'bad', message: 'That name is taken.' }),
        () => !cancelled && setHandleState({ kind: 'idle' }),
      );
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [handle, kind, isSignUp]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (isSignUp && kind === 'type' && handleState.kind === 'bad') {
      setError({ message: handleState.message, field: 'handle' });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!isSignUp) await signIn({ login, password });
      else if (kind === 'type') await signUp({ kind: 'type', handle, name, password, recoveryEmail: recovery || undefined });
      else await signUp({ kind: 'external', name, email, password });
      if (/^https:/.test(next)) window.location.assign(next);
      else navigate(next, { replace: true });
    } catch (err) {
      const field = isApiError(err) ? (err.details?.field as Field | undefined) : undefined;
      setError({ message: errorMessage(err), field, notice: isApiError(err, 'confirm_email') });
      setBusy(false);
    }
  };

  const invalid = (field: Field) => (error?.field === field ? true : undefined);

  return (
    <div className="auth">
      <aside className="auth__art" aria-hidden="true">
        <div className="auth__glow" />
        <div className="auth__discs">
          <span className="auth__disc auth__disc--a" />
          <span className="auth__disc auth__disc--b" />
          <span className="auth__disc auth__disc--c" />
          <span className="auth__lens auth__lens--ab" />
          <span className="auth__lens auth__lens--bc" />
        </div>
        <div className="auth__art-copy">
          <p className="label muted">Built by people. Runs without AI.</p>
          <p className="auth__tagline">Messages and email, in one calm inbox.</p>
        </div>
      </aside>

      <main className="auth__main">
        <div className="auth__top">
          <TypeLockup height={32} />
          <ThemeToggle />
        </div>

        <form className="auth__form" onSubmit={submit} noValidate>
          <h1 className="auth__title">{isSignUp ? 'Create your account' : 'Welcome back'}</h1>
          <p className="auth__subtitle muted">{isSignUp ? 'One ELUM account for Type, Write and the rest.' : 'Sign in with your ELUM address or email.'}</p>

          {isSignUp && (
            <fieldset className="account-type">
              <legend className="field-label">Account</legend>
              <label className="account-type__option">
                <input type="radio" name="account-type" value="type" checked={kind === 'type'} onChange={() => setKind('type')} />
                <span>
                  <span className="account-type__title">Get an ELUM address</span>
                  <span className="account-type__hint muted">A new address on {api.typeDomain}. Email anyone; shares arrive in your inbox.</span>
                </span>
              </label>
              <label className="account-type__option">
                <input type="radio" name="account-type" value="external" checked={kind === 'external'} onChange={() => setKind('external')} />
                <span>
                  <span className="account-type__title">Use my email</span>
                  <span className="account-type__hint muted">Sign in with Gmail, Outlook or any address. Message ELUM people in Type.</span>
                </span>
              </label>
            </fieldset>
          )}

          {isSignUp && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" className="input" autoComplete="name" value={name} maxLength={80} aria-invalid={invalid('name')} onChange={(e) => setName(e.target.value)} autoFocus required />
            </div>
          )}

          {isSignUp && kind === 'type' && (
            <div className="field">
              <label htmlFor="handle">Your address</label>
              <div className="handle-input" data-state={handleState.kind}>
                <input
                  id="handle"
                  className="input"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={handle}
                  maxLength={30}
                  aria-invalid={handleState.kind === 'bad' || invalid('handle')}
                  aria-describedby="handle-status"
                  onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/\s/g, ''))}
                  required
                />
                <span className="handle-input__domain">@{api.typeDomain}</span>
              </div>
              <span id="handle-status" className="handle-status" aria-live="polite" data-state={handleState.kind}>
                {handleState.kind === 'checking' && <Loader size={14} brand label="Checking" />}
                {handleState.kind === 'ok' && (
                  <>
                    <BadgeCheck size={14} strokeWidth={2} aria-hidden="true" /> {handle}@{api.typeDomain} is yours to take.
                  </>
                )}
                {handleState.kind === 'bad' && handleState.message}
                {handleState.kind === 'idle' && '3 to 30 letters, numbers, dots, dashes or underscores. Addresses are permanent.'}
              </span>
            </div>
          )}

          {isSignUp && kind === 'external' && (
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={email} aria-invalid={invalid('email')} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          )}

          {!isSignUp && (
            <div className="field">
              <label htmlFor="login">ELUM address or email</label>
              <input
                id="login"
                className="input"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={`name or name@${api.typeDomain}`}
                value={login}
                aria-invalid={invalid('login')}
                onChange={(e) => setLogin(e.target.value)}
                autoFocus
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="password">Password</label>
            <div className="auth__password">
              <input
                id="password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                value={password}
                aria-invalid={invalid('password')}
                aria-describedby={isSignUp ? 'password-hint' : undefined}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="icon-btn auth__reveal"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? <EyeOff size={18} strokeWidth={1.75} /> : <Eye size={18} strokeWidth={1.75} />}
              </button>
            </div>
            {isSignUp && (
              <span id="password-hint" className="muted auth__hint">
                At least 8 characters.
              </span>
            )}
          </div>

          {isSignUp && kind === 'type' && (
            <div className="field">
              <label htmlFor="recovery">Recovery email (optional)</label>
              <input
                id="recovery"
                className="input"
                type="email"
                autoComplete="email"
                inputMode="email"
                value={recovery}
                aria-invalid={invalid('recoveryEmail')}
                aria-describedby="recovery-hint"
                onChange={(e) => setRecovery(e.target.value)}
              />
              <span id="recovery-hint" className="auth__warning" data-empty={!recovery || undefined}>
                <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
                {recovery
                  ? 'We will send a code to confirm it. It is how you get back in if you forget your password.'
                  : 'Without one, nobody can recover your account if you forget your password, not even us.'}
              </span>
            </div>
          )}

          {error && (
            <p className={error.notice ? 'auth__notice' : 'auth__error'} role={error.notice ? 'status' : 'alert'}>
              {error.message}
            </p>
          )}

          <button type="submit" className="elum-btn elum-btn--primary elum-btn--block auth__submit" disabled={busy}>
            {busy ? <Loader size={20} brand label={isSignUp ? 'Creating your account' : 'Signing in'} /> : isSignUp ? 'Create account' : 'Sign in'}
          </button>

          <p className="auth__switch">
            {isSignUp ? 'Already have an ELUM account?' : 'New to ELUM?'} <Link to={switchHref}>{isSignUp ? 'Sign in' : 'Create an account'}</Link>
          </p>

          {api.mode === 'local' && (
            <p className="auth__local muted">
              Preview mode: accounts and messages are kept in this browser until ELUM is connected. Create two accounts to message between them.
            </p>
          )}
        </form>
      </main>
    </div>
  );
}
