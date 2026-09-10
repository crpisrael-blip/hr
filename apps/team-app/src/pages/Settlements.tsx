import { useEffect, useState, type FormEvent } from 'react';
import { supabase, fin, enrichPlacements, applicantInfo, employeeNames } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { money, formatDate, PLACEMENT_STATUS } from '../lib/format';
import PageHead from '../components/PageHead';

const METRIC: Record<string,string> = { placements_count: 'מספר השמות', commission_sum: 'סכום עמלות' };
const BSTATUS: Record<string,string> = { draft:'טיוטה', review:'לבדיקה', approved:'מאושר', paid:'שולם' };

export default function Settlements() {
  const { employee } = useAuth();
  const isMgr = employee?.role === 'manager' || employee?.role === 'superadmin';
  const [section, setSection] = useState<'settlements'>('settlements');
  const [tab, setTab] = useState<'monthly'|'plans'|'clawbacks'>('monthly');
  const [emps, setEmps] = useState<any[]>([]);
  useEffect(() => { supabase.from('employees').select('id, full_name').eq('employment_status','active').order('full_name').then(r=>{ if(!r.error) setEmps(r.data); }); }, []);

  if (!isMgr) return <><PageHead title="כספים" /><p className="msg err">מסך הכספים פתוח למנהלת בלבד.</p></>;

  return (
    <>
      <PageHead title="כספים" sub="התחשבנות, חיובים ותקבולים" />
      <div className="submenu">
        <button className={section==='settlements'?'on':''} onClick={()=>setSection('settlements')}>התחשבנות</button>
        <button className="soon" disabled title="בקרוב">חיובים</button>
        <button className="soon" disabled title="בקרוב">תקבולים</button>
      </div>
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
        .submenu { display:flex; gap:6px; margin-bottom:14px; }
        .submenu button { background:var(--sunk); border:1px solid var(--line); border-radius:999px; padding:7px 16px; cursor:pointer; color:var(--ink-mid); font-weight:600; font-size:.9rem; }
        .submenu button.on { background:var(--brand); color:#fff; border-color:var(--brand); }
        .submenu button.soon { opacity:.5; cursor:default; }
        .tabs { display:flex; gap:4px; margin-bottom:16px; border-bottom:1px solid var(--line); }
        .tabs button { background:none; border:none; padding:10px 14px; cursor:pointer; color:var(--ink-mid); font-weight:600; border-bottom:2px solid transparent; }
        .tabs button.on { color:var(--brand-ink); border-bottom-color:var(--accent); }
        .bar { display:flex; gap:10px; flex-wrap:wrap; align-items:end; margin-bottom:16px; }
        .bar label { display:grid; gap:5px; }
        .bar .lbl { font-size:.82rem; font-weight:600; }
      `}</style>
    </>
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
