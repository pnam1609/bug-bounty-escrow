'use client';

import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { readPublicConfig } from '@/config/public-config';

interface AuthContextValue {
  readonly client: SupabaseClient | null;
  readonly error: string | null;
  /** Reads the provider's actual local session instead of relying on a render-time snapshot. */
  readonly getSession: () => Promise<Session | null>;
  readonly loading: boolean;
  readonly session: Session | null;
  readonly signIn: (email: string, password: string) => Promise<void>;
  readonly signOut: () => Promise<void>;
  readonly signUp: (email: string, password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const config = readPublicConfig();
      const nextClient = createClient(
        config.NEXT_PUBLIC_SUPABASE_URL,
        config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { detectSessionInUrl: true, persistSession: true } },
      );
      setClient(nextClient);
      void nextClient.auth.getSession().then(({ data }) => {
        setSession(data.session);
        setLoading(false);
      });
      const { data } = nextClient.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        setLoading(false);
      });

      return () => data.subscription.unsubscribe();
    } catch {
      setError('Public application configuration is unavailable');
      setLoading(false);
      return undefined;
    }
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (client === null) throw new Error('Authentication is unavailable');
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError !== null) throw signInError;
    },
    [client],
  );
  const signUp = useCallback(
    async (email: string, password: string) => {
      if (client === null) throw new Error('Authentication is unavailable');
      const { error: signUpError } = await client.auth.signUp({ email, password });
      if (signUpError !== null) throw signUpError;
    },
    [client],
  );
  const getSession = useCallback(async () => {
    if (client === null) return session;
    const { data, error: sessionError } = await client.auth.getSession();
    if (sessionError !== null) throw sessionError;
    return data.session;
  }, [client, session]);
  const signOut = useCallback(async () => {
    if (client === null) return;
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError !== null) throw signOutError;
  }, [client]);

  const value = useMemo(
    () => ({ client, error, getSession, loading, session, signIn, signOut, signUp }),
    [client, error, getSession, loading, session, signIn, signOut, signUp],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be inside AuthProvider');
  return context;
}
