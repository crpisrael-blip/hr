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

// ---- גישור חוצה-סכמה (finance → app) ----
// PostgREST אינו מטמיע קשרים חוצי-סכמה כאן, לכן פותרים שמות מטבלאות app בנפרד.
async function idMap(table: string, ids: any[], select: string): Promise<Record<string, any>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return {};
  const { data } = await supabase.from(table).select(select).in('id', clean);
  return Object.fromEntries((data || []).map((r: any) => [r.id, r]));
}

// שם עובד לפי מזהים.
export async function employeeNames(ids: any[]): Promise<Record<string, string>> {
  const m = await idMap('employees', ids, 'id, full_name');
  return Object.fromEntries(Object.entries(m).map(([id, r]: any) => [id, r.full_name]));
}

// מידע מועמד/משרה לפי application_id.
export async function applicantInfo(appIds: any[]): Promise<Record<string, { candidateName: string | null; jobTitle: string | null }>> {
  const apps = await idMap('applications', appIds, 'id, candidate_id, job_id');
  const vals = Object.values(apps) as any[];
  const [cands, jobs] = await Promise.all([
    idMap('candidates', vals.map(a => a.candidate_id), 'id, full_name'),
    idMap('jobs', vals.map(a => a.job_id), 'id, title'),
  ]);
  const out: Record<string, { candidateName: string | null; jobTitle: string | null }> = {};
  for (const [id, a] of Object.entries(apps) as any) {
    out[id] = { candidateName: cands[a.candidate_id]?.full_name ?? null, jobTitle: jobs[a.job_id]?.title ?? null };
  }
  return out;
}

// מוסיף companyName / candidateName / jobTitle לשורות placements (finance).
export async function enrichPlacements<T extends { company_id?: string; application_id?: string }>(rows: T[]):
  Promise<(T & { companyName: string | null; candidateName: string | null; jobTitle: string | null })[]> {
  if (!rows?.length) return rows as any;
  const [companies, appInfo] = await Promise.all([
    idMap('companies', rows.map(r => r.company_id), 'id, name'),
    applicantInfo(rows.map(r => r.application_id)),
  ]);
  return rows.map(r => ({
    ...r,
    companyName: r.company_id ? (companies[r.company_id]?.name ?? null) : null,
    candidateName: r.application_id ? (appInfo[r.application_id]?.candidateName ?? null) : null,
    jobTitle: r.application_id ? (appInfo[r.application_id]?.jobTitle ?? null) : null,
  }));
}
