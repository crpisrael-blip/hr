import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
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
      <PageHead title="מועמדים" sub="מאגר המועמדים" />
      {err && <p className="msg err">{err}</p>}
      {!rows && !err && <p className="spinner">טוען…</p>}
      {rows && rows.length === 0 && <div className="card empty">אין עדיין מועמדים. הם ייווצרו מהגשות באתר או מייבוא.</div>}
      {rows && rows.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table>
            <thead><tr><th>שם</th><th>טלפון</th><th>דוא״ל</th><th>מקור</th><th>נוצר</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}><td style={{ fontWeight: 600 }}>{r.full_name}</td>
                <td>{r.phone_raw ?? '—'}</td><td>{r.email ?? '—'}</td>
                <td>{r.source ?? '—'}</td><td className="num">{formatDate(r.created_at)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
