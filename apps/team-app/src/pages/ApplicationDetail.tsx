import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { APP_STAGE, formatDate } from '../lib/format';
import { allowedTransitions, isTerminal, type Stage } from '../lib/stages';
import PageHead from '../components/PageHead';

interface Appl {
  id: string; stage: string; stage_changed_at: string; source: string | null; close_reason: string | null;
  candidate_id: string; job_id: string;
  candidates: { full_name: string } | null;
  jobs: { title: string; companies: { name: string } | null } | null;
}
interface Hist { id: number; from_stage: string | null; to_stage: string; reason: string | null; changed_at: string; }

export default function ApplicationDetail() {
  const { id } = useParams();
  const [a, setA] = useState<Appl | null>(null);
  const [hist, setHist] = useState<Hist[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await supabase.from('applications')
      .select('id, stage, stage_changed_at, source, close_reason, candidate_id, job_id, candidates(full_name), jobs(title, companies(name))')
      .eq('id', id).maybeSingle();
    if (r.error) { setErr(r.error.message); return; }
    if (!r.data) { setErr('המועמדות לא נמצאה'); return; }
    setA(r.data as any);
    const h = await supabase.from('application_stage_history')
      .select('id, from_stage, to_stage, reason, changed_at').eq('application_id', id)
      .order('changed_at', { ascending: false });
    if (!h.error) setHist(h.data as Hist[]);
  }
  useEffect(() => { load(); }, [id]);

  async function transition(to: Stage, kind: string) {
    if (!a) return;
    let reason: string | null = null;
    if (kind === 'close') {
      reason = prompt('סיבת הסיום:') || '';
      if (!reason) return;
    }
    setBusy(true); setErr('');
    const { data: emp } = await supabase.from('employees').select('id')
      .eq('user_id', (await supabase.auth.getUser()).data.user?.id).maybeSingle();
    const from = a.stage;
    const up = await supabase.from('applications').update({
      stage: to, stage_changed_at: new Date().toISOString(),
      close_reason: kind === 'close' ? reason : null,
    }).eq('id', a.id);
    if (up.error) { setErr(up.error.message); setBusy(false); return; }
    await supabase.from('application_stage_history').insert({
      application_id: a.id, from_stage: from, to_stage: to, reason, changed_by: emp?.id ?? null,
    });
    await load(); setBusy(false);
  }

  if (err) return <p className="msg err">{err}</p>;
  if (!a) return <p className="spinner">טוען…</p>;
  const transitions = allowedTransitions(a.stage);

  return (
    <>
      <PageHead title={a.candidates?.full_name ?? 'מועמדות'}
        sub={`${a.jobs?.title ?? ''}${a.jobs?.companies?.name ? ' · ' + a.jobs.companies.name : ''}`}
        action={<>
          {a.stage === 'hired' && <Link to={`/placements/new?application=${a.id}`} className="btn btn-primary btn-sm">יצירת השמה</Link>}
          <Link to={`/candidates/${a.candidate_id}`} className="btn btn-quiet btn-sm">לכרטיס המועמד</Link>
        </>} />

      <div className="grid2">
        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">שלב נוכחי</h2>
          <p><span className="tag brand" style={{ fontSize: '.95rem' }}>{APP_STAGE[a.stage]}</span></p>
          {a.close_reason && <p className="hint" style={{ marginTop: 8 }}>סיבת סיום: {a.close_reason}</p>}
          <div className="actions">
            {transitions.length === 0 && <p className="hint">אין מעברים זמינים.</p>}
            {transitions.map(t => (
              <button key={t.to} className={'btn btn-sm ' + (t.kind === 'close' ? 'btn-quiet' : 'btn-primary')}
                disabled={busy} onClick={() => transition(t.to, t.kind)}>{t.label}</button>
            ))}
          </div>
          {!isTerminal(a.stage) && a.stage === 'submitted_to_client' &&
            <p className="hint" style={{ marginTop: 10 }}>הערה: לפי האפיון, הגשה ללקוח דורשת רשומת הגשה עם נמען וגרסת מסמך. המסך הזה יתווסף בהמשך.</p>}
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">היסטוריית שלבים</h2>
          {hist.length === 0 ? <p className="hint">אין עדיין מעברים.</p> : (
            <ol className="timeline">
              {hist.map(h => (
                <li key={h.id}>
                  <div className="tl-row">
                    <span>{h.from_stage ? `${APP_STAGE[h.from_stage]} → ` : ''}<strong>{APP_STAGE[h.to_stage]}</strong></span>
                    <span className="hint">{formatDate(h.changed_at)}</span>
                  </div>
                  {h.reason && <div className="hint">{h.reason}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <style>{`
        .grid2 { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; align-items: start; }
        .sec { font-size: 1.05rem; margin-bottom: 12px; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
        .timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
        .timeline li { border-inline-start: 2px solid var(--line-strong); padding-inline-start: 12px; }
        .tl-row { display: flex; justify-content: space-between; gap: 10px; }
        @media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
