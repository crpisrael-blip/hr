import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Link } from 'react-router-dom';
import { APP_STAGE, formatDate, label } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import { PAGE_SIZE } from '../lib/config';
import PageHead from '../components/PageHead';
import { Msg, Loading, EmptyState } from '../components/Msg';

interface Row {
  id: string; stage: string; stage_changed_at: string;
  candidates: { full_name: string } | null; jobs: { title: string } | null;
}

export default function Applications() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.from('applications')
      .select('id, stage, stage_changed_at, candidates(full_name), jobs(title)')
      .order('stage_changed_at', { ascending: false }).limit(limit)
      .then(r => {
        if (!alive) return;
        if (r.error) { setErr(toUserMessage(r.error, 'טעינת המועמדויות נכשלה.')); return; }
        const data = r.data as unknown as Row[];
        setErr(''); setRows(data); setMore(data.length >= limit);
      });
    return () => { alive = false; };
  }, [limit]);
  return (
    <>
      <PageHead title="מועמדויות" sub="תהליכי גיוס פעילים" action={<Link to="/applications/new" className="btn btn-primary btn-sm">+ מועמדות חדשה</Link>} />
      <Msg kind="err">{err}</Msg>
      {!rows && !err && <Loading />}
      {rows && rows.length === 0 && <EmptyState>אין עדיין מועמדויות.</EmptyState>}
      {rows && rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>מועמד</th><th>משרה</th><th>שלב</th><th>עודכן</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}><td style={{ fontWeight: 600 }}><Link to={`/applications/${r.id}`}>{r.candidates?.full_name ?? '—'}</Link></td>
                <td>{r.jobs?.title ?? '—'}</td>
                <td><span className="tag brand">{label(APP_STAGE, r.stage)}</span></td>
                <td className="num">{formatDate(r.stage_changed_at)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {rows && more && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-quiet btn-sm" onClick={() => setLimit(l => l + PAGE_SIZE)}>הצגת עוד מועמדויות</button>
        </div>
      )}
    </>
  );
}
