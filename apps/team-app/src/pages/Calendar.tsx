import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, fin, enrichPlacements, applicantInfo } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import PageHead from '../components/PageHead';
import Dialog from '../components/Dialog';
import { Msg } from '../components/Msg';

// סוגי אירוע + צבע. הגוונים בטווח בינוני כדי לעבוד גם בבהיר וגם בכהה.
const KIND: Record<string, { label: string; c: string }> = {
  interview:       { label: 'ראיון',       c: '#2563eb' },
  task:            { label: 'משימה',       c: '#7c3aed' },
  placement_start: { label: 'תחילת עבודה', c: '#0f766e' },
  warranty_end:    { label: 'סיום אחריות', c: '#b45309' },
  payment_due:     { label: 'מועד תשלום',  c: '#be123c' },
  meeting:         { label: 'פגישה',       c: '#0891b2' },
  call:            { label: 'שיחה',        c: '#0d9488' },
  reminder:        { label: 'תזכורת',      c: '#ca8a04' },
  deadline:        { label: 'דדליין',      c: '#dc2626' },
  personal:        { label: 'אישי',        c: '#9333ea' },
  general:         { label: 'כללי',        c: '#4b5563' },
};
// הסוגים שאפשר לבחור לאירוע ידני (תואם לאילוץ ב-0034).
const MANUAL_KINDS = ['general','meeting','call','reminder','deadline','personal'] as const;

const WEEKDAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
const monthLabel = (d: Date) => d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
const dayLabel = (key: string) => {
  const [y,m,dd] = key.split('-').map(Number);
  return new Date(y, m-1, dd).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
};

interface Ev { key: string; day: string; time: string | null; kind: string; title: string; sub?: string | null; to?: string | null; editable?: boolean; raw?: any }

interface FormState { id?: string; owner_id?: string; title: string; kind: string; date: string; time: string; all_day: boolean; location: string; notes: string }
const emptyForm = (day: string): FormState => ({ title:'', kind:'meeting', date: day, time:'09:00', all_day:false, location:'', notes:'' });

