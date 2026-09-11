import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { reportError } from './errors';

// מצב הקישור לרשומת מועמד:
//  loading  – בבדיקה
//  linked   – קיים פרופיל מועמד מקושר
//  unlinked – מחובר ל-Auth אך אין רשומת מועמד (עדיין לא הגיש למשרה)
//  error    – בדיקת הקישור נכשלה (רשת/שרת) — שונה מ-unlinked!
export type LinkState = 'loading' | 'linked' | 'unlinked' | 'error';

interface AuthState {
  session: Session | null;
  link: LinkState;
  /** מזהה המועמד שהוחזר מ-claim_candidate_profile — חוסך קריאת my_profile. */
  candidateId: string | null;
  linkError: string;
  loading: boolean;
  refresh: () => Promise<LinkState>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  session: null, link: 'loading', candidateId: null, linkError: '', loading: true,
  refresh: async () => 'loading', signOut: async () => {},
});
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [link, setLink] = useState<LinkState>('loading');
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [linkError, setLinkError] = useState('');
  const [loading, setLoading] = useState(true);

  // ה-uid שכבר נבדק. רענון טוקן (TOKEN_REFRESHED, בערך כל שעה) ו-INITIAL_SESSION
  // מחזירים את אותו uid — ואז אין מה לבדוק מחדש. בלי זה כל אירוע auth היה מחזיר
  // את הדף ל-loading, מפרק את עץ הקומפוננטות ומוחק קלט שהמשתמש הקליד.
  const lastUid = useRef<string | null>(null);
  const linkRef = useRef<LinkState>('loading');
  const sessionRef = useRef<Session | null>(null);
  const alive = useRef(true);

  const apply = useCallback((s: LinkState) => {
    linkRef.current = s;
    if (alive.current) setLink(s);
  }, []);

  const claim = useCallback(async (s: Session | null, force = false): Promise<LinkState> => {
    if (!s) {
      lastUid.current = null;
      setCandidateId(null);
      setLinkError('');
      apply('loading');
      return 'loading';
    }
    // אותו משתמש ומצב שכבר הוכרע — לא נוגעים ב-UI.
    if (!force && lastUid.current === s.user.id && linkRef.current !== 'loading') {
      return linkRef.current;
    }
    lastUid.current = s.user.id;
    // אין חזרה ל-loading אחרי שכבר קושר: הרענון קורה ברקע.
    if (linkRef.current !== 'linked') apply('loading');

    const { data, error } = await supabase.rpc('claim_candidate_profile');
    if (error) {
      setLinkError(reportError('claim_candidate_profile', error, 'בדיקת הקישור לחשבון נכשלה.'));
      // אם כבר היינו מקושרים — לא מורידים את המשתמש מהאזור האישי בגלל תקלת רשת.
      if (linkRef.current === 'linked') return 'linked';
      apply('error');
      return 'error';
    }
    setLinkError('');
    const id = typeof data === 'string' && data ? data : null;
    if (alive.current) setCandidateId(id);
    const next: LinkState = id ? 'linked' : 'unlinked';
    apply(next);
    return next;
  }, [apply]);

  useEffect(() => {
    alive.current = true;
    supabase.auth.getSession().then(async ({ data }) => {
      sessionRef.current = data.session;
      if (alive.current) setSession(data.session);
      await claim(data.session);
      if (alive.current) setLoading(false);
    }).catch(err => {
      reportError('getSession', err, '');
      if (alive.current) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      sessionRef.current = s;
      if (alive.current) setSession(s);
      // דחייה למיקרו-משימה: קריאה ל-supabase מתוך ה-callback עצמו עלולה לנעול.
      setTimeout(() => { void claim(s); }, 0);
    });
    return () => { alive.current = false; sub.subscription.unsubscribe(); };
  }, [claim]);

  const refresh = useCallback(() => claim(sessionRef.current, true), [claim]);
  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) reportError('signOut', error, '');
    lastUid.current = null;
    setCandidateId(null);
  }, []);

  return (
    <Ctx.Provider value={{ session, link, candidateId, linkError, loading, refresh, signOut }}>
      {children}
    </Ctx.Provider>
  );
}
