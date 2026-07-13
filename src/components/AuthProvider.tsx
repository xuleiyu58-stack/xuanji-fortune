"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getSupabaseAuth } from "@/lib/supabase";
import type { User, Session } from "@supabase/supabase-js";

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthState>({
  user: null, session: null, loading: true,
  signUp: async () => ({ error: "未初始化" }),
  signIn: async () => ({ error: "未初始化" }),
  signOut: async () => {},
  isConfigured: false,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const isConfigured = !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  useEffect(() => {
    const auth = getSupabaseAuth();
    if (!auth) { setLoading(false); return; }
    auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });
    const { data: { subscription } } = auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const auth = getSupabaseAuth();
    if (!auth) return { error: "系统未配置，请联系管理员" };
    const { error } = await auth.signUp({ email, password });
    return { error: error?.message || null };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const auth = getSupabaseAuth();
    if (!auth) return { error: "系统未配置，请联系管理员" };
    const { error } = await auth.signInWithPassword({ email, password });
    return { error: error?.message || null };
  }, []);

  const signOut = useCallback(async () => {
    const auth = getSupabaseAuth();
    if (auth) await auth.signOut();
    setUser(null); setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, session, loading, signUp, signIn, signOut, isConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
