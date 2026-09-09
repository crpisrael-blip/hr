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

/**
 * נטען פעם אחת בזמן בנייה בלבד. האתר שנפרס אינו מחזיק חיבור למסד,
 * אין בו מפתח ואין דרך לקרוא דרכו מידע (אפיון, מודל המידור).
 * פרסום או סגירה של משרה מפעילים בנייה מחדש.
 */
export async function loadJobs(): Promise<Job[]> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn('[jobs] DATABASE_URL לא הוגדר — נבנה מנתוני הדגמה');
    return sortJobs(fixtures as Job[]);
  }

  const { default: postgres } = await import('postgres');
  // ssl require ו-prepare:false מתאימים ל-Supabase pooler (session/transaction כאחד).
  const sql = postgres(url, { max: 1, idle_timeout: 5, prepare: false, ssl: 'require' });
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

function sortJobs(jobs: Job[]): Job[] {
  return jobs.sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at));
}

export function isFresh(job: Job, days = 14): boolean {
  return Date.now() - +new Date(job.published_at) < days * 864e5;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' })
    .format(new Date(iso));
}

/** תקציר קצר לכרטיס ולתגית התיאור, בלי סימני תבליט. */
export function excerpt(body: string, max = 155): string {
  const flat = body.replace(/\s*[•\n]+\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, flat.lastIndexOf(' ', max)) + '…';
}

/** רשימת מיקומים ייחודית למסנן. */
export function locationsOf(jobs: Job[]): string[] {
  return [...new Set(jobs.map(j => j.location).filter((l): l is string => !!l))]
    .sort((a, b) => a.localeCompare(b, 'he'));
}
