import { useEffect, useState, type FormEvent } from 'react';
import { supabase, fin, enrichPlacements, applicantInfo, employeeNames } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { money, moneyRound, formatDate, PLACEMENT_STATUS, INVOICE_STATUS } from '../lib/format';
import PageHead from '../components/PageHead';

const METRIC: Record<string,string> = { placements_count: 'מספר השמות', commission_sum: 'סכום עמלות' };
const BSTATUS: Record<string,string> = { draft:'טיוטה', review:'לבדיקה', approved:'מאושר', paid:'שולם' };

// תווית חודש בעברית מתוך ערך תאריך "YYYY-MM-DD" של התצוגה.
const monthLabel = (m: string) => {
  const d = new Date(m.length === 7 ? m + '-01' : m);
  return Number.isNaN(d.getTime()) ? m : d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
};
// גוון תגית לפי מצב חיוב.
const invTone = (s: string) => s === 'paid' ? 'ok' : s === 'partially_paid' ? 'warn' : s === 'projected' ? 'mute' : 'brand';

export default function Settlements() {
  const { employee } = useAuth();
  const isMgr = employee?.role === 'manager' || employee?.role === 'superadmin';
  const [section, setSection] = useState<'cashflow'|'billing'|'settlements'>('cashflow');
  const [tab, setTab] = useState<'monthly'|'plans'|'clawbacks'>('monthly');
  const [emps, setEmps] = useState<any[]>([]);
  useEffect(() => { supabase.from('employees').select('id, full_name').eq('employment_status','active').order('full_name').then(r=>{ if(!r.error) setEmps(r.data); }); }, []);

  if (!isMgr) return <><PageHead title="כספים" /><p className="msg err">מסך הכספים פתוח למנהלת בלבד.</p></>;

  return (
    <>
      <PageHead title="כספים" sub="תזרים, חיובים, תקבולים והתחשבנות" />
      <div className="submenu">
        <button className={section==='cashflow'?'on':''} onClick={()=>setSection('cashflow')}>תזרים</button>
        <button className={section==='billing'?'on':''} onClick={()=>setSection('billing')}>חיובים ותקבולים</button>
        <button className={section==='settlements'?'on':''} onClick={()=>setSection('settlements')}>התחשבנות</button>
      </div>

      {section==='cashflow' && <Cashflow />}
      {section==='billing' && <Billing />}

      {section==='settlements' && <>
      <div className="tabs">
        <button className={tab==='monthly'?'on':''} onClick={()=>setTab('monthly')}>בונוס חודשי</button>
        <button className={tab==='plans'?'on':''} onClick={()=>setTab('plans')}>תוכניות תגמול</button>
        <button className={tab==='clawbacks'?'on':''} onClick={()=>setTab('clawbacks')}>קיזוזים</button>
      </div>
      {tab==='monthly' && <Monthly emps={emps} />}
      {tab==='plans' && <Plans emps={emps} />}
      {tab==='clawbacks' && <Clawbacks />}
      </>}

      <style>{`
        .submenu { display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; }
        .submenu button { background:var(--sunk); border:1px solid var(--line); border-radius:999px; padding:7px 16px; cursor:pointer; color:var(--ink-mid); font-weight:600; font-size:.9rem; }
        .submenu button.on { background:var(--brand); color:#fff; border-color:var(--brand); }
        .bar { display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin-bottom:16px; }
        .bar label { display:grid; gap:5px; }
        .bar .lbl { font-size:.82rem; font-weight:600; }
        .tiles { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
        .tile { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:14px 16px; display:grid; gap:4px; }
        .tile .t-lbl { font-size:.82rem; color:var(--ink-mid); font-weight:600; }
        .tile strong { font-size:1.35rem; }
        .tile.ok { border-color:color-mix(in srgb, var(--ok, #1a7f5a) 45%, var(--line)); }
        .tile.warn { border-color:color-mix(in srgb, var(--warn, #b45309) 45%, var(--line)); }
        .card-h { padding:14px 16px; font-weight:700; border-bottom:1px solid var(--line); }
        td.num.ok, .num.ok { color:var(--ok, #1a7f5a); }
      `}</style>
    </>
  );
}

