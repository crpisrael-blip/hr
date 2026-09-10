import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // נזרק מוקדם כדי שלא נדבג "למה אין נתונים" בהמשך.
  console.error('חסרים VITE_SUPABASE_URL או VITE_SUPABASE_ANON_KEY');
}

// כל הישויות שלנו יושבות בסכמת app, לא public.
export const supabase = createClient(url, anon, {
  db: { schema: 'app' },
  auth: { persistSession: true, autoRefreshToken: true },
});

// לקוח לסכמת ברירת המחדל, לקריאות שאינן app (אם יידרש).
export const supabasePublic = createClient(url, anon);

// גישה לטבלאות בסכמת finance (השמות, חיובים, בונוסים) — משתף את אותו session.
export const fin = supabase.schema('finance');
