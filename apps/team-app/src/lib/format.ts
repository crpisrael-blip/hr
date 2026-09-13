// עיצוב ערכים ותוויות בעברית — מקור אמת יחיד. אין לשכפל טבלאות תוויות במסכים.

const DATE_FMT = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit', month: '2-digit', year: 'numeric', numberingSystem: 'latn',
});

/**
 * תאריך בפורמט DD/MM/YYYY לפי האפיון.
 * מחזיר "—" גם לערך ריק וגם למחרוזת לא תקינה — Intl זורק RangeError על Invalid Date.
 */
export function formatDate(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) { console.error('[hr] תאריך לא תקין:', v); return '—'; }
  // he-IL מפיק נקודות (11.09.2026); האפיון מבקש 11/09/2026.
  return DATE_FMT.format(d).replace(/\./g, '/');
}

/** תאריך ושעה קצרים, לרשימות ראיונות ומשימות. */
export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) { console.error('[hr] תאריך לא תקין:', v); return '—'; }
  return `${formatDate(d)} ${new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)}`;
}

/**
 * סכום כספי. ברירת המחדל 2 ספרות — עמודות הכסף הן numeric(14,2),
 * ועיגול לשקלים שלמים גורם לשורות חשבונית שלא מסתכמות לסך.
 */
export function money(v: number | string | null | undefined, currency = 'ILS', decimals = 2): string {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('he-IL', {
    style: 'currency', currency: currency || 'ILS',
    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(n);
}

/** סכום ללא אגורות — לתצוגות סיכום בלבד (אריחים, כותרות). */
export const moneyRound = (v: number | string | null | undefined, currency = 'ILS') => money(v, currency, 0);

/** גודל קובץ בעברית. */
export const fmtSize = (b?: number | null): string =>
  b == null ? '' : b < 1048576 ? `${(b / 1024).toFixed(0)} ק״ב` : `${(b / 1048576).toFixed(1)} מ״ב`;

/** ראשי תיבות לאווטאר — מקור יחיד (היה משוכפל בשלוש גרסאות שונות). */
export function initials(name?: string | null): string {
  if (!name) return '·';
  const parts = name.split(' ').filter(Boolean).slice(0, 2);
  return parts.map(w => [...w][0]).join('') || '·';
}

/** מחזיר URL בטוח להצגה כ-href, או null. חוסם javascript:/data: ודומיהם. */
export function safeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(v) ? v : 'https://' + v);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
  } catch { return null; }
}

export function slugify(title: string): string {
  const base = title.trim().toLowerCase()
    .replace(/["'׳״]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${base || 'job'}-${rand}`;
}

/** שם קובץ בטוח לנתיב אחסון (Storage לא מקבל תווים לא-ASCII/רווחים). */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'file';
  return ext ? `${stem}.${ext}` : stem;
}

// ---------- תוויות ----------
export const COMPANY_STATUS: Record<string, string> = {
  lead: 'ליד', active: 'פעילה', on_hold: 'בהמתנה', inactive: 'לא פעילה',
};
export const JOB_STAGE: Record<string, string> = {
  draft: 'טיוטה', open: 'פתוחה', on_hold: 'בהמתנה', filled: 'אוישה', closed: 'סגורה',
};
export const APP_STAGE: Record<string, string> = {
  new: 'חדש', screening: 'בבדיקה', initial_call: 'שיחה ראשונית',
  submitted_to_client: 'הוגש ללקוח', interview: 'ראיון', offer: 'הצעה', hired: 'התקבל',
  rejected: 'נדחה', withdrawn: 'הסיר מועמדות', job_cancelled: 'משרה בוטלה',
};
export const SCOPE: Record<string, string> = {
  full_time: 'מלאה', part_time: 'חלקית', temporary: 'זמני', contract: 'חוזה', student: 'סטודנט',
};
export const COMMISSION_BASE: Record<string, string> = { monthly: 'חודשי', annual: 'שנתי' };
export const PLACEMENT_STATUS: Record<string, string> = {
  pending_start: 'ממתין לתחילת עבודה', working_warranty: 'בתקופת אחריות', approved: 'מאושרת',
  not_started: 'לא התחיל', left_in_warranty: 'עזב בתקופת האחריות', cancelled: 'בוטלה',
};
export const INVOICE_STATUS: Record<string, string> = {
  planned: 'מתוכנן', issued: 'הופק', partially_paid: 'שולם חלקית', paid: 'שולם', cancelled: 'בוטל', credited: 'זוכה',
};

// תפקידים וסטטוס העסקה — היו משוכפלים בארבעה מסכים עם תוויות שונות.
export const ROLE: Record<string, string> = {
  recruiter: 'מגייס', manager: 'מנהלת החברה', superadmin: 'מנהל על',
};
/** תפקידים שניתן לבחור במסכי הניהול. superadmin מוקצה רק במסד. */
export const ASSIGNABLE_ROLES = ['recruiter', 'manager'] as const;
export const EMP_STATUS: Record<string, string> = { active: 'פעיל', suspended: 'מושבת', ended: 'סיים' };

export const TASK_PRIORITY: Record<string, string> = {
  low: 'נמוכה', normal: 'רגילה', high: 'גבוהה', urgent: 'דחוף',
};
export const TASK_STATUS: Record<string, string> = {
  open: 'לביצוע', in_progress: 'בעבודה', done: 'הושלמה', cancelled: 'בוטלה',
};
export const ASSIGNEE_STATUS: Record<string, string> = {
  pending: 'ממתין', in_progress: 'בעבודה', done: 'בוצע', removed: 'הוסר',
};
export const TASK_COMPLETION: Record<string, string> = {
  all_assignees: 'כל האחראים צריכים לבצע', any_assignee: 'אחראי אחד מספיק',
};

export const FORM_STATUS: Record<string, string> = {
  created: 'נוצר', sent: 'נשלח', opened: 'נפתח', started: 'במילוי', completed: 'הושלם',
};
export const TEMPLATE_STATUS: Record<string, string> = { draft: 'טיוטה', active: 'פעיל', archived: 'ארכיון' };

export const CANDIDATE_DOC_KIND: Record<string, string> = {
  cv: 'קורות חיים', cover_letter: 'מכתב מקדים', certificate: 'תעודה',
  summary: 'סיכום', submission_pack: 'ערכת הגשה', other: 'מסמך',
};
export const EMPLOYEE_DOC_KIND: Record<string, string> = {
  contract: 'חוזה', certificate: 'תעודה', id: 'תעודת זהות', resume: 'קורות חיים', other: 'מסמך',
};

export const BONUS_METRIC: Record<string, string> = {
  placements_count: 'מספר השמות', commission_sum: 'סכום עמלות',
};
export const BONUS_STATUS: Record<string, string> = {
  draft: 'טיוטה', review: 'לבדיקה', approved: 'מאושר', paid: 'שולם',
};
export const CLAWBACK_TREATMENT: { value: string; label: string }[] = [
  { value: 'offset', label: 'קיזוז מהבונוס הבא' },
  { value: 'spread', label: 'פריסה על פני חודשים' },
  { value: 'deferred', label: 'דחייה למועד' },
  { value: 'none', label: 'ללא קיזוז' },
];

/** תווית עם נפילה לערך הגולמי, כדי שלא יופיע ריק כשהמסד מקדים את ה-UI. */
export const label = (map: Record<string, string>, key?: string | null) =>
  (key && map[key]) || key || '—';
