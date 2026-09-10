import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { JOB_STAGE, APP_STAGE, formatDate, money } from '../lib/format';
import PageHead from '../components/PageHead';
import { CustomFieldsView } from '../components/CustomFields';

const SCOPE: Record<string, string> = { full_time: 'מלאה', part_time: 'חלקית', temporary: 'זמני', contract: 'חוזה', student: 'סטודנט' };
// מעברי סטטוס מותרים לפי הסטטוס הנוכחי.
const NEXT: Record<string, { to: string; label: string; primary?: boolean }[]> = {
  draft:   [{ to: 'open', label: 'פתיחת המשרה', primary: true }, { to: 'closed', label: 'סגירה' }],
  open:    [{ to: 'on_hold', label: 'העברה להמתנה' }, { to: 'filled', label: 'סימון כאויישה', primary: true }, { to: 'closed', label: 'סגירה' }],
  on_hold: [{ to: 'open', label: 'חזרה לפעילה', primary: true }, { to: 'closed', label: 'סגירה' }],
  filled:  [{ to: 'open', label: 'פתיחה מחדש', primary: true }, { to: 'closed', label: 'סגירה' }],
  closed:  [{ to: 'open', label: 'פתיחה מחדש', primary: true }],
};

export default function JobDetail() {
  const { id } = useParams();
  const [j, setJ] = useState<any>(null);
  const [apps, setApps] = useState<any[]>([]);
  const [log, setLog] = useState<any[]>([]);
  const [pub, setPub] = useState<any>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  async function load() {
    const r = await supabase.from('jobs')
      .select('id, title, stage, location, employment_scope, headcount, salary_min, salary_max, opened_at, closed_at, internal_description, must_have, nice_to_have, custom, company_id, recruiter_id, companies(name), employees!recruiter_id(full_name), job_publications(id, status)')
      .eq('id', id).maybeSingle();
    if (r.error) { setErr(r.error.message); return; }
    if (!r.data) { setErr('המשרה לא נמצאה'); return; }
    setJ(r.data);
    setPub((r.data as any).job_publications?.find((p: any) => p.status === 'published') ?? null);
    const [ap, lg] = await Promise.all([
      supabase.from('applications').select('id, stage, stage_changed_at, candidates(full_name)').eq('job_id', id).order('stage_changed_at', { ascending: false }),
      supabase.from('job_stage_history').select('*, employees!changed_by(full_name)').eq('job_id', id).order('changed_at', { ascending: false }),
    ]);
    if (!ap.error) setApps(ap.data); if (!lg.error) setLog(lg.data);
  }
  useEffect(() => { load(); }, [id]);

  async function setStage(to: string) {
    setBusy(true); setErr('');
    const { error } = await supabase.from('jobs').update({ stage: to }).eq('id', id);
    setBusy(false);
    if (error) setErr(error.message); else load();
  }

  if (err && !j) return <p className="msg err">{err}</p>;
  if (!j) return <p className="spinner">טוען…</p>;
  const transitions = NEXT[j.stage] ?? [];

  return (
    <>
      <PageHead title={j.title} sub={j.companies?.name ?? ''}
        action={<Link to={`/jobs/${j.id}/edit`} className="btn btn-quiet btn-sm">✏️ עריכה</Link>} />
      {err && <p className="msg err">{err}</p>}

      <div className="grid2">
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <div className="spread" style={{ marginBottom: 12 }}>
              <h2 className="sec" style={{ margin: 0 }}>סטטוס</h2>
              <div style={{ display: 'flex', gap: 6 }}>
                <span className={'tag ' + (j.stage === 'open' ? 'ok' : j.stage === 'filled' ? 'brand' : 'mute')}>{JOB_STAGE[j.stage]}</span>
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
              <dt>היקף</dt><dd>{SCOPE[j.employment_scope] ?? '—'}</dd>
              <dt>תקנים</dt><dd>{j.headcount}</dd>
              <dt>טווח שכר</dt><dd>{money(j.salary_min)} – {money(j.salary_max)}</dd>
              <dt>נפתחה</dt><dd>{j.opened_at ? formatDate(j.opened_at) : '—'}</dd>
              <dt>נסגרה</dt><dd>{j.closed_at ? formatDate(j.closed_at) : '—'}</dd>
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
                    <span className="tag brand">{APP_STAGE[a.stage] ?? a.stage}</span>
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
                    <div className="tl-row"><span>{h.from_stage ? `${JOB_STAGE[h.from_stage]} → ` : ''}<strong>{JOB_STAGE[h.to_stage]}</strong></span>
                      <span className="hint">{formatDate(h.changed_at)}</span></div>
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
