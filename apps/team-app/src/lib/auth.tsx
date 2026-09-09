import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface Employee {
  id: string; full_name: string; email: string; role: string;
}
interface AuthState {
  session: Session | null;
  employee: Employee | null;
  loading: boolean;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthState>({ session: null, employee: null, loading: true, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadEmployee(s: Session | null) {
    if (!s) { setEmployee(null); return; }
    const { data } = await supabase
      .from('employees')
      .select('id, full_name, email, role')
      .eq('user_id', s.user.id)
      .maybeSingle();
    setEmployee(data as Employee | null);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      await loadEmployee(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      await loadEmployee(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); };

  return <Ctx.Provider value={{ session, employee, loading, signOut }}>{children}</Ctx.Provider>;
}
