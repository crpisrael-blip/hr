// תרגום שגיאות שרת להודעה בעברית שאפשר להציג למשתמש.
//
// פונקציות ה-RPC בסכמת app זורקות הודעות עברית מכוונות
// ("השיחה מושבתת", "סוג הקובץ אינו נתמך", "הקובץ גדול מהמותר"…).
// אלה ההודעות היחידות שמותר להציג כפי שהן. כל השאר — שגיאות Postgres
// גולמיות (invalid input syntax for type numeric…), שגיאות רשת ושגיאות
// PostgREST — מקבלות טקסט כללי, וההודעה המלאה נרשמת ל-console בלבד.

const HEB = /[֐-׿]/;
// סימנים שמעידים על הודעת מנוע ולא על הודעה שנכתבה עבור המשתמש.
const RAW = /(::|\bERROR\b|\bSQL\b|\bpg_|\bschema\b|invalid input syntax|violates|relation ")/i;

interface AnyErr { message?: string; code?: string; details?: string; hint?: string; status?: number; name?: string }

export function isNetworkError(err: unknown): boolean {
  const e = err as AnyErr | null;
  if (!e) return false;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const m = (e.message || '').toLowerCase();
  return e.name === 'TypeError' || m.includes('failed to fetch') || m.includes('networkerror') || m.includes('load failed');
}

/**
 * מחזיר הודעה בעברית להצגה למשתמש.
 * @param fallback טקסט ברירת המחדל כשאין הודעה בטוחה מהשרת.
 */
export function userMessage(err: unknown, fallback: string): string {
  const e = err as AnyErr | null;
  if (!e) return fallback;

  if (isNetworkError(e)) return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.';
  if (e.status === 429) return 'יותר מדי בקשות. נסו שוב בעוד דקה.';
  if (e.status === 401 || e.code === 'PGRST301') return 'פג תוקף ההתחברות. נא להיכנס מחדש.';
  if (e.code === '42501') return 'אין הרשאה לפעולה הזו.';
  if (e.code === '22P02' || e.code === '22003') return fallback; // cast/overflow — לעולם לא למשתמש

  const msg = (e.message || '').trim();
  // הודעה שנכתבה בעברית ע"י raise exception בפונקציות app — בטוחה להצגה.
  if (msg && msg.length <= 160 && HEB.test(msg) && !RAW.test(msg)) return msg;
  return fallback;
}

/** רישום מלא ל-console (developer message), בנפרד מההודעה למשתמש. */
export function logError(context: string, err: unknown): void {
  console.error(`[candidate-app] ${context}`, err);
}

/** קיצור נפוץ: לרשום ללוג ולהחזיר טקסט למשתמש. */
export function reportError(context: string, err: unknown, fallback: string): string {
  logError(context, err);
  return userMessage(err, fallback);
}