export default function Calendar() {
  const { employee } = useAuth();
  const empId = employee?.id;
  const isMgr = employee?.role === 'manager' || employee?.role === 'superadmin';

  const today = ymd(new Date());
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [events, setEvents] = useState<Ev[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(today);
  const [dlg, setDlg] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(today));
  const [busy, setBusy] = useState(false);

  // גריד של 6 שבועות שמתחיל ביום ראשון.
  const days = useMemo(() => {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(monthStart); start.setDate(1 - monthStart.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  async function load() {
    if (!empId) return;
    setLoading(true); setErr('');
    const gridStart = days[0], gridEnd = days[days.length - 1];
    const startIso = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate(), 0, 0, 0).toISOString();
    const endIso = new Date(gridEnd.getFullYear(), gridEnd.getMonth(), gridEnd.getDate(), 23, 59, 59).toISOString();
    const startDay = ymd(gridStart), endDay = ymd(gridEnd);
    const inWindow = (day: string) => day >= startDay && day <= endDay;

    try {
      // אירועים ידניים — RLS מסנן אוטומטית (מגייס את שלו, מנהלת הכול).
      const manualQ = supabase.from('calendar_events')
        .select('id, owner_id, title, kind, starts_at, all_day, location, notes, candidate_id, company_id, job_id, application_id')
        .gte('starts_at', startIso).lte('starts_at', endIso);

      // ראיונות — מסננים לפי המגייס של המועמדות כשאינו מנהלת.
      let ivQ = supabase.from('interviews')
        .select('id, scheduled_at, status, application_id, applications!inner(recruiter_id)')
        .neq('status', 'cancelled').gte('scheduled_at', startIso).lte('scheduled_at', endIso);
      if (!isMgr) ivQ = ivQ.eq('applications.recruiter_id', empId);

      // משימות עם מועד — היקף "שלי" למגייס, "הכול" למנהלת.
      let tkQ = supabase.from('tasks')
        .select(isMgr ? 'id, title, due_at, status' : 'id, title, due_at, status, task_assignees!inner(employee_id)')
        .not('due_at', 'is', null).neq('status', 'cancelled').neq('status', 'done')
        .gte('due_at', startIso).lte('due_at', endIso);
      if (!isMgr) tkQ = (tkQ as any).eq('task_assignees.employee_id', empId);

      // השמות (תחילת עבודה + סיום אחריות) — RLS של finance מסנן לפי המגייס.
      const plQ = fin.from('placements')
        .select('id, expected_start_date, verified_start_date, warranty_ends_on, status, application_id, company_id')
        .in('status', ['pending_start','working_warranty','approved']);

      // מועדי תשלום — מתוך תצוגת התזרים (חיובים אמיתיים שטרם שולמו).
      const cfQ = fin.from('cashflow').select('invoice_id, due_date, expected_amount, status, kind, company_id, application_id')
        .gte('due_date', startDay).lte('due_date', endDay);

      const [manual, iv, tk, pl, cf] = await Promise.all([manualQ, ivQ, tkQ, plQ, cfQ]);
      for (const r of [manual, iv, tk, pl, cf]) if (r.error) throw r.error;

      const out: Ev[] = [];

      // ידניים
      for (const e of (manual.data ?? []) as any[]) {
        out.push({
          key: 'm' + e.id, day: ymd(new Date(e.starts_at)), time: e.all_day ? null : hhmm(e.starts_at),
          kind: e.kind, title: e.title, sub: e.location || null,
          to: e.candidate_id ? `/candidates/${e.candidate_id}` : e.application_id ? `/applications/${e.application_id}` : null,
          editable: isMgr || e.owner_id === empId, raw: e,
        });
      }

      // ראיונות — פתרון שם מועמד/משרה לפי application_id
      const ivRows = (iv.data ?? []) as any[];
      const ivInfo = await applicantInfo(ivRows.map(r => r.application_id));
      for (const r of ivRows) {
        const info = ivInfo[r.application_id];
        out.push({ key: 'i' + r.id, day: ymd(new Date(r.scheduled_at)), time: hhmm(r.scheduled_at),
          kind: 'interview', title: info?.candidateName ? `ראיון · ${info.candidateName}` : 'ראיון',
          sub: info?.jobTitle || null, to: `/applications/${r.application_id}` });
      }

      // משימות
      for (const r of (tk.data ?? []) as any[]) {
        out.push({ key: 't' + r.id, day: ymd(new Date(r.due_at)), time: hhmm(r.due_at),
          kind: 'task', title: r.title, to: `/tasks/${r.id}` });
      }

      // השמות
      const plRows = (pl.data ?? []) as any[];
      const plEnriched = await enrichPlacements(plRows);
      for (const p of plEnriched) {
        const startDate: string | null = p.verified_start_date || p.expected_start_date;
        if (startDate && inWindow(startDate)) {
          out.push({ key: 'ps' + p.id, day: startDate, time: null, kind: 'placement_start',
            title: p.candidateName ? `תחילת עבודה · ${p.candidateName}` : 'תחילת עבודה',
            sub: p.companyName || null, to: `/placements/${p.id}` });
        }
        if (p.status === 'working_warranty' && p.warranty_ends_on && inWindow(p.warranty_ends_on)) {
          out.push({ key: 'we' + p.id, day: p.warranty_ends_on, time: null, kind: 'warranty_end',
            title: p.candidateName ? `סיום אחריות · ${p.candidateName}` : 'סיום אחריות',
            sub: p.companyName || null, to: `/placements/${p.id}` });
        }
      }

      // מועדי תשלום
      const cfRows = ((cf.data ?? []) as any[]).filter(r => r.kind === 'invoiced' && r.status !== 'paid');
      const cfEnriched = await enrichPlacements(cfRows);
      for (const r of cfEnriched) {
        out.push({ key: 'pd' + (r.invoice_id ?? r.due_date), day: r.due_date, time: null, kind: 'payment_due',
          title: r.companyName ? `תשלום · ${r.companyName}` : 'מועד תשלום', sub: r.candidateName || null });
      }

      setEvents(out);
    } catch (e: any) {
      setErr(e?.message || 'טעינת היומן נכשלה.');
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [cursor, empId, isMgr]);

  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of events) { const a = m.get(e.day) ?? []; a.push(e); m.set(e.day, a); }
    for (const a of m.values()) a.sort((x, y) => (x.time ?? '') < (y.time ?? '') ? -1 : 1);
    return m;
  }, [events]);

  const selectedEvents = byDay.get(selected) ?? [];

  function openNew(day: string) { setForm(emptyForm(day)); setErr(''); setDlg(true); }
  function openEdit(e: Ev) {
    const r = e.raw;
    const d = new Date(r.starts_at);
    setForm({ id: r.id, owner_id: r.owner_id, title: r.title, kind: r.kind, date: ymd(d),
      time: r.all_day ? '09:00' : `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
      all_day: r.all_day, location: r.location || '', notes: r.notes || '' });
    setErr(''); setDlg(true);
  }

  async function save() {
    if (!form.title.trim()) { setErr('יש להזין כותרת.'); return; }
    setBusy(true); setErr('');
    const [y,m,dd] = form.date.split('-').map(Number);
    const [hh,mm] = (form.all_day ? '00:00' : form.time || '09:00').split(':').map(Number);
    const startsAt = new Date(y, m-1, dd, hh, mm).toISOString();
    const payload: any = { title: form.title.trim(), kind: form.kind, starts_at: startsAt,
      all_day: form.all_day, location: form.location.trim() || null, notes: form.notes.trim() || null };
    let error;
    if (form.id) ({ error } = await supabase.from('calendar_events').update(payload).eq('id', form.id));
    else ({ error } = await supabase.from('calendar_events').insert({ ...payload, owner_id: empId, created_by: empId }));
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDlg(false); setSelected(form.date); load();
  }
  async function remove() {
    if (!form.id) return;
    if (!confirm('למחוק את האירוע?')) return;
    setBusy(true);
    const { error } = await supabase.from('calendar_events').delete().eq('id', form.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDlg(false); load();
  }

  const setF = (k: keyof FormState, v: any) => setForm(s => ({ ...s, [k]: v }));

  return (
    <>
      <PageHead title="לוח שנה" sub={isMgr ? 'ראיונות, משימות, השמות, תשלומים ואירועים' : 'הראיונות, המשימות וההשמות שלי'} />

      <div className="cal-bar">
        <div className="cal-nav">
          <button className="btn btn-quiet btn-sm" aria-label="חודש קודם" onClick={()=>setCursor(c=>new Date(c.getFullYear(), c.getMonth()-1, 1))}>‹</button>
          <strong className="cal-month">{monthLabel(cursor)}</strong>
          <button className="btn btn-quiet btn-sm" aria-label="חודש הבא" onClick={()=>setCursor(c=>new Date(c.getFullYear(), c.getMonth()+1, 1))}>›</button>
          <button className="btn btn-quiet btn-sm" onClick={()=>{ const d=new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(ymd(d)); }}>היום</button>
        </div>
        <button className="btn btn-primary btn-sm" onClick={()=>openNew(selected)}>אירוע חדש</button>
      </div>

      {err && !dlg && <Msg kind="err">{err}</Msg>}

      <div className="cal-grid card" aria-busy={loading}>
        {WEEKDAYS.map(w => <div key={w} className="cal-wd">{w}</div>)}
        {days.map(d => {
          const key = ymd(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const list = byDay.get(key) ?? [];
          return (
            <button key={key} type="button"
              className={'cal-cell' + (inMonth ? '' : ' out') + (key===today ? ' today' : '') + (key===selected ? ' sel' : '')}
              onClick={()=>setSelected(key)} onDoubleClick={()=>openNew(key)}>
              <span className="cal-dn">{d.getDate()}</span>
              <span className="cal-dots">
                {list.slice(0,4).map(e => <span key={e.key} className="cal-chip" style={{ background: KIND[e.kind]?.c ?? '#4b5563' }} title={e.title}>
                  {e.time ? <b>{e.time}</b> : null}{e.title}
                </span>)}
                {list.length > 4 && <span className="cal-more">+{list.length-4}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="cal-legend">
        {Object.entries(KIND).map(([k,v]) => <span key={k} className="lg"><i style={{ background:v.c }} />{v.label}</span>)}
      </div>

      <div className="card cal-agenda">
        <div className="cal-agenda-h">
          <strong>{dayLabel(selected)}</strong>
          <button className="btn btn-quiet btn-sm" onClick={()=>openNew(selected)}>הוספה ליום זה</button>
        </div>
        {selectedEvents.length === 0
          ? <p className="empty">אין אירועים ביום זה.</p>
          : <ul className="cal-list">
              {selectedEvents.map(e => (
                <li key={e.key}>
                  <span className="cal-time">{e.time ?? 'כל היום'}</span>
                  <i className="cal-k" style={{ background: KIND[e.kind]?.c ?? '#4b5563' }} />
                  <span className="cal-body">
                    {e.to ? <Link to={e.to} className="cal-title">{e.title}</Link> : <span className="cal-title">{e.title}</span>}
                    {e.sub && <span className="hint"> · {e.sub}</span>}
                    <span className="cal-kind">{KIND[e.kind]?.label ?? e.kind}</span>
                  </span>
                  {e.editable && <button className="btn btn-quiet btn-sm" onClick={()=>openEdit(e)}>עריכה</button>}
                </li>
              ))}
            </ul>}
      </div>

      <Dialog open={dlg} title={form.id ? 'עריכת אירוע' : 'אירוע חדש'} onClose={()=>setDlg(false)} onSubmit={save}
        footer={<>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          {form.id && <button className="btn btn-quiet" type="button" onClick={remove} disabled={busy}>מחיקה</button>}
          <button className="btn btn-quiet" type="button" onClick={()=>setDlg(false)}>ביטול</button>
        </>}>
        <label><span className="lbl">כותרת</span>
          <input value={form.title} onChange={e=>setF('title', e.target.value)} required autoFocus /></label>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
          <label><span className="lbl">תאריך</span>
            <input type="date" value={form.date} onChange={e=>setF('date', e.target.value)} required /></label>
          <label><span className="lbl">שעה</span>
            <input type="time" value={form.time} onChange={e=>setF('time', e.target.value)} disabled={form.all_day} /></label>
        </div>
        <label style={{ display:'flex', gap:8, alignItems:'center', flexDirection:'row' }}>
          <input type="checkbox" checked={form.all_day} onChange={e=>setF('all_day', e.target.checked)} style={{ width:'auto' }} />
          <span className="lbl" style={{ margin:0 }}>אירוע ליום שלם</span></label>
        <label><span className="lbl">סוג</span>
          <select value={form.kind} onChange={e=>setF('kind', e.target.value)}>
            {MANUAL_KINDS.map(k => <option key={k} value={k}>{KIND[k].label}</option>)}
          </select></label>
        <label><span className="lbl">מיקום (לא חובה)</span>
          <input value={form.location} onChange={e=>setF('location', e.target.value)} /></label>
        <label><span className="lbl">הערות (לא חובה)</span>
          <textarea value={form.notes} onChange={e=>setF('notes', e.target.value)} rows={3} /></label>
        <Msg kind="err">{err}</Msg>
      </Dialog>

      <style>{`
        .cal-bar { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:14px; flex-wrap:wrap; }
        .cal-nav { display:flex; align-items:center; gap:8px; }
        .cal-month { font-size:1.1rem; min-width:8ch; text-align:center; }
        .cal-grid { display:grid; grid-template-columns:repeat(7,1fr); gap:1px; background:var(--line); padding:0; overflow:hidden; }
        .cal-wd { background:var(--sunk); padding:8px 6px; text-align:center; font-weight:700; font-size:.82rem; color:var(--ink-mid); }
        .cal-cell { background:var(--card); min-height:96px; padding:6px; display:flex; flex-direction:column; gap:4px; align-items:stretch; text-align:start; border:none; cursor:pointer; font:inherit; color:inherit; }
        .cal-cell.out { background:var(--sunk); color:var(--ink-mid); }
        .cal-cell.today .cal-dn { background:var(--brand); color:#fff; border-radius:999px; }
        .cal-cell.sel { outline:2px solid var(--brand); outline-offset:-2px; }
        .cal-dn { align-self:flex-start; min-width:1.6rem; height:1.6rem; display:grid; place-items:center; font-weight:700; font-size:.85rem; }
        .cal-dots { display:flex; flex-direction:column; gap:3px; overflow:hidden; }
        .cal-chip { color:#fff; border-radius:6px; padding:1px 6px; font-size:.72rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .cal-chip b { font-weight:700; margin-inline-end:4px; }
        .cal-more { font-size:.72rem; color:var(--ink-mid); font-weight:600; }
        .cal-legend { display:flex; gap:12px; flex-wrap:wrap; margin:12px 2px; }
        .cal-legend .lg { display:flex; align-items:center; gap:6px; font-size:.8rem; color:var(--ink-mid); }
        .cal-legend i, .cal-k { width:11px; height:11px; border-radius:3px; display:inline-block; flex:0 0 auto; }
        .cal-agenda { margin-top:4px; }
        .cal-agenda-h { display:flex; justify-content:space-between; align-items:center; padding:14px 16px; border-bottom:1px solid var(--line); }
        .cal-list { list-style:none; margin:0; padding:0; }
        .cal-list li { display:flex; align-items:center; gap:10px; padding:11px 16px; border-bottom:1px solid var(--line); }
        .cal-list li:last-child { border-bottom:none; }
        .cal-time { min-width:5.5ch; font-variant-numeric:tabular-nums; font-weight:600; font-size:.85rem; color:var(--ink-mid); }
        .cal-body { flex:1; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .cal-title { font-weight:600; }
        .cal-kind { font-size:.72rem; color:var(--ink-mid); background:var(--sunk); border-radius:999px; padding:1px 8px; }
        @media (max-width:640px) {
          .cal-cell { min-height:72px; }
          .cal-chip { font-size:.68rem; }
          .cal-chip b { display:none; }
        }
      `}</style>
    </>
  );
}
