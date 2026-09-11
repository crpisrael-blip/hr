// מודול משותף מקומי לאזור האישי.
// שלושת העזרים כאן (נרמול טלפון + פורמטים ישראליים) מופיעים גם ב-apps/team-app
// ובפונקציות ה-DB. כשייווצר workspace בשם packages/@hr/shared — זהו הקובץ
// שאמור לעבור לשם. בינתיים: מקור אמת יחיד בתוך האפליקציה הזו בלבד.

// נרמול טלפון ישראלי ל-E.164. חייב להישאר תואם ל-app.normalize_phone
// (supabase/migrations/0011_candidate_area.sql:7-18) — זהו מפתח ההתאמה
// שבו claim_candidate_profile מקשר חשבון Auth לרשומת מועמד.
export function normPhone(raw: string): string {
  const d = raw.replace(/[^\d+]/g, '');
  if (d === '') return '';
  if (d.startsWith('+972')) return '+972' + d.slice(4).replace(/^0/, '');
  if (d.startsWith('972')) return '+972' + d.slice(3).replace(/^0/, '');
  if (d.startsWith('0')) return '+972' + d.slice(1);
  return d;
}

// אותה בדיקה שמבצע app.normalize_phone אחרי הנרמול
// (supabase/migrations/0022_security_hardening.sql:598-617):
// ישראלי — +972 ואחריו ספרה 2-9 ועוד 7-8 ספרות; אחר — E.164 בינלאומי.
// מספר שלא עובר אותה מוחזר NULL מהשרת, כלומר לא יתאים לשום רשומת מועמד.
const IL_PHONE = /^\+972[2-9]\d{7,8}$/;
const INTL_PHONE = /^\+[1-9]\d{7,14}$/;

export function isValidPhone(raw: string): boolean {
  const n = normPhone(raw);
  if (!n) return false;
  return n.startsWith('+972') ? IL_PHONE.test(n) : INTL_PHONE.test(n);
}

export function isLikelyEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(raw.trim());
}

// ---- פורמטים ישראליים: DD/MM/YYYY ושעון 24 ----
const dateFmt = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit', month: '2-digit', year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat('he-IL', {
  day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const parse = (v?: string | null): Date | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const fmtDate = (v?: string | null): string => {
  const d = parse(v);
  return d ? dateFmt.format(d) : '';
};

export const fmtDateTime = (v?: string | null): string => {
  const d = parse(v);
  return d ? dateTimeFmt.format(d) : '';
};

// ערך ל-<time dateTime> — ISO תקני, או מחרוזת ריקה כשאין תאריך.
export const isoAttr = (v?: string | null): string | undefined => {
  const d = parse(v);
  return d ? d.toISOString() : undefined;
};

export const fmtSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} ב׳`
    : bytes < 1048576 ? `${(bytes / 1024).toFixed(0)} ק״ב`
      : `${(bytes / 1048576).toFixed(1)} מ״ב`;
