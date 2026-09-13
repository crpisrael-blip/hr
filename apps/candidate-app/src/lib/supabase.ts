import { createClient } from '@supabase/supabase-js';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

/** האם התצורה הושלמה. כשזה false — App מציג מסך "תצורה חסרה" במקום מסך לבן. */
export const envReady = Boolean(url && anon);
if (!envReady) {
  console.error('[candidate-app] חסרים VITE_SUPABASE_URL או VITE_SUPABASE_ANON_KEY');
}

// כל הפעולות עוברות דרך פונקציות RPC בסכמת app (אין למועמד גישת טבלה).
// כתובת ה-placeholder מונעת זריקה מ-createClient כשה-ENV חסר; המסך החוסם
// ב-App מבטיח שלא תישלח בקשה בפועל.
export const supabase = createClient(url || 'https://missing.invalid', anon || 'missing', {
  db: { schema: 'app' },
  auth: { persistSession: true, autoRefreshToken: true },
});

/** דלי המסמכים הפרטי של המועמד. */
export const DOCS_BUCKET = 'candidate-docs';

// חייב להישאר תואם ל-app.settings: files.allowed_mime / files.max_size_mb
// (supabase/migrations/0006_seed_settings.sql:8-9). add_my_document דוחה כל
// חריגה — הבדיקה כאן היא רק כדי לא להעלות ל-Storage קובץ שממילא יידחה.
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const ALLOWED_UPLOAD_MIME = ['application/pdf', DOCX_MIME] as const;
export const ALLOWED_UPLOAD_EXT = ['.pdf', '.docx'] as const;
export const MAX_UPLOAD_MB = 10;
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

/**
 * כניסה ב-OTP לטלפון דורשת ספק SMS מוגדר ב-Supabase (אופציונלי, ראו docs/DEPLOY.md).
 * ללא VITE_PHONE_OTP=1 הלשונית לא מוצגת כדי שלא ייכשלו בלי הסבר.
 */
export const PHONE_OTP_ENABLED = String(import.meta.env.VITE_PHONE_OTP ?? '') === '1';
