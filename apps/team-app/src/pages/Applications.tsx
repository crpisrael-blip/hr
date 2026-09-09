import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { APP_STAGE, formatDate } from '../lib/format';
import PageHead from '../components/PageHead';

interface Row { id: string; stage: string; stage_changed_at: string;
  candidates: { full_name: string } | null; jobs: { title: string } | null; }

export default function Applications() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('applications')
      .select('id, stage, stage_changed_at, candidates(full_name), jobs(title)')
      .order('stage_changed_at', { ascending: false }).limit(200)
      .then(r => { if (r.error) setErr(r.error.message); else setRows(r.data as any); });
  }, []);
  return (
    <>
      <PageHead title="מועמדויות" sub="תהליכי גיוס פעילים" action={<Link to="/applications/new" className="btn btn-primary btn-sm">+ מועמדות חדשה</Link>} />
      {err && <p className="msg err">{err}</p>}
      {!rows && !err && <p className="spinner">טוען…</p>}
      {rows && rows.length === 0 && <div className="card empty">אין עדיין מועמדויות.</div>}
      {rows && rows.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table>
            <thead><tr><th>מועמד</th><th>משרה</th><th>שלב</th><th>עודכן</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}><td style={{ fontWeight: 600 }}><Link to={`/applications/${r.id}`}>{r.candidates?.full_name ?? '—'}</Link></td>
                <td>{r.jobs?.title ?? '—'}</td>
                <td><span className="tag brand">{APP_STAGE[r.stage]}</span></td>
                <td className="num">{formatDate(r.stage_changed_at)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
