import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { COMPANY_STATUS, formatDate, label, safeUrl } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import { PAGE_SIZE } from '../lib/config';
import PageHead from '../components/PageHead';
import { Msg, Loading, EmptyState } from '../components/Msg';

interface Row { id: string; name: string; status: string; website: string | null; created_at: string }

export default function Companies() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [more, setMore] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.from('companies').select('id, name, status, website, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)
      .then(r => {
        if (!alive) return;
        if (r.error) { setErr(toUserMessage(r.error, 'טעינת החברות נכשלה.')); return; }
        const data = r.data as Row[];
        setErr(''); setRows(data); setMore(data.length >= limit);
      });
    return () => { alive = false; };
  }, [limit]);

  return (
    <>
      <PageHead title="חברות" sub="הלקוחות שאתם מגייסים עבורם"
        action={<Link to="/companies/new" className="btn btn-primary btn-sm">+ חברה חדשה</Link>} />
      <Msg kind="err">{err}</Msg>
      {!rows && !err && <Loading />}
      {rows && rows.length === 0 && <EmptyState>אין עדיין חברות. הקימו את הראשונה.</EmptyState>}
      {rows && rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>שם</th><th>סטטוס</th><th>אתר</th><th>נוצרה</th></tr></thead>
            <tbody>
              {rows.map(r => {
                // ★ href מתוך נתוני משתמש: מאשרים רק http/https (input type=url מקבל javascript:).
                const site = safeUrl(r.website);
                return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}><Link to={`/companies/${r.id}`}>{r.name}</Link></td>
                    <td><span className={'tag ' + (r.status === 'active' ? 'ok' : 'mute')}>{label(COMPANY_STATUS, r.status)}</span></td>
                    <td>{site ? <a href={site} target="_blank" rel="noreferrer noopener">קישור לאתר</a> : '—'}</td>
                    <td className="num">{formatDate(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && more && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-quiet btn-sm" onClick={() => setLimit(l => l + PAGE_SIZE)}>הצגת עוד חברות</button>
        </div>
      )}
    </>
  );
}
