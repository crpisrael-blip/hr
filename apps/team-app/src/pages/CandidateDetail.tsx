import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { APP_STAGE, formatDate, money } from '../lib/format';
import PageHead from '../components/PageHead';

interface Candidate {
  id: string; full_name: string; phone_raw: string | null; email: string | null;
  skills: string[] | null; desired_salary: number | null; availability: string | null; source: string | null; created_at: string;
}
interface Appl { id: string; stage: string; stage_changed_at: string; jobs: { title: string } | null; }

export default function CandidateDetail() {
  const { id } = useParams();
  const [c, setC] = useState<Candidate | null>(null);
  const [apps, setApps] = useState<Appl[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      const cr = await supabase.from('candidates')
        .select('id, full_name, phone_raw, email, skills, desired_salary, availability, source, created_at')
        .eq('id', id).maybeSingle();
      if (cr.error) { setErr(cr.error.message); return; }
      if (!cr.data) { setErr('המועמד לא נמצא'); return; }
      setC(cr.data as Candidate);
      const ar = await supabase.from('applications')
        .select('id, stage, stage_changed_at, jobs(title)').eq('candidate_id', id)
        .order('stage_changed_at', { ascending: false });
      if (!ar.error) setApps(ar.data as any);
    })();
  }, [id]);

  if (err) return <p className="msg err">{err}</p>;
  if (!c) return <p className="spinner">טוען…</p>;

  return (
    <>
      <PageHead title={c.full_name} sub="כרטיס מועמד"
        action={<Link to={`/applications/new?candidate=${c.id}`} className="btn btn-primary btn-sm">+ מועמדות למשרה</Link>} />
      <div className="grid2">
        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">פרטים</h2>
          <dl className="dl">
            <dt>טלפון</dt><dd>{c.phone_raw ?? '—'}</dd>
            <dt>דוא״ל</dt><dd>{c.email ?? '—'}</dd>
            <dt>כישורים</dt><dd>{c.skills?.length ? c.skills.join(', ') : '—'}</dd>
            <dt>שכר רצוי</dt><dd>{money(c.desired_salary)}</dd>
            <dt>זמינות</dt><dd>{c.availability ?? '—'}</dd>
            <dt>מקור</dt><dd>{c.source ?? '—'}</dd>
            <dt>נוצר</dt><dd>{formatDate(c.created_at)}</dd>
          </dl>
        </div>
        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">מועמדויות ({apps.length})</h2>
          {apps.length === 0 ? <p className="hint">אין מועמדויות. אפשר לפתוח מועמדות למשרה.</p> : (
            <ul className="linklist">
              {apps.map(a => (
                <li key={a.id}>
                  <Link to={`/applications/${a.id}`}>
                    <span>{a.jobs?.title ?? 'משרה'}</span>
                    <span className="tag brand">{APP_STAGE[a.stage]}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <style>{`
        .grid2 { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; align-items: start; }
        .sec { font-size: 1.05rem; margin-bottom: 12px; }
        .dl { display: grid; grid-template-columns: 120px 1fr; gap: 8px 12px; margin: 0; }
        .dl dt { color: var(--ink-soft); font-size: .88rem; }
        .dl dd { margin: 0; }
        .linklist { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
        .linklist a { display: flex; justify-content: space-between; align-items: center; gap: 10px;
          padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--radius-sm); text-decoration: none; color: inherit; }
        .linklist a:hover { background: var(--sunk); }
        @media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
