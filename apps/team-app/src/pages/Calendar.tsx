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
const MANUAL_KINDS = ['general','meeting','call','reminder','deadline','personal'] as const;
const RSVP: Record<string, { label: string; tone: string }> = {
  pending:  { label: 'ממתין/ה', tone: 'mute' },
  accepted: { label: 'מאשר/ת',  tone: 'ok' },
  declined: { label: 'דוחה',    tone: 'warn' },
};

const WEEKDAYS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
const monthLabel = (d: Date) => d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
const dayLabel = (key: string) => {
  const [y,m,dd] = key.split('-').map(Number);
  return new Date(y, m-1, dd).toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
};

interface Part { employee_id: string; name: string; status: string }
interface Ev {
  key: string; day: string; time: string | null; kind: string; title: string;
  sub?: string | null; to?: string | null; editable?: boolean; raw?: any;
  ownerName?: string | null; location?: string | null; notes?: string | null;
  participants?: Part[]; myStatus?: string | null;
}

interface FormState { id?: string; title: string; kind: string; date: string; time: string; all_day: boolean; location: string; notes: string; participants: string[] }
const emptyForm = (day: string): FormState => ({ title:'', kind:'meeting', date: day, time:'09:00', all_day:false, location:'', notes:'', participants: [] });

export default function Calendar() {
  const { employee } = useAuth();
  const empId = employee?.id;
  const isMgr = employee?.role === 'manager' || employee?.role === 'superadmin';

  const today = ymd(new Date());
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [events, setEvents] = useState<Ev[]>([]);
  const [team, setTeam] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(today);
  const [dlg, setDlg] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(today));
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<Ev | null>(null);

  const days = useMemo(() => {
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start = new Date(monthStart); start.setDate(1 - monthStart.getDay());
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  useEffect(() => {
    supabase.from('employees').select('id, full_name').eq('employment_status','active').order('full_name')
      .then(r => { if (!r.error) setTeam(r.data as any[]); });
  }, []);

  async function load() {
    if (!empId) return;
    setLoading(true); setErr('');
    const gridStart = days[0], gridEnd = days[days.length - 1];
    const startIso = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate(), 0, 0, 0).toISOString();
    const endIso = new Date(gridEnd.getFullYear(), gridEnd.getMonth(), gridEnd.getDate(), 23, 59, 59).toISOString();
    const startDay = ymd(gridStart), endDay = ymd(gridEnd);
    const inWindow = (day: string) => day >= startDay && day <= endDay;

    try {
      const manualQ = supabase.from('calendar_events')
        .select('id, owner_id, title, kind, starts_at, all_day, location, notes, candidate_id, company_id, job_id, application_id')
        .gte('starts_at', startIso).lte('starts_at', endIso);

      let ivQ = supabase.from('interviews')
        .select('id, scheduled_at, status, application_id, applications!inner(recruiter_id)')
        .neq('status', 'cancelled').gte('scheduled_at', startIso).lte('scheduled_at', endIso);
      if (!isMgr) ivQ = ivQ.eq('applications.recruiter_id', empId);

      let tkQ = supabase.from('tasks')
        .select(isMgr ? 'id, title, due_at, status' : 'id, title, due_at, status, task_assignees!inner(employee_id)')
        .not('due_at', 'is', null).neq('status', 'cancelled').neq('status', 'done')
        .gte('due_at', startIso).lte('due_at', endIso);
      if (!isMgr) tkQ = (tkQ as any).eq('task_assignees.employee_id', empId);

      const plQ = fin.from('placements')
        .select('id, expected_start_date, verified_start_date, warranty_ends_on, status, application_id, company_id')
        .in('status', ['pending_start','working_warranty','approved']);

      const cfQ = fin.from('cashflow').select('invoice_id, due_date, expected_amount, status, kind, company_id, application_id')
        .gte('due_date', startDay).lte('due_date', endDay);

      const [manual, iv, tk, pl, cf] = await Promise.all([manualQ, ivQ, tkQ, plQ, cfQ]);
      for (const r of [manual, iv, tk, pl, cf]) if (r.error) throw r.error;

      const out: Ev[] = [];
      const nameOf = (id: string | null | undefined) => team.find(t => t.id === id)?.full_name ?? (id === empId ? (employee?.full_name ?? 'אני') : '—');

      // משתתפים לאירועים הידניים
      const manualRows = (manual.data ?? []) as any[];
      const partByEvent = new Map<string, Part[]>();
      if (manualRows.length) {
        const cp = await supabase.from('calendar_event_participants')
          .select('event_id, employee_id, status').in('event_id', manualRows.map(e => e.id));
        for (const p of (cp.data ?? []) as any[]) {
          const a = partByEvent.get(p.event_id) ?? [];
          a.push({ employee_id: p.employee_id, name: nameOf(p.employee_id), status: p.status });
          partByEvent.set(p.event_id, a);
        }
      }
      for (const e of manualRows) {
        const parts = partByEvent.get(e.id) ?? [];
        const mine = parts.find(p => p.employee_id === empId);
        out.push({
          key: 'm' + e.id, day: ymd(new Date(e.starts_at)), time: e.all_day ? null : hhmm(e.starts_at),
          kind: e.kind, title: e.title, sub: e.location || null,
          to: e.candidate_id ? `/candidates/${e.candidate_id}` : e.application_id ? `/applications/${e.application_id}` : null,
          editable: isMgr || e.owner_id === empId, raw: e,
          ownerName: nameOf(e.owner_id), location: e.location || null, notes: e.notes || null,
          participants: parts, myStatus: mine ? mine.status : null,
        });
      }

      const ivRows = (iv.data ?? []) as any[];
      const ivInfo = await applicantInfo(ivRows.map(r => r.application_id));
      for (const r of ivRows) {
        const info = ivInfo[r.application_id];
        out.push({ key: 'i' + r.id, day: ymd(new Date(r.scheduled_at)), time: hhmm(r.scheduled_at),
          kind: 'interview', title: info?.candidateName ? `ראיון · ${info.candidateName}` : 'ראיון',
          sub: info?.jobTitle || null, to: `/applications/${r.application_id}` });
      }

      for (const r of (tk.data ?? []) as any[]) {
        out.push({ key: 't' + r.id, day: ymd(new Date(r.due_at)), time: hhmm(r.due_at),
          kind: 'task', title: r.title, to: `/tasks/${r.id}` });
      }

      const plEnriched = await enrichPlacements((pl.data ?? []) as any[]);
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
  useEffect(() => { load(); }, [cursor, empId, isMgr, team]);

  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of events) { const a = m.get(e.day) ?? []; a.push(e); m.set(e.day, a); }
    for (const a of m.values()) a.sort((x, y) => (x.time ?? '') < (y.time ?? '') ? -1 : 1);
    return m;
  }, [events]);

  const selectedEvents = byDay.get(selected) ?? [];

  function openNew(day: string) { setForm(emptyForm(day)); setErr(''); setDetails(null); setDlg(true); }
  function openEdit(e: Ev) {
    const r = e.raw; const d = new Date(r.starts_at);
    setForm({ id: r.id, title: r.title, kind: r.kind, date: ymd(d),
      time: r.all_day ? '09:00' : `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,
      all_day: r.all_day, location: r.location || '', notes: r.notes || '',
      participants: (e.participants ?? []).map(p => p.employee_id) });
    setErr(''); setDetails(null); setDlg(true);
  }

  async function save() {
    if (!form.title.trim()) { setErr('יש להזין כותרת.'); return; }
    setBusy(true); setErr('');
    const [y,m,dd] = form.date.split('-').map(Number);
    const [hh,mm] = (form.all_day ? '00:00' : form.time || '09:00').split(':').map(Number);
    const startsAt = new Date(y, m-1, dd, hh, mm).toISOString();
    const payload: any = { title: form.title.trim(), kind: form.kind, starts_at: startsAt,
      all_day: form.all_day, location: form.location.trim() || null, notes: form.notes.trim() || null };
    const invited = form.participants.filter(x => x !== empId);

    if (form.id) {
      const { error } = await supabase.from('calendar_events').update(payload).eq('id', form.id);
      if (error) { setBusy(false); setErr(error.message); return; }
      // עדכון רשימת המשתתפים: הסרה של מי שהוסר, הוספה של חדשים (שומר על אישורים קיימים).
      const existing = await supabase.from('calendar_event_participants').select('employee_id').eq('event_id', form.id);
      const have = new Set(((existing.data ?? []) as any[]).map(p => p.employee_id));
      const toAdd = invited.filter(id => !have.has(id));
      const toRemove = [...have].filter(id => !invited.includes(id));
      if (toRemove.length) await supabase.from('calendar_event_participants').delete().eq('event_id', form.id).in('employee_id', toRemove);
      if (toAdd.length) await supabase.from('calendar_event_participants').insert(toAdd.map(eid => ({ event_id: form.id, employee_id: eid, invited_by: empId })));
    } else {
      const { data, error } = await supabase.from('calendar_events').insert({ ...payload, owner_id: empId, created_by: empId }).select('id').single();
      if (error || !data) { setBusy(false); setErr(error?.message || 'שמירת האירוע נכשלה.'); return; }
      if (invited.length) await supabase.from('calendar_event_participants').insert(invited.map(eid => ({ event_id: data.id, employee_id: eid, invited_by: empId })));
    }
    setBusy(false); setDlg(false); setSelected(form.date); load();
  }

  async function remove(id: string) {
    if (!confirm('למחוק את האירוע?')) return;
    setBusy(true);
    const { error } = await supabase.from('calendar_events').delete().eq('id', id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDetails(null); setDlg(false); load();
  }

  async function rsvp(ev: Ev, status: string) {
    if (!ev.raw?.id) return;
    setBusy(true);
    const { error } = await supabase.from('calendar_event_participants')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('event_id', ev.raw.id).eq('employee_id', empId);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setDetails(d => d ? { ...d, myStatus: status } : d);
    load();
  }

  const setF = (k: keyof FormState, v: any) => setForm(s => ({ ...s, [k]: v }));
  const toggleP = (id: string) => setForm(s => ({ ...s, participants: s.participants.includes(id) ? s.participants.filter(x => x !== id) : [...s.participants, id] }));

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

      {err && !dlg && !details && <Msg kind="err">{err}</Msg>}

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
                  <button type="button" className="cal-row" onClick={()=>{ setErr(''); setDetails(e); }}>
                    <span className="cal-time">{e.time ?? 'כל היום'}</span>
                    <i className="cal-k" style={{ background: KIND[e.kind]?.c ?? '#4b5563' }} />
                    <span className="cal-body">
                      <span className="cal-title">{e.title}</span>
                      {e.sub && <span className="hint"> · {e.sub}</span>}
                      <span className="cal-kind">{KIND[e.kind]?.label ?? e.kind}</span>
                      {e.myStatus && <span className={'tag ' + (RSVP[e.myStatus]?.tone ?? 'mute')}>{RSVP[e.myStatus]?.label}</span>}
                      {(e.participants?.length ?? 0) > 0 && <span className="hint">👥 {e.participants!.length}</span>}
                    </span>
                    <span className="cal-open">פרטים ›</span>
                  </button>
                </li>
              ))}
            </ul>}
      </div>

      {/* פרטי אירוע (item 2) */}
      <Dialog open={!!details} title={details?.title ?? ''} onClose={()=>setDetails(null)}
        description={details ? (KIND[details.kind]?.label ?? details.kind) : undefined}
        footer={details && <>
          {details.editable && details.raw && <button className="btn btn-quiet" onClick={()=>openEdit(details)}>עריכה</button>}
          {details.editable && details.raw && <button className="btn btn-quiet" onClick={()=>remove(details.raw.id)}>מחיקה</button>}
          {details.to && <Link className="btn btn-quiet" to={details.to} onClick={()=>setDetails(null)}>מעבר לכרטיס</Link>}
          <button className="btn btn-quiet" onClick={()=>setDetails(null)}>סגירה</button>
        </>}>
        {details && <div className="dl-wrap">
          <dl className="dl">
            <dt>מתי</dt><dd>{dayLabel(details.day)}{details.time ? ` · ${details.time}` : ' · כל היום'}</dd>
            {details.location && <><dt>מיקום</dt><dd>{details.location}</dd></>}
            {details.ownerName && <><dt>מארגן/ת</dt><dd>{details.ownerName}</dd></>}
            {details.notes && <><dt>הערות</dt><dd style={{ whiteSpace:'pre-wrap' }}>{details.notes}</dd></>}
          </dl>

          {details.raw && (details.participants?.length ?? 0) > 0 && <>
            <h3 className="sec" style={{ marginTop:12 }}>משתתפים</h3>
            <ul className="cal-parts">
              {details.participants!.map(p => (
                <li key={p.employee_id}><span>{p.name}</span>
                  <span className={'tag ' + (RSVP[p.status]?.tone ?? 'mute')}>{RSVP[p.status]?.label ?? p.status}</span></li>
              ))}
            </ul>
          </>}

          {details.myStatus && <div className="rsvp">
            <span className="lbl">ההשתתפות שלי:</span>
            <button className={'btn btn-sm ' + (details.myStatus==='accepted' ? 'btn-primary' : 'btn-quiet')} disabled={busy} onClick={()=>rsvp(details, 'accepted')}>מאשר/ת</button>
            <button className={'btn btn-sm ' + (details.myStatus==='declined' ? 'btn-primary' : 'btn-quiet')} disabled={busy} onClick={()=>rsvp(details, 'declined')}>דוחה</button>
          </div>}
          <Msg kind="err">{err}</Msg>
        </div>}
      </Dialog>

      {/* יצירה/עריכה (items 3) */}
      <Dialog open={dlg} title={form.id ? 'עריכת אירוע' : 'אירוע חדש'} onClose={()=>setDlg(false)} onSubmit={save} wide
        footer={<>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button>
          {form.id && <button className="btn btn-quiet" type="button" onClick={()=>remove(form.id!)} disabled={busy}>מחיקה</button>}
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
        <fieldset className="parts-set">
          <legend className="lbl">משתתפים (כל אחד יכול לזמן את כולם)</legend>
          <div className="parts">
            {team.filter(t => t.id !== empId).map(t => (
              <label key={t.id} className={'part-item' + (form.participants.includes(t.id) ? ' on' : '')}>
                <input type="checkbox" checked={form.participants.includes(t.id)} onChange={()=>toggleP(t.id)} style={{ width:'auto', minHeight:0 }} />
                {t.full_name}
              </label>
            ))}
          </div>
        </fieldset>
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
        .cal-list li { border-bottom:1px solid var(--line); }
        .cal-list li:last-child { border-bottom:none; }
        .cal-row { width:100%; display:flex; align-items:center; gap:10px; padding:11px 16px; background:none; border:none; font:inherit; color:inherit; cursor:pointer; text-align:start; }
        .cal-row:hover { background:var(--sunk); }
        .cal-time { min-width:5.5ch; font-variant-numeric:tabular-nums; font-weight:600; font-size:.85rem; color:var(--ink-mid); }
        .cal-body { flex:1; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
        .cal-title { font-weight:600; }
        .cal-kind { font-size:.72rem; color:var(--ink-mid); background:var(--sunk); border-radius:999px; padding:1px 8px; }
        .cal-open { font-size:.8rem; color:var(--brand); font-weight:600; white-space:nowrap; }
        .cal-parts { list-style:none; margin:6px 0 0; padding:0; }
        .cal-parts li { display:flex; justify-content:space-between; padding:7px 0; border-bottom:1px solid var(--line); }
        .cal-parts li:last-child { border-bottom:none; }
        .rsvp { display:flex; align-items:center; gap:8px; margin-top:14px; flex-wrap:wrap; }
        .parts-set { border:1px solid var(--line); border-radius:12px; padding:10px 12px; }
        .parts { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; max-height:160px; overflow:auto; }
        .part-item { display:inline-flex; align-items:center; gap:7px; padding:6px 11px; border:1px solid var(--line-strong,var(--line)); border-radius:99px; cursor:pointer; font-size:.86rem; }
        .part-item.on { background:var(--brand); color:#fff; border-color:var(--brand); }
        @media (max-width:640px) {
          .cal-cell { min-height:72px; }
          .cal-chip { font-size:.68rem; }
          .cal-chip b { display:none; }
        }
      `}</style>
    </>
  );
}
