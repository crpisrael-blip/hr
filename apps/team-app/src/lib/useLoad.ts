import { useCallback, useEffect, useState } from 'react';
import { toUserMessage } from './errors';

export interface LoadState<T> {
  data: T | null;
  err: string;
  loading: boolean;
  /** טעינה מחדש של אותם נתונים (אחרי שמירה/פעולה). */
  reload: () => void;
  /** עדכון מקומי של הנתונים בלי סיבוב לשרת. */
  setData: (updater: (prev: T | null) => T | null) => void;
}

/**
 * טעינת נתונים לדף פירוט, עם ביטול ואיפוס מצב בכל שינוי תלות.
 *
 * למה: `useEffect(() => { load(); }, [id])` משאיר את הנתונים והשגיאה של
 * הרשומה הקודמת על המסך, ותשובה איטית של רשומה ישנה יכולה לדרוס רשומה חדשה.
 *
 * @param fn פונקציה שמחזירה את כל נתוני המסך כאובייקט אחד
 * @param deps תלויות (כמו ב-useEffect) — לרוב [id]
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): LoadState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick(t => t + 1), []);
  const setData = useCallback((updater: (prev: T | null) => T | null) => setDataState(updater), []);

  useEffect(() => {
    let alive = true;
    // איפוס מלא: לא מציגים את הרשומה הקודמת ולא את השגיאה הקודמת.
    setDataState(null); setErr(''); setLoading(true);
    fn()
      .then(res => { if (alive) { setDataState(res); setLoading(false); } })
      .catch(e => { if (alive) { setErr(toUserMessage(e, 'טעינת הנתונים נכשלה.')); setLoading(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, err, loading, reload, setData };
}

/** זורק את שגיאת Supabase אם יש, ומחזיר את הנתונים — לשימוש בתוך useLoad. */
export function unwrap<T>(res: { data: T; error: unknown | null }): T {
  if (res.error) throw res.error;
  return res.data;
}
