import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { toUserMessage } from './errors';

export interface Employee {
  id: string; full_name: string; email: string; role: string; employment_status: string;
}

/** למה אין לנו עובד פעיל: כל מקרה מקבל הסבר אחר במסך. */
export type LinkState = 'ok' | 'none' | 'suspended' | 'error';

interface AuthState {
  session: Session | null;
  employee: Employee | null;
  /** מצב הקישור בין חשבון ה-Auth לרשומת העובד. */
  linkState: LinkState;
  /** הודעת השגיאה כשהטעינה נכשלה (רשת/הרשאה). */
  linkError: string;
  loading: boolean;
  signOut: () => Promise<void>;
  refreshEmployee: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  session: null, employee: null, linkState: 'none', linkError: '', loading: true,
  signOut: async () => {}, refreshEmployee: async () => {},
});
export const useAuth = () => useContext(Ctx);

/** האם לעובד יש סמכות ניהול (מנהלת/מנהל על). מקור יחיד — היה משוכפל בחמישה מסכים. */
export const isManager = (e?: Employee | null) => e?.role === 'manager' || e?.role === 'superadmin';
export const isSuperadmin = (e?: Employee | null) => e?.role === 'superadmin';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [linkState, setLinkState] = useState<LinkState>('none');
  const [linkError, setLinkError] = useState('');
  const [loading, setLoading] = useState(true);
  const lastUid = useRef<string | null>(null);

  const loadEmployee = useCallback(async (s: Session | null) => {
    if (!s) { setEmployee(null); setLinkState('none'); setLinkError(''); return; }
    const { data, error } = await supabase
      .from('employees')
      .select('id, full_name, email, role, employment_status')
      .eq('user_id', s.user.id)
      .maybeSingle();
    if (error) {
      // כשל רשת או דחיית RLS — לא אותו דבר כמו "אין רשומת עובד".
      setEmployee(null); setLinkState('error');
      setLinkError(toUserMessage(error, 'טעינת פרטי העובד נכשלה.'));
      return;
    }
    setLinkError('');
    const emp = (data as Employee | null) ?? null;
    if (!emp) { setEmployee(null); setLinkState('none'); return; }
    if (emp.employment_status !== 'active') { setEmployee(null); setLinkState('suspended'); return; }
    setEmployee(emp); setLinkState('ok');
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      lastUid.current = data.session?.user.id ?? null;
      await loadEmployee(data.session);
      if (alive) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      if (!alive) return;
      setSession(s);
      // רענון טוקן שעתי מגיע עם אותו user — אין צורך לשלוף שוב ולפרק את עץ הדפים.
      const uid = s?.user.id ?? null;
      if (uid && uid === lastUid.current) return;
      lastUid.current = uid;
      await loadEmployee(s);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadEmployee]);

  const signOut = async () => { await supabase.auth.signOut(); };
  const refreshEmployee = async () => { await loadEmployee(session); };

  return (
    <Ctx.Provider value={{ session, employee, linkState, linkError, loading, signOut, refreshEmployee }}>
      {children}
    </Ctx.Provider>
  );
}
