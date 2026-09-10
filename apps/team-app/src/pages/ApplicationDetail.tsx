import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { APP_STAGE, formatDate } from '../lib/format';
import { allowedTransitions, type Stage } from '../lib/stages';
import PageHead from '../components/PageHead';

async function myEmployeeId(): Promise<string | null> {
  const uid = (await supabase.auth.getUser()).data.user?.id;
  if (!uid) return null;
  const { data } = await supabase.from('employees').select('id').eq('user_id', uid).maybeSingle();
  return data?.id ?? null;
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const [a, setA] = useState<any>(null);
  const [hist, setHist] = useState<any[]>([]);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [subs, setSubs] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  async function load() {
    const r = await supabase.from('applications')
      .select('id, stage, stage_changed_at, source, close_reason, candidate_id, job_id, candidates(full_name), jobs(title, company_id, companies(name))')
      .eq('id', id).maybeSingle();
    if (r.error) { setErr(r.error.message); return; }
    if (!r.data) { setErr('המועמדות לא נמצאה'); return; }
    setA(r.data);
    const [h, iv, sb, ct] = await Promise.all([
      supabase.from('application_stage_history').select('*').eq('application_id', id).order('changed_at', { ascending: false }),
      supabase.from('interviews').select('*').eq('application_id', id).order('scheduled_at', { ascending: false }),
      supabase.from('client_submissions').select('*, contacts(full_name)').eq('application_id', id).order('sent_at', { ascending: false }),
      supabase.from('contacts').select('id, full_name').eq('company_id', (r.data as any).jobs?.company_id),
    ]);
    if (!h.error) setHist(h.data); if (!iv.error) setInterviews(iv.data);
    if (!sb.error) setSubs(sb.data); if (!ct.error) setContacts(ct.data);
  }
  useEffect(() => { load(); }, [id]);

  async function transition(to: Stage, kind: string) {
    if (!a) return;
    let reason: string | null = null;
    if (kind === 'close') { reason = prompt('סיבת הסיום:') || ''; if (!reason) return; }
    setBusy(true); setErr('');
    const emp = await myEmployeeId(); const from = a.stage;
    const up = await supabase.from('applications').update({
      stage: to, stage_changed_at: new Date().toISOString(), close_reason: kind === 'close' ? reason : null,
    }).eq('id', a.id);
    if (up.error) { setErr(up.error.message); setBusy(false); return; }
    await supabase.from('application_stage_history').insert({
      application_id: a.id, from_stage: from, to_stage: to, reason, changed_by: emp });
    await load(); setBusy(false);
  }

  if (err && !a) return <p className="msg err">{err}</p>;
  if (!a) return <p className="spinner">טוען…</p>;
  const transitions = allowedTransitions(a.stage);

  return (
    <>
      <PageHead title={a.candidates?.full_name ?? 'מועמדות'}
        sub={`${a.jobs?.title ?? ''}${a.jobs?.companies?.name ? ' · ' + a.jobs.companies.name : ''}`}
        action={<>
          {a.stage === 'hired' && <Link to={`/placements/new?application=${a.id}`} className="btn btn-primary btn-sm">יצירת השמה</Link>}
          <Link to={`/candidates/${a.candidate_id}`} className="btn btn-quiet btn-sm">לכרטיס המועמד</Link>
        </>} />
      {err && <p className="msg err">{err}</p>}

      <div className="grid2">
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <h2 className="sec">שלב נוכחי</h2>
            <p><span className="tag brand" style={{ fontSize: '.95rem' }}>{APP_STAGE[a.stage]}</span></p>
            {a.close_reason && <p className="hint" style={{ marginTop: 8 }}>סיבת סיום: {a.close_reason}</p>}
            <div className="actions">
              {transitions.map(t => (
                <button key={t.to} className={'btn btn-sm ' + (t.kind === 'close' ? 'btn-quiet' : 'btn-primary')}
                  disabled={busy} onClick={() => transition(t.to, t.kind)}>{t.label}</button>
              ))}
            </div>
          </div>

          <Interviews appId={a.id} rows={interviews} onChange={load} />
          <Submissions appId={a.id} rows={subs} contacts={contacts} onChange={load} />
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">היסטוריית שלבים</h2>
          {hist.length === 0 ? <p className="hint">אין עדיין מעברים.</p> : (
            <ol className="timeline">
              {hist.map(h => (
                <li key={h.id}>
                  <div className="tl-row"><span>{h.from_stage ? `${APP_STAGE[h.from_stage]} → ` : ''}<strong>{APP_STAGE[h.to_stage]}</strong></span>
                    <span className="hint">{formatDate(h.changed_at)}</span></div>
                  {h.reason && <div className="hint">{h.reason}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
      <style>{`
        .grid2 { display: grid; gap: 16px; grid-template-columns: 1.3fr 1fr; align-items: start; }
        .sec { font-size: 1.05rem; margin-bottom: 12px; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
        .timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
        .timeline li { border-inline-start: 2px solid var(--line-strong); padding-inline-start: 12px; }
        .tl-row { display: flex; justify-content: space-between; gap: 10px; }
        .subrow { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
        .subrow:last-child { border-bottom: 0; }
        .addbtn { margin-top: 12px; }
        @media (max-width: 820px) { .grid2 { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}

function Interviews({ appId, rows, onChange }: { appId: string; rows: any[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState(''); const [loc, setLoc] = useState(''); const [busy, setBusy] = useState(false);
  async function add(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const emp = await myEmployeeId();
    await supabase.from('interviews').insert({ application_id: appId, scheduled_at: new Date(when).toISOString(), location: loc || null, created_by: emp });
    setBusy(false); setOpen(false); setWhen(''); setLoc(''); onChange();
  }
  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="sec">ראיונות</h2>
      {rows.length === 0 ? <p className="hint">אין ראיונות מתוזמנים.</p> : rows.map(iv => (
        <div key={iv.id} className="subrow">
          <span>🗓 {new Date(iv.scheduled_at).toLocaleString('he-IL', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}{iv.location ? ' · ' + iv.location : ''}</span>
          <span className="tag mute">{iv.status === 'scheduled' ? 'מתוזמן' : iv.status}</span>
        </div>
      ))}
      {open ? (
        <form onSubmit={add} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} required />
          <input placeholder="מיקום / קישור (רשות)" value={loc} onChange={e => setLoc(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !when}>שמירה</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>ביטול</button>
          </div>
        </form>
      ) : <button className="btn btn-quiet btn-sm addbtn" onClick={() => setOpen(true)}>+ זימון ראיון</button>}
    </div>
  );
}

function Submissions({ appId, rows, contacts, onChange }: { appId: string; rows: any[]; contacts: any[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState(''); const [summary, setSummary] = useState(''); const [busy, setBusy] = useState(false);
  async function add(e: FormEvent) {
    e.preventDefault(); setBusy(true);
    const emp = await myEmployeeId();
    await supabase.from('client_submissions').insert({
      application_id: appId, contact_id: contactId || null, summary_sent: summary || null,
      channel: 'email', sent_manually: true, sent_at: new Date().toISOString(), created_by: emp });
    setBusy(false); setOpen(false); setSummary(''); onChange();
  }
  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="sec">הגשות ללקוח</h2>
      {rows.length === 0 ? <p className="hint">אין הגשות. הגשה שומרת נמען ומועד.</p> : rows.map(s => (
        <div key={s.id} className="subrow">
          <span>📤 {s.contacts?.full_name ?? 'נמען'} {s.sent_manually && <span className="tag mute">נשלח ידנית</span>}</span>
          <span className="hint">{formatDate(s.sent_at)}</span>
        </div>
      ))}
      {open ? (
        <form onSubmit={add} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <select value={contactId} onChange={e => setContactId(e.target.value)}>
            <option value="">איש קשר אצל הלקוח…</option>
            {contacts.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
          <textarea placeholder="תקציר שנשלח (רשות)" value={summary} onChange={e => setSummary(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy}>שמירת הגשה</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>ביטול</button>
          </div>
        </form>
      ) : <button className="btn btn-quiet btn-sm addbtn" onClick={() => setOpen(true)}>+ תיעוד הגשה ללקוח</button>}
    </div>
  );
}
