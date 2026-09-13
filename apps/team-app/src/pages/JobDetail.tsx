import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { JOB_STAGE, APP_STAGE, SCOPE, formatDate, label, money } from '../lib/format';
import { useLoad, unwrap } from '../lib/useLoad';
import { toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import { Msg, Loading } from '../components/Msg';
import { CustomFieldsView } from '../components/CustomFields';

// מעברי סטטוס מותרים לפי הסטטוס הנוכחי.
const NEXT: Record<string, { to: string; label: string; primary?: boolean }[]> = {
  draft: [{ to: 'open', label: 'פתיחת המשרה', primary: true }, { to: 'closed', label: 'סגירה' }],
  open: [{ to: 'on_hold', label: 'העברה להמתנה' }, { to: 'filled', label: 'סימון כאויישה', primary: true }, { to: 'closed', label: 'סגירה' }],
  on_hold: [{ to: 'open', label: 'חזרה לפעילה', primary: true }, { to: 'closed', label: 'סגירה' }],
  filled: [{ to: 'open', label: 'פתיחה מחדש', primary: true }, { to: 'closed', label: 'סגירה' }],
  closed: [{ to: 'open', label: 'פתיחה מחדש', primary: true }],
};

interface Job {
  id: string; title: string; stage: string; location: string | null; employment_scope: string | null;
  headcount: number; salary_min: number | null; salary_max: number | null; opened_at: string | null;
  closed_at: string | null; internal_description: string | null; must_have: string | null;
  nice_to_have: string | null; custom: Record<string, unknown> | null; company_id: string; recruiter_id: string | null;
  companies: { name: string } | null; employees: { full_name: string } | null;
  job_publications: { id: string; status: string }[] | null;
}
interface AppRow { id: string; stage: string; stage_changed_at: string; candidates: { full_name: string } | null }
interface LogRow { id: number; from_stage: string | null; to_stage: string; changed_at: string; employees: { full_name: string } | null }

export default function JobDetail() {
  const { id } = useParams();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  const { data, err: loadErr, loading, reload } = useLoad(async () => {
    const job = unwrap(await supabase.from('jobs')
      .select('id, title, stage, location, employment_scope, headcount, salary_min, salary_max, opened_at, closed_at, internal_description, must_have, nice_to_have, custom, company_id, recruiter_id, companies(name), employees!recruiter_id(full_name), job_publications(id, status)')
      .eq('id', id).maybeSingle()) as unknown as Job | null;
    if (!job) throw { code: 'PGRST116', message: 'job not found' };
    const [ap, lg] = await Promise.all([
      supabase.from('applications').select('id, stage, stage_changed_at, candidates(full_name)').eq('job_id', id).order('stage_changed_at', { ascending: false }),
      supabase.from('job_stage_history').select('id, from_stage, to_stage, changed_at, employees!changed_by(full_name)').eq('job_id', id).order('changed_at', { ascending: false }),
    ]);
    return { job, apps: unwrap(ap) as unknown as AppRow[], log: unwrap(lg) as unknown as LogRow[] };
  }, [id]);

  async function setStage(to: string) {
    setBusy(true); setErr('');
    const { error } = await supabase.from('jobs').update({ stage: to }).eq('id', id);
    setBusy(false);
    if (error) { setErr(toUserMessage(error, 'עדכון שלב המשרה נכשל.')); return; }
    reload();
  }

  if (loading) return <Loading />;
  if (loadErr || !data) return <Msg kind="err">{loadErr || 'המשרה לא נמצאה.'}</Msg>;

  const { job: j, apps, log } = data;
  const pub = j.job_publications?.find(p => p.status === 'published') ?? null;
  const transitions = NEXT[j.stage] ?? [];
  const salary = j.salary_min == null && j.salary_max == null
    ? 'לא הוגדר'
    : `${money(j.salary_min, 'ILS', 0)} – ${money(j.salary_max, 'ILS', 0)}`;

  return (
    <>
      <PageHead title={j.title} sub={j.companies?.name ?? ''}
        action={<Link to={`/jobs/${j.id}/edit`} className="btn btn-quiet btn-sm">עריכת המשרה</Link>} />
      <Msg kind="err">{err}</Msg>

      <div className="grid2">
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div className="spread" style={{ marginBottom: 12 }}>
              <h2 className="sec" style={{ margin: 0 }}>סטטוס</h2>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className={'tag ' + (j.stage === 'open' ? 'ok' : j.stage === 'filled' ? 'brand' : 'mute')}>{label(JOB_STAGE, j.stage)}</span>
                {pub ? <span className="tag ok">מפורסמת</span> : <span className="tag">לא מפורסמת</span>}
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {transitions.map(t => (
                <button key={t.to} className={'btn btn-sm ' + (t.primary ? 'btn-primary' : 'btn-quiet')} disabled={busy}
                  onClick={() => setStage(t.to)}>{t.label}</button>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <h2 className="sec">פרטים</h2>
            <dl className="dl">
              <dt>חברה</dt><dd>{j.companies?.name ? <Link to={`/companies/${j.company_id}`}>{j.companies.name}</Link> : '—'}</dd>
              <dt>מגייס אחראי</dt><dd>{j.employees?.full_name ?? '—'}</dd>
              <dt>מיקום</dt><dd>{j.location ?? '—'}</dd>
              <dt>היקף</dt><dd>{j.employment_scope ? label(SCOPE, j.employment_scope) : '—'}</dd>
              <dt>תקנים</dt><dd>{j.headcount}</dd>
              <dt>טווח שכר</dt><dd>{salary}</dd>
              <dt>נפתחה</dt><dd>{formatDate(j.opened_at)}</dd>
              <dt>נסגרה</dt><dd>{formatDate(j.closed_at)}</dd>
            </dl>
            {j.internal_description && <><h3 className="sub-h">תיאור פנימי</h3><p className="txt">{j.internal_description}</p></>}
            {j.must_have && <><h3 className="sub-h">חובה</h3><p className="txt">{j.must_have}</p></>}
            {j.nice_to_have && <><h3 className="sub-h">יתרון</h3><p className="txt">{j.nice_to_have}</p></>}
          </div>

          <CustomFieldsView entityType="job" values={j.custom} />
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <h2 className="sec">מועמדים שנגשו ({apps.length})</h2>
            {apps.length === 0 ? <p className="hint">אין עדיין מועמדים למשרה זו.</p> : (
              <ul className="linklist">
                {apps.map(a => (
                  <li key={a.id}><Link to={`/applications/${a.id}`}>
                    <span>{a.candidates?.full_name ?? 'מועמד'}</span>
                    <span className="tag brand">{label(APP_STAGE, a.stage)}</span>
                  </Link></li>
                ))}
              </ul>
            )}
          </div>

          <div className="card" style={{ padding: 20 }}>
            <h2 className="sec">לוג שינויים</h2>
            {log.length === 0 ? <p className="hint">אין עדיין שינויי סטטוס.</p> : (
              <ol className="timeline">
                {log.map(h => (
                  <li key={h.id}>
                    <div className="tl-row">
                      <span>{h.from_stage ? `${label(JOB_STAGE, h.from_stage)} → ` : ''}<strong>{label(JOB_STAGE, h.to_stage)}</strong></span>
                      <span className="hint">{formatDate(h.changed_at)}</span>
                    </div>
                    {h.employees?.full_name && <div className="hint">{h.employees.full_name}</div>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
      <style>{`
        .sub-h { font-size: .9rem; color: var(--ink-soft); margin: 14px 0 4px; }
        .txt { margin: 0; white-space: pre-wrap; line-height: 1.5; }
      `}</style>
    </>
  );
}
