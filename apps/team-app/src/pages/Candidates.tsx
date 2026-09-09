import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { formatDate } from '../lib/format';
import PageHead from '../components/PageHead';

interface Row { id: string; full_name: string; phone_raw: string | null; email: string | null; source: string | null; created_at: string; }

export default function Candidates() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('candidates').select('id, full_name, phone_raw, email, source, created_at')
      .order('created_at', { ascending: false }).limit(200)
      .then(r => { if (r.error) setErr(r.error.message); else setRows(r.data as Row[]); });
  }, []);
  return (
    <>
      <PageHead title="מועמדים" sub="מאגר המועמדים" action={<Link to="/candidates/new" className="btn btn-primary btn-sm">+ מועמד חדש</Link>} />
      {err && <p className="msg err">{err}</p>}
      {!rows && !err && <p className="spinner">טוען…</p>}
      {rows && rows.length === 0 && <div className="card empty">אין עדיין מועמדים. הם ייווצרו מהגשות באתר או מייבוא.</div>}
      {rows && rows.length > 0 && (
        <div className="record-grid">
          {rows.map(r => (
            <article className="card record-card" key={r.id}>
              <header><h2><Link to={`/candidates/${r.id}`}>{r.full_name}</Link></h2><span className="ava" aria-hidden="true">{r.full_name.slice(0,2)}</span></header>
              <dl><dt>טלפון</dt><dd><bdi>{r.phone_raw ?? '—'}</bdi></dd><dt>דוא״ל</dt><dd><bdi>{r.email ?? '—'}</bdi></dd><dt>מקור</dt><dd>{r.source ?? '—'}</dd></dl>
              <footer><span className="hint">נוצר {formatDate(r.created_at)}</span><Link to={`/candidates/${r.id}`} className="btn btn-quiet btn-sm">תיק מועמד ←</Link></footer>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
