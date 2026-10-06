import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, login as apiLogin, setSessionLostHandler, unwrap } from './api';
import { clearSession, readSession, writeCompany } from './session';

interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  organizationName: string;
  companies: Array<{ id: string; code: string; name: string }>;
}

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: SessionUser | null;
  companyId: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  selectCompany: (id: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    await clearSession();
    setUser(null);
    setCompanyId(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    // The API client drops to sign-in when a refresh finally fails.
    setSessionLostHandler(() => void signOut());

    (async () => {
      const stored = await readSession();
      if (!stored.refreshToken) return setStatus('signedOut');
      try {
        const me = unwrap(await api.auth.me());
        setUser(me as SessionUser);
        setCompanyId(stored.companyId ?? me.companies[0]?.id ?? null);
        setStatus('signedIn');
      } catch {
        setStatus('signedOut');
      }
    })();
  }, [signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    const profile = await apiLogin(email, password);
    const first = profile.companies[0]?.id ?? null;
    if (first) await writeCompany(first);
    const me = unwrap(await api.auth.me());
    setUser(me as SessionUser);
    setCompanyId(first);
    setStatus('signedIn');
  }, []);

  const selectCompany = useCallback(async (id: string) => {
    await writeCompany(id);
    setCompanyId(id);
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, companyId, signIn, signOut, selectCompany }}>
      {children}
    </AuthContext.Provider>
  );
}