// ---------------------------------------------------------------- תזרים
// מרגע ההשמה מופיעה הכנסתה הצפויה; עם אישור ההשמה התזרים נשען על חיובים
// אמיתיים ועל סכום התקבול בפועל; השמה שנכשלה יוצאת מהתזרים.
function Cashflow() {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(false);
  const [scopeAll, setScopeAll] = useState(false);
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });

  async function load() {
    setLoading(true); setErr('');
    const r = await fin.from('cashflow').select('*');
    if (r.error) { setErr(r.error.message); setLoading(false); return; }
    setRows(await enrichPlacements(r.data as any[]));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const monthKey = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}-01`;
  const scoped = scopeAll ? rows : rows.filter(r => r.month === monthKey);

  const totalExpected = scoped.reduce((s,r)=>s+Number(r.expected_amount),0);
  const totalReceived = scoped.reduce((s,r)=>s+Number(r.received_amount),0);

  const byMonth = new Map<string, { expected:number; received:number }>();
  for (const r of rows) {
    const m = byMonth.get(r.month) ?? { expected:0, received:0 };
    m.expected += Number(r.expected_amount); m.received += Number(r.received_amount);
    byMonth.set(r.month, m);
  }
  const months = [...byMonth.entries()].sort((a,b)=> a[0] < b[0] ? -1 : 1);
  const detailRows = scoped.slice().sort((a,b)=> a.due_date < b.due_date ? -1 : 1);

  const detailTable = (
    <div className="card" style={{ overflow:'hidden' }}>
      <table>
        <thead><tr><th>מועמד</th><th>לקוח</th><th>תשלום</th><th>מועד</th><th>סכום</th><th>התקבל</th><th>מצב</th></tr></thead>
        <tbody>{detailRows.map((r,i) => (
          <tr key={(r.invoice_id ?? 'p') + '-' + r.placement_id + '-' + r.seq + '-' + i}>
            <td style={{ fontWeight:600 }}>{r.candidateName ?? '—'}</td>
            <td>{r.companyName ?? '—'}</td>
            <td className="num">{r.seq}</td>
            <td className="num">{formatDate(r.due_date)}</td>
            <td className="num">{money(Number(r.expected_amount))}</td>
            <td className="num ok">{Number(r.received_amount) > 0 ? money(Number(r.received_amount)) : '—'}</td>
            <td>{r.kind === 'projected'
              ? <span className="tag mute">צפוי</span>
              : <span className={'tag ' + invTone(r.status)}>{INVOICE_STATUS[r.status] ?? r.status}</span>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );

  return (
    <div style={{ display:'grid', gap:16 }}>
      {err && <p className="msg err">{err}</p>}

      {/* ניווט בין חודשים בתוך התזרים */}
      <div className="cf-nav">
        <div className="cf-months">
          <button className="btn btn-quiet btn-sm" aria-label="חודש קודם" disabled={scopeAll}
            onClick={()=>setCur(c=>new Date(c.getFullYear(), c.getMonth()-1, 1))}>‹</button>
          <strong className="cf-lbl">{scopeAll ? 'כל החודשים' : monthLabel(monthKey)}</strong>
          <button className="btn btn-quiet btn-sm" aria-label="חודש הבא" disabled={scopeAll}
            onClick={()=>setCur(c=>new Date(c.getFullYear(), c.getMonth()+1, 1))}>›</button>
          {!scopeAll && <button className="btn btn-quiet btn-sm" onClick={()=>{ const d=new Date(); setCur(new Date(d.getFullYear(), d.getMonth(), 1)); }}>החודש</button>}
        </div>
        <button className={'btn btn-sm ' + (scopeAll ? 'btn-primary' : 'btn-quiet')} onClick={()=>setScopeAll(a=>!a)}>
          {scopeAll ? 'תצוגת חודש' : 'כל החודשים'}
        </button>
      </div>

      <div className="tiles">
        <div className="tile"><span className="t-lbl">צפוי לגבייה{scopeAll ? '' : ' · החודש'}</span><strong>{moneyRound(totalExpected)}</strong></div>
        <div className="tile ok"><span className="t-lbl">התקבל בפועל</span><strong>{moneyRound(totalReceived)}</strong></div>
        <div className="tile warn"><span className="t-lbl">נותר פתוח</span><strong>{moneyRound(totalExpected - totalReceived)}</strong></div>
      </div>

      {loading ? <div className="card empty">טוען…</div> :
       rows.length === 0 ? <div className="card empty">אין הכנסות בתזרים כרגע. הכנסת השמה פעילה מופיעה כאן מרגע יצירתה.</div> :
       scopeAll ? (
        <>
          <div className="card" style={{ overflow:'hidden' }}>
            <div className="card-h">תזרים לפי חודש</div>
            <table>
              <thead><tr><th>חודש</th><th>צפוי</th><th>התקבל</th><th>פתוח</th></tr></thead>
              <tbody>{months.map(([m,v]) => (
                <tr key={m} className={m === monthKey ? 'cf-cur' : ''}>
                  <td><button className="cf-mbtn" onClick={()=>{ const [y,mm]=m.split('-').map(Number); setCur(new Date(y, mm-1, 1)); setScopeAll(false); }}>{monthLabel(m)}</button></td>
                  <td className="num">{money(v.expected)}</td>
                  <td className="num ok">{v.received > 0 ? money(v.received) : '—'}</td>
                  <td className="num">{money(v.expected - v.received)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <button className="btn btn-quiet btn-sm" style={{ justifySelf:'start' }} onClick={()=>setDetail(d=>!d)}>
            {detail ? 'הסתרת פירוט' : 'פירוט לפי השמה'}
          </button>
          {detail && detailTable}
        </>
      ) : (
        detailRows.length === 0
          ? <div className="card empty">אין תנועות בחודש זה. נווטו לחודש אחר או עברו ל"כל החודשים".</div>
          : detailTable
      )}

      <style>{`
        .cf-nav { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
        .cf-months { display:flex; align-items:center; gap:8px; }
        .cf-lbl { min-width:9ch; text-align:center; }
        .cf-mbtn { background:none; border:none; padding:0; color:var(--brand); font:inherit; font-weight:600; cursor:pointer; }
        tr.cf-cur { background:var(--sunk); }
      `}</style>
    </div>
  );
}

// ------------------------------------------------------ חיובים ותקבולים
// רשימת החיובים האמיתיים (מלוח התשלומים של ההשמות שאושרו) עם אישור קבלת תשלום
// כשמגיע מועדו. אישור תקבול רושם תקבול ומעדכן את מצב החיוב (שולם / שולם חלקית).
function Billing() {
  const [rows, setRows] = useState<any[]>([]);
  const [err, setErr] = useState(''); const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true); setErr('');
    const inv = await fin.from('invoices').select('*').neq('status','cancelled').order('due_date');
    if (inv.error) { setErr(inv.error.message); setLoading(false); return; }
    const invoices = inv.data as any[];

    const schedIds = [...new Set(invoices.map(i => i.schedule_id))];
    const scheds = schedIds.length ? await fin.from('payment_schedules').select('id, placement_id').in('id', schedIds) : { data: [] as any[] };
    const schToPl: Record<string,string> = Object.fromEntries(((scheds.data ?? []) as any[]).map(s => [s.id, s.placement_id]));

    const plIds = [...new Set(Object.values(schToPl))];
    const pls = plIds.length ? await fin.from('placements').select('id, company_id, application_id, status').in('id', plIds) : { data: [] as any[] };
    const enriched = await enrichPlacements((pls.data ?? []) as any[]);
    const plMap: Record<string,any> = Object.fromEntries(enriched.map(p => [p.id, p]));

    const invIds = invoices.map(i => i.id);
    const allocs = invIds.length ? await fin.from('receipt_allocations').select('invoice_id, amount').in('invoice_id', invIds) : { data: [] as any[] };
    const recvBy: Record<string,number> = {};
    for (const a of (allocs.data ?? []) as any[]) recvBy[a.invoice_id] = (recvBy[a.invoice_id] ?? 0) + Number(a.amount);

    setRows(invoices.map(i => {
      const pl = plMap[schToPl[i.schedule_id]];
      const received = recvBy[i.id] ?? 0;
      return { ...i, _cand: pl?.candidateName ?? null, _co: pl?.companyName ?? null,
        _plStatus: pl?.status ?? null, _received: received, _remaining: Number(i.amount) - received };
    }));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function confirm(inv: any) {
    const amtStr = prompt(`סכום שהתקבל (יתרה לתשלום: ${inv._remaining}):`, String(inv._remaining));
    if (amtStr === null) return;
    const amount = Number(amtStr);
    if (!Number.isFinite(amount) || amount <= 0) { setErr('סכום התקבול אינו תקין.'); return; }
    const received = prompt('תאריך קבלה (YYYY-MM-DD):', new Date().toISOString().slice(0,10));
    if (received === null) return;
    const method = prompt('אמצעי תשלום (לא חובה):', 'העברה בנקאית') || null;
    const { error } = await supabase.rpc('confirm_invoice_receipt',
      { p_invoice: inv.id, p_amount: amount, p_received: received, p_method: method, p_ref: null });
    if (error) setErr(error.message); else { setErr(''); load(); }
  }
  async function issue(inv: any) {
    const { error } = await supabase.rpc('issue_invoice', { p_invoice: inv.id, p_external_ref: null });
    if (error) setErr(error.message); else { setErr(''); load(); }
  }

  return (
    <div style={{ display:'grid', gap:16 }}>
      {err && <p className="msg err">{err}</p>}
      {loading ? <div className="card empty">טוען…</div> :
       rows.length === 0 ? <div className="card empty">אין חיובים. חיובים נוצרים עם אישור השמה (לפי לוח התשלומים בהסכם).</div> : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table>
            <thead><tr><th>מועמד</th><th>לקוח</th><th>תשלום</th><th>מועד פירעון</th><th>סכום</th><th>התקבל</th><th>מצב</th><th></th></tr></thead>
            <tbody>{rows.map(inv => (
              <tr key={inv.id}>
                <td style={{ fontWeight:600 }}>{inv._cand ?? '—'}</td>
                <td>{inv._co ?? '—'}</td>
                <td className="num">{inv.seq}</td>
                <td className="num">{formatDate(inv.due_date)}</td>
                <td className="num">{money(Number(inv.amount))}</td>
                <td className="num ok">{inv._received > 0 ? money(inv._received) : '—'}</td>
                <td><span className={'tag ' + invTone(inv.status)}>{INVOICE_STATUS[inv.status] ?? inv.status}</span></td>
                <td>
                  <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                    {inv.status === 'planned' && <button className="btn btn-quiet btn-sm" onClick={()=>issue(inv)}>הפקה</button>}
                    {inv.status !== 'paid' && <button className="btn btn-primary btn-sm" onClick={()=>confirm(inv)}>אישור קבלה</button>}
                    {inv.status === 'paid' && <span className="tag ok">שולם</span>}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Monthly({ emps }: { emps: any[] }) {
  const [emp, setEmp] = useState(''); const [month, setMonth] = useState(new Date().toISOString().slice(0,7));
  const [calc, setCalc] = useState<any>(null); const [lines, setLines] = useState<any[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  async function loadCalc() {
    if (!emp) return;
    const m0 = month + '-01';
    const c = await fin.from('bonus_calculations').select('*').eq('employee_id', emp).eq('period_month', m0).maybeSingle();
    setCalc(c.data ?? null);
    if (c.data) {
      const l = await fin.from('bonus_calculation_lines').select('*').eq('calculation_id', c.data.id);
      if (!l.error) {
        const rows = l.data as any[];
        // פתרון שם מועמד לכל שורה לפי ההשמה (חוצה-סכמה).
        const plIds = [...new Set(rows.map(x => x.placement_id).filter(Boolean))];
        let nameByPl: Record<string, string | null> = {};
        if (plIds.length) {
          const pls = await fin.from('placements').select('id, application_id').in('id', plIds);
          const appInfo = await applicantInfo((pls.data || []).map((p: any) => p.application_id));
          const plApp = Object.fromEntries((pls.data || []).map((p: any) => [p.id, p.application_id]));
          nameByPl = Object.fromEntries(plIds.map(id => [id, appInfo[plApp[id]]?.candidateName ?? null]));
        }
        setLines(rows.map(x => ({ ...x, _cand: x.placement_id ? nameByPl[x.placement_id] : null })));
      }
    } else setLines([]);
  }
  useEffect(() => { loadCalc(); }, [emp, month]);

  async function compute() {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('compute_monthly_bonus', { p_employee: emp, p_month: month + '-01' });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    loadCalc();
  }
  async function setStatus(s: string) {
    const { error } = await supabase.rpc('set_bonus_status', { p_calc: calc.id, p_status: s });
    if (error) setErr(error.message); else loadCalc();
  }

  return (
    <div>
      <div className="bar">
        <label><span className="lbl">מגייס</span><select value={emp} onChange={e=>setEmp(e.target.value)}><option value="">בחרו…</option>{emps.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
        <label><span className="lbl">חודש</span><input type="month" value={month} onChange={e=>setMonth(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={!emp || busy} onClick={compute}>{busy?'מחשב…':'חשב / רענן'}</button>
      </div>
      {err && <p className="msg err">{err}</p>}
      {!emp && <div className="card empty">בחרו מגייס וחודש כדי לחשב בונוס.</div>}
      {emp && !calc && <div className="card empty">אין עדיין חישוב לחודש זה. לחצו "חשב".</div>}
      {calc && (
        <div className="card" style={{ overflow:'hidden' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 16px', flexWrap:'wrap', gap:10 }}>
            <div>סך בונוס: <strong style={{ fontSize:'1.2rem' }}>{money(Number(calc.total_amount))}</strong>
              <span className="hint"> · מדד: {Number(calc.metric_value)}</span></div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <span className="tag brand">{BSTATUS[calc.status]}</span>
              {calc.status==='draft' && <button className="btn btn-quiet btn-sm" onClick={()=>setStatus('review')}>לבדיקה</button>}
              {calc.status==='review' && <button className="btn btn-primary btn-sm" onClick={()=>setStatus('approved')}>אישור</button>}
              {calc.status==='approved' && <button className="btn btn-primary btn-sm" onClick={()=>setStatus('paid')}>סימון שולם</button>}
            </div>
          </div>
          <table>
            <thead><tr><th>מקור</th><th>מדרגה</th><th>אחוז</th><th>בסיס</th><th>סכום</th></tr></thead>
            <tbody>{lines.map(l=>(
              <tr key={l.id}>
                <td>{l.placement_id ? (l._cand ?? 'השמה') : (l.note ?? 'קיזוז')}</td>
                <td className="num">{l.tier ?? '—'}</td><td className="num">{l.pct != null ? l.pct+'%' : '—'}</td>
                <td className="num">{l.expected_commission != null ? money(Number(l.expected_commission)) : '—'}</td>
                <td className="num" style={{ color: Number(l.amount)<0 ? 'var(--warn)' : 'inherit' }}>{money(Number(l.amount))}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Plans({ emps }: { emps: any[] }) {
  const [rows, setRows] = useState<any[]>([]);
  const [f, setF] = useState({ employee_id:'', metric:'placements_count', target_a:'2', target_b:'4', pct_tier_1:'5', pct_tier_2:'8' });
  const [err, setErr] = useState('');
  const set=(k:string,v:string)=>setF(s=>({...s,[k]:v}));
  const empMap = Object.fromEntries(emps.map(e=>[e.id, e.full_name]));
  async function load(){ const r=await fin.from('bonus_plans').select('*').order('valid_from',{ascending:false}); if(!r.error) setRows(r.data); }
  useEffect(()=>{ load(); },[]);
  async function add(e: FormEvent){
    e.preventDefault(); setErr('');
    const existing = rows.filter(r=>r.employee_id===f.employee_id);
    const ver = existing.length ? Math.max(...existing.map(r=>r.version))+1 : 1;
    const { error } = await fin.from('bonus_plans').insert({
      employee_id: f.employee_id, version: ver, metric: f.metric,
      target_a: Number(f.target_a), target_b: Number(f.target_b),
      pct_tier_1: Number(f.pct_tier_1), pct_tier_2: Number(f.pct_tier_2),
      valid_from: new Date().toISOString().slice(0,10),
    });
    if (error) setErr(error.message); else load();
  }
  return (
    <div className="card" style={{ overflow:'hidden' }}>
      <form onSubmit={add} style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr repeat(4,.8fr) auto', gap:10, padding:16, borderBottom:'1px solid var(--line)', alignItems:'end' }}>
        <label><span className="lbl">מגייס</span><select value={f.employee_id} onChange={e=>set('employee_id',e.target.value)} required><option value="">…</option>{emps.map(e=><option key={e.id} value={e.id}>{e.full_name}</option>)}</select></label>
        <label><span className="lbl">מדד</span><select value={f.metric} onChange={e=>set('metric',e.target.value)}><option value="placements_count">מספר השמות</option><option value="commission_sum">סכום עמלות</option></select></label>
        <label><span className="lbl">יעד א׳</span><input type="number" value={f.target_a} onChange={e=>set('target_a',e.target.value)} /></label>
        <label><span className="lbl">יעד ב׳</span><input type="number" value={f.target_b} onChange={e=>set('target_b',e.target.value)} /></label>
        <label><span className="lbl">% מדרגה 1</span><input type="number" step="0.1" value={f.pct_tier_1} onChange={e=>set('pct_tier_1',e.target.value)} /></label>
        <label><span className="lbl">% מדרגה 2</span><input type="number" step="0.1" value={f.pct_tier_2} onChange={e=>set('pct_tier_2',e.target.value)} /></label>
        <button className="btn btn-primary btn-sm" disabled={!f.employee_id}>הוספה</button>
      </form>
      {err && <p className="msg err" style={{ margin:12 }}>{err}</p>}
      <table>
        <thead><tr><th>מגייס</th><th>גרסה</th><th>מדד</th><th>יעדים</th><th>אחוזים</th><th>מתאריך</th></tr></thead>
        <tbody>{rows.map(r=>(
          <tr key={r.id}><td style={{fontWeight:600}}>{empMap[r.employee_id] ?? '—'}</td><td className="num">{r.version}</td>
            <td>{METRIC[r.metric]}</td><td className="num">{r.target_a} / {r.target_b}</td>
            <td className="num">{r.pct_tier_1}% · {r.pct_tier_2}%</td><td className="num">{formatDate(r.valid_from)}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Clawbacks() {
  const [failed, setFailed] = useState<any[]>([]); const [props, setProps] = useState<any[]>([]);
  const [err, setErr] = useState('');
  async function load() {
    const [p, c] = await Promise.all([
      fin.from('placements').select('id, ended_reason, status, expected_commission, application_id')
        .in('status', ['left_in_warranty','not_started','cancelled']),
      fin.from('clawback_proposals').select('*').order('created_at',{ascending:false}),
    ]);
    if (!p.error) setFailed(await enrichPlacements(p.data as any));
    if (!c.error) {
      const cbs = c.data as any[];
      const empMap = await employeeNames(cbs.map(x => x.employee_id));
      const plIds = [...new Set(cbs.map(x => x.placement_id).filter(Boolean))];
      let candByPl: Record<string, string | null> = {};
      if (plIds.length) {
        const pls = await fin.from('placements').select('id, application_id').in('id', plIds);
        const appInfo = await applicantInfo((pls.data || []).map((p: any) => p.application_id));
        const plApp = Object.fromEntries((pls.data || []).map((p: any) => [p.id, p.application_id]));
        candByPl = Object.fromEntries(plIds.map(id => [id, appInfo[plApp[id]]?.candidateName ?? null]));
      }
      setProps(cbs.map(x => ({ ...x, _emp: empMap[x.employee_id] ?? null, _cand: x.placement_id ? candByPl[x.placement_id] : null })));
    }
  }
  useEffect(()=>{ load(); },[]);
  const openFor = (pid: string) => props.find(x=>x.placement_id===pid);

  async function open(pid: string){ const { error } = await supabase.rpc('open_clawback',{ p_placement: pid }); if(error) setErr(error.message); else load(); }
  async function decide(cb: any){
    const treatment = prompt('טיפול: offset / spread / deferred / none', 'offset'); if(!treatment) return;
    const amount = Number(prompt('סכום קיזוז:', String(cb.proposed_amount)) || cb.proposed_amount);
    const spread = treatment==='spread' ? Number(prompt('על פני כמה חודשים?','3')||'1') : null;
    const defer = treatment==='deferred' ? prompt('לדחות עד (YYYY-MM-DD):') : null;
    const reason = prompt('נימוק:') || '';
    const { error } = await supabase.rpc('decide_clawback',{ p_id: cb.id, p_treatment: treatment, p_amount: amount, p_spread_months: spread, p_defer: defer, p_reason: reason });
    if(error) setErr(error.message); else load();
  }

  return (
    <div style={{ display:'grid', gap:16 }}>
      {err && <p className="msg err">{err}</p>}
      <div className="card" style={{ overflow:'hidden' }}>
        <h3 style={{ padding:'14px 16px 6px', fontSize:'1rem' }}>השמות שנכשלו</h3>
        {failed.length===0 ? <p className="empty">אין השמות שנכשלו.</p> : (
          <table><thead><tr><th>מועמד</th><th>מצב</th><th>עמלה צפויה</th><th></th></tr></thead><tbody>
            {failed.map(p=>{ const cb=openFor(p.id); return (
              <tr key={p.id}><td style={{fontWeight:600}}>{p.candidateName ?? '—'}</td>
                <td><span className="tag mute">{PLACEMENT_STATUS[p.status]}</span></td>
                <td className="num">{money(Number(p.expected_commission))}</td>
                <td>{cb ? <span className="tag">{cb.status==='closed'?'טופל':'הצעה פתוחה'}</span> : <button className="btn btn-quiet btn-sm" onClick={()=>open(p.id)}>פתח הצעת קיזוז</button>}</td></tr>
            );})}
          </tbody></table>
        )}
      </div>
      <div className="card" style={{ overflow:'hidden' }}>
        <h3 style={{ padding:'14px 16px 6px', fontSize:'1rem' }}>הצעות קיזוז</h3>
        {props.length===0 ? <p className="empty">אין הצעות קיזוז.</p> : (
          <table><thead><tr><th>מועמד</th><th>מגייס</th><th>מוצע</th><th>מצב</th><th></th></tr></thead><tbody>
            {props.map(cb=>(
              <tr key={cb.id}><td>{cb._cand ?? '—'}</td>
                <td>{cb._emp ?? '—'}</td><td className="num">{money(Number(cb.proposed_amount))}</td>
                <td><span className={'tag '+(cb.status==='closed'?'ok':'warn')}>{cb.status==='open'?'פתוחה':cb.status==='decided'?'הוחלט':'סגורה'}</span></td>
                <td>{cb.status==='open' && <button className="btn btn-primary btn-sm" onClick={()=>decide(cb)}>החלטה</button>}</td></tr>
            ))}
          </tbody></table>
        )}
      </div>
    </div>
  );
}
