import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  console.error('חסרים VITE_SUPABASE_URL או VITE_SUPABASE_ANON_KEY');
}

// כל הפעולות עוברות דרך פונקציות RPC בסכמת app (אין למועמד גישת טבלה).
export const supabase = createClient(url, anon, {
  db: { schema: 'app' },
  auth: { persistSession: true, autoRefreshToken: true },
});

// דלי המסמכים הפרטי של המועמד.
export const DOCS_BUCKET = 'candidate-docs';
