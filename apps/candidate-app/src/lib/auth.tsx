import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

// מצב הקישור לרשומת מועמד:
//  loading  – בבדיקה
//  linked   – קיים פרופיל מועמד מקושר
//  unlinked – מחובר ל-Auth אך אין רשומת מועמד (עדיין לא הגיש למשרה)
export type LinkState = 'loading' | 'linked' | 'unlinked';

interface AuthState {
  session: Session | null;
  link: LinkState;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  session: null, link: 'loading', loading: true,
  refresh: async () => {}, signOut: async () => {},
});
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [link, setLink] = useState<LinkState>('loading');
  const [loading, setLoading] = useState(true);

  // בכניסה מנסים לקשר את החשבון לרשומת מועמד קיימת (לפי טלפון/דוא"ל).
  async function claim(s: Session | null) {
    if (!s) { setLink('loading'); return; }
    setLink('loading');
    const { data, error } = await supabase.rpc('claim_candidate_profile');
    if (error) { console.error(error); setLink('unlinked'); return; }
    setLink(data ? 'linked' : 'unlinked');
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await claim(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      await claim(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const refresh = async () => { await claim(session); };
  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <Ctx.Provider value={{ session, link, loading, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
}
