import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fin, enrichPlacements } from '../lib/supabase';
import { PLACEMENT_STATUS, money, formatDate } from '../lib/format';
import PageHead from '../components/PageHead';

export default function Placements() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    fin.from('placements')
      .select('id, status, agreed_salary, expected_commission, currency, verified_start_date, warranty_ends_on, company_id, application_id')
      .order('created_at', { ascending: false }).limit(200)
      .then(async r => { if (r.error) setErr(r.error.message); else setRows(await enrichPlacements(r.data as any)); });
  }, []);
  return (
    <>
      <PageHead title="השמות" sub="השמות ומצב האחריות והחיוב" />
      {err && <p className="msg err">{err}</p>}
      {!rows && !err && <p className="spinner">טוען…</p>}
      {rows && rows.length === 0 && <div className="card empty">אין עדיין השמות. השמה נוצרת ממועמדות שהתקבלה.</div>}
      {rows && rows.length > 0 && (
        <div className="card" style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th>מועמד</th><th>חברה</th><th>שכר</th><th>עמלה צפויה</th><th>תחילת עבודה</th><th>סיום אחריות</th><th>מצב</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}><Link to={`/placements/${r.id}`}>{r.candidateName ?? '—'}</Link></td>
                <td>{r.companyName ?? '—'}</td>
                <td className="num">{money(r.agreed_salary, r.currency)}</td>
                <td className="num">{money(r.expected_commission, r.currency)}</td>
                <td className="num">{formatDate(r.verified_start_date)}</td>
                <td className="num">{formatDate(r.warranty_ends_on)}</td>
                <td><span className={'tag ' + (r.status==='approved'?'ok':r.status==='working_warranty'?'warn':'mute')}>{PLACEMENT_STATUS[r.status]}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
