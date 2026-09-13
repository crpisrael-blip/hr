import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** חסרה תצורה: האפליקציה מציגה מסך "תצורה חסרה" במקום ליפול בזמן טעינת המודול. */
export const missingConfig = !url || !anon;
if (missingConfig) console.error('[hr] חסרים VITE_SUPABASE_URL או VITE_SUPABASE_ANON_KEY');

// כל הישויות שלנו יושבות בסכמת app, לא public.
// ערכי מילוי כשאין תצורה — createClient זורק על ערך ריק, וזה היה מפיל את כל האפליקציה.
export const supabase = createClient(url || 'https://missing.invalid', anon || 'missing-anon-key', {
  db: { schema: 'app' },
  auth: { persistSession: true, autoRefreshToken: true },
});

// גישה לטבלאות בסכמת finance (השמות, חיובים, בונוסים) — משתף את אותו session.
export const fin = supabase.schema('finance');

// ---- גישור חוצה-סכמה (finance → app) ----
// PostgREST אינו מטמיע קשרים חוצי-סכמה כאן, לכן פותרים שמות מטבלאות app בנפרד.
async function idMap<T extends { id: string }>(table: string, ids: (string | undefined | null)[], select: string): Promise<Record<string, T>> {
  const clean = [...new Set(ids.filter(Boolean))];
  if (!clean.length) return {};
  const { data, error } = await supabase.from(table).select(select).in('id', clean as string[]);
  if (error) { console.error('[hr] idMap ' + table + ':', error); return {}; }
  return Object.fromEntries(((data ?? []) as unknown as T[]).map(r => [r.id, r]));
}

// שם עובד לפי מזהים.
export async function employeeNames(ids: (string | undefined | null)[]): Promise<Record<string, string>> {
  const m = await idMap<{ id: string; full_name: string }>('employees', ids, 'id, full_name');
  return Object.fromEntries(Object.entries(m).map(([id, r]) => [id, r.full_name]));
}

// מידע מועמד/משרה לפי application_id.
export async function applicantInfo(appIds: (string | undefined | null)[]): Promise<Record<string, { candidateName: string | null; jobTitle: string | null }>> {
  const apps = await idMap<{ id: string; candidate_id: string; job_id: string }>('applications', appIds, 'id, candidate_id, job_id');
  const vals = Object.values(apps);
  const [cands, jobs] = await Promise.all([
    idMap<{ id: string; full_name: string }>('candidates', vals.map(a => a.candidate_id), 'id, full_name'),
    idMap<{ id: string; title: string }>('jobs', vals.map(a => a.job_id), 'id, title'),
  ]);
  const out: Record<string, { candidateName: string | null; jobTitle: string | null }> = {};
  for (const [id, a] of Object.entries(apps)) {
    out[id] = { candidateName: cands[a.candidate_id]?.full_name ?? null, jobTitle: jobs[a.job_id]?.title ?? null };
  }
  return out;
}

// מוסיף companyName / candidateName / jobTitle לשורות placements (finance).
export async function enrichPlacements<T extends { company_id?: string | null; application_id?: string | null }>(rows: T[]):
  Promise<(T & { companyName: string | null; candidateName: string | null; jobTitle: string | null })[]> {
  if (!rows?.length) return [];
  const [companies, appInfo] = await Promise.all([
    idMap<{ id: string; name: string }>('companies', rows.map(r => r.company_id), 'id, name'),
    applicantInfo(rows.map(r => r.application_id)),
  ]);
  return rows.map(r => ({
    ...r,
    companyName: r.company_id ? (companies[r.company_id]?.name ?? null) : null,
    candidateName: r.application_id ? (appInfo[r.application_id]?.candidateName ?? null) : null,
    jobTitle: r.application_id ? (appInfo[r.application_id]?.jobTitle ?? null) : null,
  }));
}
