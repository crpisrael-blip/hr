import fixtures from './fixtures/jobs.json';

export type EmploymentScope =
  | 'full_time' | 'part_time' | 'temporary' | 'contract' | 'student';

export interface Job {
  slug: string;
  title: string;
  body: string;
  location: string | null;
  employment_scope: EmploymentScope | null;
  company_name: string | null;
  published_at: string;
}

export const SCOPE_LABEL: Record<EmploymentScope, string> = {
  full_time: 'משרה מלאה',
  part_time: 'משרה חלקית',
  temporary: 'זמני',
  contract: 'חוזה',
  student: 'משרת סטודנט',
};

/** ערכי schema.org/JobPosting תקניים. לא כל ערך פנימי הוא ערך schema. */
export const SCOPE_SCHEMA: Record<EmploymentScope, string> = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  temporary: 'TEMPORARY',
  contract: 'CONTRACTOR',
  student: 'INTERN',
};

/** מיקומים שאינם יישוב אלא צורת עבודה — לא נכנסים ל-addressLocality. */
const REMOTE_HINTS = /מרחוק|היברידי|hybrid|remote/i;
export function isRemoteLocation(location: string | null): boolean {
  return !!location && REMOTE_HINTS.test(location);
}

/**
 * נטען פעם אחת בזמן בנייה בלבד. האתר שנפרס אינו מחזיק חיבור למסד,
 * אין בו מפתח ואין דרך לקרוא דרכו מידע (אפיון, מודל המידור).
 * פרסום או סגירה של משרה מפעילים בנייה מחדש.
 *
 * התוצאה נשמרת ברמת המודול: חמישה עמודים קוראים ל-loadJobs() באותה בנייה,
 * ובלי ה-memoization נפתחים חמישה חיבורי pooler ויכול להיווצר sitemap
 * שאינו עקבי עם העמודים שנבנו (B10).
 */
let cache: Promise<Job[]> | null = null;
export function loadJobs(): Promise<Job[]> {
  cache ??= fetchJobs();
  return cache;
}

async function fetchJobs(): Promise<Job[]> {
  let url = process.env.DATABASE_URL?.trim();

  // ניקוי טעויות הדבקה נפוצות: גרשיים עוטפים, קידומת DATABASE_URL=.
  if (url && /^DATABASE_URL=/.test(url)) url = url.replace(/^DATABASE_URL=/, '').trim();
  if (url && ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'")))) {
    url = url.slice(1, -1).trim();
  }

  if (!url) {
    // בייצור אסור לפרסם משרות דמה בשקט (K3). בפיתוח מקומי זו עדיין דרך
    // נוחה לעבוד בלי מסד. ALLOW_DEMO_BUILD=1 (בדיקת ה-CI בלבד) פותח את
    // אותה נוחות גם כש-CI מוגדר — ראו ההערה ב-astro.config.mjs.
    const allowDemoBuild = process.env.ALLOW_DEMO_BUILD === '1';
    if (!allowDemoBuild && (process.env.CI || process.env.CF_PAGES || process.env.WORKERS_CI)) {
      throw new Error('[jobs] DATABASE_URL חסר בבניית ייצור. בלעדיו היו נצרבות לאתר משרות הדגמה.');
    }
    console.warn('[jobs] DATABASE_URL לא הוגדר — נבנה מנתוני הדגמה (פיתוח מקומי בלבד)');
    return sortJobs(fixtures as Job[]);
  }

  // אבחון ברור במקום "Invalid URL" של postgres.
  if (url.includes('[') || url.includes(']') || url.toUpperCase().includes('YOUR-PASSWORD')) {
    throw new Error('[jobs] DATABASE_URL עדיין מכיל סוגריים או את התבנית [YOUR-PASSWORD]. החליפו בסיסמה האמיתית, בלי הסוגריים.');
  }
  try { new URL(url); } catch {
    throw new Error('[jobs] DATABASE_URL אינו כתובת תקינה. בדקו רווח/ירידת שורה, או תו מיוחד בסיסמה שצריך קידוד (@=%40, #=%23, /=%2F).');
  }

  const { default: postgres } = await import('postgres');
  // verify-full ולא require: ב-postgres.js הערך 'require' שקול ל-
  // rejectUnauthorized:false, כלומר החיבור שנושא את סיסמת המסד אינו מאמת
  // את תעודת השרת כלל (B11). prepare:false נדרש ל-pooler של Supabase.
  const sql = postgres(url, { max: 1, idle_timeout: 5, prepare: false, ssl: 'verify-full' });
  try {
    const rows = await sql<Job[]>`
      select slug, title, body, location, employment_scope, company_name, published_at
      from app.published_jobs`;
    console.log(`[jobs] נצרבו ${rows.length} משרות מהמסד`);
    return sortJobs([...rows]);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** ממיין עותק. מיון in-place היה משנה את מערך ה-fixtures המיובא (N12). */
function sortJobs(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at));
}

export function isFresh(job: Job, days = 14): boolean {
  return Date.now() - +new Date(job.published_at) < days * 864e5;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' })
    .format(new Date(iso));
}

/** התאריך בלבד (YYYY-MM-DD) עבור <time datetime> ועבור JSON-LD. */
export function isoDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/**
 * תוקף הפרסום עבור schema.org. אין במסד תאריך תפוגה, ולכן נגזר חלון
 * סביר מתאריך הפרסום; מחיקת המשרה מהמסד מפילה גם את העמוד בבנייה הבאה.
 */
export function validThrough(iso: string, days = 90): string {
  return new Date(+new Date(iso) + days * 864e5).toISOString();
}

/** תקציר קצר לכרטיס ולתגית התיאור, בלי סימני תבליט. */
export function excerpt(body: string, max = 155): string {
  const flat = String(body ?? '').replace(/\s*[•\n]+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (flat.length <= max) return flat;
  // כשאין רווח ב-max התווים הראשונים, lastIndexOf מחזיר -1 ו-slice(0,-1)
  // היה מחזיר כמעט את כל הטקסט (N9). נופלים לחיתוך קשיח.
  const cut = flat.lastIndexOf(' ', max);
  return flat.slice(0, cut > 0 ? cut : max).trimEnd() + '…';
}

/** רשימת מיקומים ייחודית למסנן. */
export function locationsOf(jobs: Job[]): string[] {
  return [...new Set(jobs.map(j => j.location).filter((l): l is string => !!l))]
    .sort((a, b) => a.localeCompare(b, 'he'));
}
