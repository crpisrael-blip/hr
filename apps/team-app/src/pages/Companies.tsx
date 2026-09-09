import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { COMPANY_STATUS, formatDate } from '../lib/format';
import PageHead from '../components/PageHead';

interface Row { id: string; name: string; status: string; website: string | null; created_at: string; }

export default function Companies() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    supabase.from('companies').select('id, name, status, website, created_at')
      .order('created_at', { ascending: false })
      .then(r => { if (r.error) setErr(r.error.message); else setRows(r.data as Row[]); });
  }, []);

  return (
    <>
      <PageHead title="חברות" sub="הלקוחות שאתם מגייסים עבורם"
        action={<Link to="/companies/new" className="btn btn-primary btn-sm">+ חברה חדשה</Link>} />
      {err && <p className="msg err">{err}</p>}
      {!rows && !err && <p className="spinner">טוען…</p>}
      {rows && rows.length === 0 && <div className="card empty">אין עדיין חברות. הקימו את הראשונה.</div>}
      {rows && rows.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table>
            <thead><tr><th>שם</th><th>סטטוס</th><th>אתר</th><th>נוצרה</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}><Link to={`/companies/${r.id}`}>{r.name}</Link></td>
                  <td><span className={'tag ' + (r.status === 'active' ? 'ok' : 'mute')}>{COMPANY_STATUS[r.status]}</span></td>
                  <td>{r.website ? <a href={r.website} target="_blank" rel="noreferrer">קישור</a> : '—'}</td>
                  <td className="num">{formatDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
