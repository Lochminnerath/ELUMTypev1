import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, isApiError, type SignInInput, type SignUpInput, type User } from '../api';

/** 'approval': signed in with a password, waiting for another device to approve (ELUM Account > Security). */
type Status = 'loading' | 'signed-in' | 'signed-out' | 'approval';

interface AuthContextValue {
  status: Status;
  user: User | null;
  signIn: (input: SignInInput) => Promise<User>;
  signUp: (input: SignUpInput) => Promise<User>;
  signOut: () => Promise<void>;
  updateName: (name: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<User | null>(null);

  const restore = useCallback(async () => {
    try {
      const session = await api.restoreSession();
      setUser(session?.user ?? null);
      setStatus(session ? 'signed-in' : 'signed-out');
    } catch (e) {
      setUser(null);
      setStatus(isApiError(e, 'approval_required') ? 'approval' : 'signed-out');
    }
  }, []);

  useEffect(() => {
    void restore();
    const off = api.onUnauthorized(() => {
      setUser(null);
      setStatus('signed-out');
    });
    // Signing in or out in another tab (preview mode) applies here too.
    const onStorage = (e: StorageEvent) => e.key === 'elum.type.preview.session' && void restore();
    window.addEventListener('storage', onStorage);
    return () => {
      off();
      window.removeEventListener('storage', onStorage);
    };
  }, [restore]);

  const signIn = useCallback(async (input: SignInInput) => {
    const session = await api.signIn(input).catch((e: unknown) => {
      if (isApiError(e, 'approval_required')) setStatus('approval');
      throw e;
    });
    setUser(session.user);
    setStatus('signed-in');
    return session.user;
  }, []);

  const signUp = useCallback(async (input: SignUpInput) => {
    const session = await api.signUp(input);
    setUser(session.user);
    setStatus('signed-in');
    return session.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.signOut();
    } finally {
      setUser(null);
      setStatus('signed-out');
    }
  }, []);

  const updateName = useCallback(async (name: string) => {
    setUser(await api.updateName(name));
  }, []);

  const value = useMemo(() => ({ status, user, signIn, signUp, signOut, updateName }), [status, user, signIn, signUp, signOut, updateName]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For pages behind sign-in: the user is always present. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called while signed out');
  return user;
}
