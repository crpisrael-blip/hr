import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase, fin, enrichPlacements } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { PLACEMENT_STATUS, INVOICE_STATUS, COMMISSION_BASE, money, formatDate } from '../lib/format';
import PageHead from '../components/PageHead';

export default function PlacementDetail() {
  const { id } = useParams();
  const { employee } = useAuth();
  const [p, setP] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const isMgr = employee?.role === 'manager' || employee?.role === 'superadmin';

  async function load() {
    const r = await fin.from('placements').select('*').eq('id', id).maybeSingle();
    if (r.error) { setErr(r.error.message); return; }
    if (!r.data) { setErr('ההשמה לא נמצאה'); return; }
    const [enriched] = await enrichPlacements([r.data as any]);
    setP(enriched);
    const sched = await fin.from('payment_schedules').select('id').eq('placement_id', id).maybeSingle();
    if (sched.data) {
      const inv = await fin.from('invoices').select('*').eq('schedule_id', sched.data.id).order('seq');
      if (!inv.error) setInvoices(inv.data);
    } else setInvoices([]);
  }
  useEffect(() => { load(); }, [id]);

  async function rpc(fn: string, args: any, okMsg?: string) {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (okMsg) alert(okMsg);
    await load();
  }
  async function verifyStart() {
    const d = prompt('תאריך תחילת עבודה בפועל (YYYY-MM-DD):', new Date().toISOString().slice(0,10));
    if (d) rpc('verify_placement_start', { p_placement_id: id, p_start: d });
  }
  async function approve() {
    if (confirm('לאשר את ההשמה וליצור לוח תשלומים? פעולה זו פותחת את הזכאות לחיוב.')) rpc('approve_placement', { p_placement_id: id });
  }
  async function fail() {
    const reason = prompt('סיבת סיום ההשמה:'); if (!reason) return;
    const status = confirm('לחצו אישור אם המועמד עזב בתקופת האחריות. ביטול = לא התחיל.') ? 'left_in_warranty' : 'not_started';
    rpc('fail_placement', { p_placement_id: id, p_status: status, p_reason: reason });
  }

  if (err && !p) return <p className="msg err">{err}</p>;
  if (!p) return <p className="spinner">טוען…</p>;

  return (
    <>
      <PageHead title={p.candidateName ?? 'השמה'}
        sub={`${p.jobTitle ?? ''} · ${p.companyName ?? ''}`} />
      {err && <p className="msg err">{err}</p>}
      <div className="grid2">
        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">פרטי השמה</h2>
          <dl className="dl">
            <dt>מצב</dt><dd><span className={'tag '+(p.status==='approved'?'ok':p.status==='working_warranty'?'warn':'mute')}>{PLACEMENT_STATUS[p.status]}</span></dd>
            <dt>שכר שסוכם</dt><dd>{money(p.agreed_salary, p.currency)}</dd>
            <dt>בסיס עמלה</dt><dd>{COMMISSION_BASE[p.commission_base]} · {p.commission_pct}%</dd>
            <dt>עמלה צפויה</dt><dd><strong>{money(p.expected_commission, p.currency)}</strong></dd>
            <dt>תחילה צפויה</dt><dd>{formatDate(p.expected_start_date)}</dd>
            <dt>תחילה מאומתת</dt><dd>{formatDate(p.verified_start_date)}</dd>
            <dt>סיום אחריות</dt><dd>{formatDate(p.warranty_ends_on)}</dd>
            {p.ended_reason && <><dt>סיבת סיום</dt><dd>{p.ended_reason}</dd></>}
          </dl>
          <div className="actions">
            {p.status==='pending_start' && <button className="btn btn-primary btn-sm" disabled={busy} onClick={verifyStart}>אימות תחילת עבודה</button>}
            {p.status==='working_warranty' && isMgr && <button className="btn btn-primary btn-sm" disabled={busy} onClick={approve}>אישור השמה + לוח תשלומים</button>}
            {(p.status==='pending_start'||p.status==='working_warranty') && <button className="btn btn-quiet btn-sm" disabled={busy} onClick={fail}>סיום/כישלון</button>}
          </div>
          {p.status==='working_warranty' && !isMgr && <p className="hint" style={{marginTop:10}}>אישור ההשמה ויצירת לוח התשלומים בסמכות המנהלת.</p>}
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">לוח תשלומים</h2>
          {invoices.length===0 ? <p className="hint">לוח התשלומים נוצר עם אישור ההשמה.</p> : (
            <table>
              <thead><tr><th>#</th><th>סכום</th><th>מועד הפקה</th><th>פירעון</th><th>מצב</th></tr></thead>
              <tbody>{invoices.map(i=>(
                <tr key={i.id}><td className="num">{i.seq}</td><td className="num">{money(Number(i.amount), i.currency)}</td>
                  <td className="num">{formatDate(i.planned_issue_date)}</td><td className="num">{formatDate(i.due_date)}</td>
                  <td><span className="tag mute">{INVOICE_STATUS[i.status]}</span></td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>
      <style>{`
        .grid2 { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; align-items: start; }
        .sec { font-size: 1.05rem; margin-bottom: 12px; }
        .dl { display: grid; grid-template-columns: 120px 1fr; gap: 8px 12px; margin: 0; }
        .dl dt { color: var(--ink-soft); font-size: .88rem; } .dl dd { margin: 0; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
        @media (max-width: 720px) { .grid2 { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}
