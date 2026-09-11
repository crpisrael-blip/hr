import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatDate, initials } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import { PAGE_SIZE } from '../lib/config';
import PageHead from '../components/PageHead';
import Contact from '../components/Contact';
import { Msg, Loading, EmptyState } from '../components/Msg';

interface Row { id: string; full_name: string; phone_raw: string | null; email: string | null; source: string | null; created_at: string }

export default function Candidates() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.from('candidates').select('id, full_name, phone_raw, email, source, created_at')
      .order('created_at', { ascending: false }).limit(limit)
      .then(r => {
        if (!alive) return;
        if (r.error) { setErr(toUserMessage(r.error, 'טעינת המועמדים נכשלה.')); return; }
        const data = r.data as Row[];
        setErr(''); setRows(data); setMore(data.length >= limit);
      });
    return () => { alive = false; };
  }, [limit]);

  return (
    <>
      <PageHead title="מועמדים" sub="מאגר המועמדים" action={<Link to="/candidates/new" className="btn btn-primary btn-sm">+ מועמד חדש</Link>} />
      <Msg kind="err">{err}</Msg>
      {!rows && !err && <Loading />}
      {rows && rows.length === 0 && <EmptyState>אין עדיין מועמדים. הם ייווצרו מהגשות באתר או מייבוא.</EmptyState>}
      {rows && rows.length > 0 && (
        <div className="record-grid">
          {rows.map(r => (
            <article className="card record-card" key={r.id}>
              <header>
                <h2><Link to={`/candidates/${r.id}`}>{r.full_name}</Link></h2>
                <span className="ava" aria-hidden="true">{initials(r.full_name)}</span>
              </header>
              <dl>
                <dt>טלפון</dt><dd><Contact kind="phone" value={r.phone_raw} /></dd>
                <dt>דוא״ל</dt><dd><Contact kind="email" value={r.email} /></dd>
                <dt>מקור</dt><dd>{r.source ?? '—'}</dd>
              </dl>
              <footer>
                <span className="hint">נוצר {formatDate(r.created_at)}</span>
                <Link to={`/candidates/${r.id}`} className="btn btn-quiet btn-sm">תיק מועמד</Link>
              </footer>
            </article>
          ))}
        </div>
      )}
      {rows && more && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-quiet btn-sm" onClick={() => setLimit(l => l + PAGE_SIZE)}>הצגת עוד מועמדים</button>
        </div>
      )}
    </>
  );
}
