// מיפוי שגיאות מסד/רשת להודעה אחת בעברית. הפירוט הטכני נשאר בקונסול בלבד —
// טקסט Postgres גולמי באנגלית לעולם לא מגיע למשתמש.

export interface DbErrorShape {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number | null;
}

const BY_CODE: Record<string, string> = {
  '23505': 'הרשומה כבר קיימת במערכת (ערך כפול).',
  '23503': 'לא ניתן לבצע את הפעולה: קיימות רשומות מקושרות.',
  '23514': 'אחד הערכים שהוזנו אינו תקין.',
  '22P02': 'אחד הערכים שהוזנו אינו בפורמט הנכון.',
  '42501': 'אין לכם הרשאה לבצע פעולה זו.',
  '42883': 'הפעולה אינה זמינה עדיין בשרת. יש להריץ את מיגרציית המסד העדכנית.',
  'PGRST116': 'הרשומה לא נמצאה.',
  'PGRST201': 'שגיאת קישור בשאילתה. דווחו לצוות הפיתוח.',
  'PGRST202': 'הפעולה אינה זמינה עדיין בשרת. יש להריץ את מיגרציית המסד העדכנית.',
  'PGRST301': 'ההתחברות פגה. יש להיכנס מחדש.',
  '57014': 'הפעולה ארכה זמן רב מדי. נסו שוב.',
};

const NETWORK_MSG = 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.';

function isNetworkError(err: DbErrorShape): boolean {
  const m = (err.message ?? '').toLowerCase();
  return m.includes('failed to fetch') || m.includes('networkerror')
    || m.includes('load failed') || m.includes('network request failed')
    || err.message === 'TypeError: Failed to fetch';
}

/** האם השגיאה היא "ה-RPC לא קיים בשרת" (מיגרציה שטרם הורצה). */
export function isMissingRpc(err: unknown): boolean {
  const e = (err ?? {}) as DbErrorShape;
  const code = e.code ?? '';
  if (code === 'PGRST202' || code === '42883') return true;
  const m = (e.message ?? '').toLowerCase();
  return m.includes('could not find the function') || m.includes('does not exist');
}

/**
 * הודעה ידידותית בעברית לשגיאת Supabase/רשת.
 * @param err השגיאה כפי שהתקבלה (PostgrestError, AuthError, Error או unknown)
 * @param fallback טקסט ברירת מחדל כשאין התאמה
 */
export function toUserMessage(err: unknown, fallback = 'אירעה שגיאה. נסו שוב.'): string {
  if (!err) return fallback;
  const e = err as DbErrorShape;
  console.error('[hr] error:', err);

  if (isNetworkError(e)) return NETWORK_MSG;
  if (e.status === 401 || e.status === 403) return BY_CODE['42501'];
  if (e.status === 429) return 'יותר מדי בקשות. המתינו רגע ונסו שוב.';

  const code = e.code ?? '';
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (code.startsWith('23')) return 'הנתונים שהוזנו אינם עומדים בכללי המערכת.';
  if (code.startsWith('22')) return 'אחד הערכים שהוזנו אינו בפורמט הנכון.';
  return fallback;
}

/** הודעה ל-RPC שעדיין לא קיים בשרת, עם שם הפעולה בעברית. */
export function rpcUnavailable(actionLabel: string): string {
  return `${actionLabel} אינה זמינה עדיין: פעולת השרת חסרה במסד. יש להריץ את מיגרציית המסד העדכנית.`;
}

/** עוטף קריאת RPC: מחזיר הודעה ייעודית כשהפונקציה חסרה בשרת. */
export function rpcErrorMessage(err: unknown, actionLabel: string): string {
  if (isMissingRpc(err)) { console.error('[hr] missing rpc:', err); return rpcUnavailable(actionLabel); }
  return toUserMessage(err, `${actionLabel} נכשלה.`);
}
