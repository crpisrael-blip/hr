import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { APP_STAGE, formatDate, formatDateTime, label } from '../lib/format';
import { allowedTransitions, type Stage } from '../lib/stages';
import { useLoad, unwrap } from '../lib/useLoad';
import { rpcErrorMessage, toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import Dialog from '../components/Dialog';
import { Msg, Loading } from '../components/Msg';
import { CustomFieldsEdit, useCustomFields } from '../components/CustomFields';

interface Application {
  id: string; stage: string; stage_changed_at: string; source: string | null; close_reason: string | null;
  candidate_id: string; job_id: string; recruiter_id: string | null; custom: Record<string, unknown> | null;
  candidates: { full_name: string } | null;
  jobs: { title: string; company_id: string; companies: { name: string } | null } | null;
}
interface HistRow { id: number; from_stage: string | null; to_stage: string; reason: string | null; changed_at: string }
interface Interview { id: string; scheduled_at: string; location: string | null; status: string }
interface Submission { id: string; sent_at: string; sent_manually: boolean; contact_id: string | null; summary_sent: string | null; contacts: { full_name: string } | null }

const IV_STATUS: Record<string, string> = { scheduled: 'מתוזמן', completed: 'התקיים', cancelled: 'בוטל', no_show: 'לא הופיע' };

/** ISO → ערך של datetime-local בשעון המקומי (בלי אזור זמן). */
function toLocalInput(iso: string): string {
  const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
interface ContactOpt { id: string; full_name: string }
interface EmployeeOpt { id: string; full_name: string }

export default function ApplicationDetail() {
  const { id } = useParams();
  const { employee } = useAuth();
  const meId = employee?.id ?? null;
  const [emps, setEmps] = useState<EmployeeOpt[]>([]);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState<{ to: Stage; label: string } | null>(null);
  const [closeReason, setCloseReason] = useState('');

  useEffect(() => {
    let alive = true;
    supabase.from('employees').select('id, full_name').eq('employment_status', 'active').order('full_name')
      .then(r => {
        if (!alive) return;
        if (r.error) { setErr(toUserMessage(r.error, 'טעינת רשימת המגייסים נכשלה.')); return; }
        setEmps(r.data as EmployeeOpt[]);
      });
    return () => { alive = false; };
  }, []);

  const { data, err: loadErr, loading, reload } = useLoad(async () => {
    const appl = unwrap(await supabase.from('applications')
      .select('id, stage, stage_changed_at, source, close_reason, candidate_id, job_id, recruiter_id, custom, candidates(full_name), jobs(title, company_id, companies(name))')
      .eq('id', id).maybeSingle()) as unknown as Application | null;
    if (!appl) throw { code: 'PGRST116', message: 'application not found' };
    const companyId = appl.jobs?.company_id;
    const [h, iv, sb, ct] = await Promise.all([
      supabase.from('application_stage_history').select('id, from_stage, to_stage, reason, changed_at').eq('application_id', id).order('changed_at', { ascending: false }),
      supabase.from('interviews').select('id, scheduled_at, location, status').eq('application_id', id).order('scheduled_at', { ascending: false }),
      supabase.from('client_submissions').select('id, sent_at, sent_manually, contact_id, summary_sent, contacts(full_name)').eq('application_id', id).order('sent_at', { ascending: false }),
      // בלי company_id אין למי לשלוח — לא שולחים eq('company_id', undefined).
      companyId
        ? supabase.from('contacts').select('id, full_name').eq('company_id', companyId)
        : Promise.resolve({ data: [] as ContactOpt[], error: null }),
    ]);
    return {
      appl,
      hist: unwrap(h) as unknown as HistRow[],
      interviews: unwrap(iv) as Interview[],
      subs: unwrap(sb) as unknown as Submission[],
      contacts: unwrap(ct) as ContactOpt[],
    };
  }, [id]);

  async function changeRecruiter(rid: string) {
    setErr('');
    const { error } = await supabase.from('applications').update({ recruiter_id: rid || null }).eq('id', id);
    if (error) { setErr(toUserMessage(error, 'עדכון המגייס האחראי נכשל.')); return; }
    reload();
  }

  /** מעבר שלב דרך RPC אחד: ולידציה של המעבר + רישום ההיסטוריה בטרנזקציה. */
  async function transition(to: Stage, reason: string | null) {
    setBusy(true); setErr('');
    const { error } = await supabase.rpc('set_application_stage', {
      p_application_id: id, p_stage: to, p_note: reason,
    });
    setBusy(false);
    if (error) { setErr(rpcErrorMessage(error, 'עדכון שלב המועמדות')); return; }
    setClosing(null); setCloseReason('');
    reload();
  }

  if (loading) return <Loading />;
  if (loadErr || !data) return <Msg kind="err">{loadErr || 'המועמדות לא נמצאה.'}</Msg>;

  const { appl: a, hist, interviews, subs, contacts } = data;
  const transitions = allowedTransitions(a.stage);

  return (
    <>
      <PageHead title={a.candidates?.full_name ?? 'מועמדות'}
        sub={`${a.jobs?.title ?? ''}${a.jobs?.companies?.name ? ' · ' + a.jobs.companies.name : ''}`}
        action={<>
          {a.stage === 'hired' && <Link to={`/placements/new?application=${a.id}`} className="btn btn-primary btn-sm">יצירת השמה</Link>}
          <Link to={`/candidates/${a.candidate_id}`} className="btn btn-quiet btn-sm">לכרטיס המועמד</Link>
        </>} />
      <Msg kind="err">{err}</Msg>

      <div className="grid2 app-grid">
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <h2 className="sec">שלב נוכחי</h2>
            <p><span className="tag brand" style={{ fontSize: '.95rem' }}>{label(APP_STAGE, a.stage)}</span></p>
            {a.close_reason && <p className="hint" style={{ marginTop: 8 }}>סיבת סיום: {a.close_reason}</p>}
            <div className="actions">
              {transitions.map(t => (
                <button key={t.to} className={'btn btn-sm ' + (t.kind === 'close' ? 'btn-quiet' : 'btn-primary')}
                  disabled={busy}
                  onClick={() => t.kind === 'close'
                    ? (setCloseReason(''), setClosing({ to: t.to, label: t.label }))
                    : transition(t.to, null)}>{t.label}</button>
              ))}
            </div>
          </div>

          <div className="card" style={{ padding: 20 }}>
            <h2 className="sec">מגייס אחראי</h2>
            <label><span className="lbl">בחירת מגייס</span>
              <select value={a.recruiter_id ?? ''} onChange={e => changeRecruiter(e.target.value)} style={{ width: '100%' }}>
                <option value="">— ללא —</option>
                {emps.map(m => <option key={m.id} value={m.id}>{m.full_name}</option>)}
              </select></label>
            <span className="hint" style={{ marginTop: 8 }}>המגייס האחראי כאן הוא ברירת המחדל לזכאות הבונוס בעת יצירת ההשמה, שם ניתן לאמת אותו.</span>
          </div>

          <AppCustom key={a.id} appId={a.id} initial={a.custom ?? {}} onSaved={reload} />
          <Interviews appId={a.id} meId={meId} rows={interviews} onChange={reload} />
          <Submissions appId={a.id} meId={meId} rows={subs} contacts={contacts} onChange={reload} />
        </div>

        <div className="card" style={{ padding: 20 }}>
          <h2 className="sec">היסטוריית שלבים</h2>
          {hist.length === 0 ? <p className="hint">אין עדיין מעברים.</p> : (
            <ol className="timeline">
              {hist.map(h => (
                <li key={h.id}>
                  <div className="tl-row">
                    <span>{h.from_stage ? `${label(APP_STAGE, h.from_stage)} → ` : ''}<strong>{label(APP_STAGE, h.to_stage)}</strong></span>
                    <span className="hint">{formatDate(h.changed_at)}</span>
                  </div>
                  {h.reason && <div className="hint">{h.reason}</div>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>

      <Dialog open={!!closing} title={closing?.label ?? 'סגירת מועמדות'} onClose={() => setClosing(null)}
        onSubmit={() => { const r = closeReason.trim(); if (!r) { setErr('נא לציין סיבת סיום.'); return; } if (closing) transition(closing.to, r); }}
        description="הסיבה נשמרת בהיסטוריית השלבים ואינה נחשפת למועמד."
        footer={<>
          <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'שומר…' : 'אישור'}</button>
          <button type="button" className="btn btn-quiet" onClick={() => setClosing(null)}>ביטול</button>
        </>}>
        <label><span className="lbl">סיבת הסיום *</span>
          <textarea rows={3} value={closeReason} onChange={e => setCloseReason(e.target.value)} required /></label>
      </Dialog>

      <style>{`
        .app-grid { grid-template-columns: 1.3fr 1fr; }
        .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
        .subrow { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); align-items: center; }
        .subrow:last-child { border-bottom: 0; }
        .row-actions { display: inline-flex; align-items: center; gap: 6px; flex: 0 0 auto; }
        .addbtn { margin-top: 12px; }
        @media (max-width: 820px) { .app-grid { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}

function Interviews({ appId, meId, rows, onChange }:
  { appId: string; meId: string | null; rows: Interview[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [when, setWhen] = useState(''); const [loc, setLoc] = useState(''); const [status, setStatus] = useState('scheduled');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [del, setDel] = useState<Interview | null>(null); const [delBusy, setDelBusy] = useState(false);

  function startAdd() { setEditId(null); setWhen(''); setLoc(''); setStatus('scheduled'); setErr(''); setOpen(true); }
  function startEdit(iv: Interview) { setEditId(iv.id); setWhen(toLocalInput(iv.scheduled_at)); setLoc(iv.location ?? ''); setStatus(iv.status || 'scheduled'); setErr(''); setOpen(true); }

  async function save(e: FormEvent) {
    e.preventDefault(); setErr('');
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) { setErr('מועד הראיון אינו תקין.'); return; }
    setBusy(true);
    const patch = { scheduled_at: at.toISOString(), location: loc.trim() || null, status };
    const { error } = editId
      ? await supabase.from('interviews').update(patch).eq('id', editId)
      : await supabase.from('interviews').insert({ application_id: appId, created_by: meId, ...patch });
    setBusy(false);
    if (error) { setErr(toUserMessage(error, 'שמירת הראיון נכשלה.')); return; }
    setOpen(false); setEditId(null); onChange();
  }

  async function remove() {
    if (!del) return;
    setDelBusy(true); setErr('');
    const { error } = await supabase.from('interviews').delete().eq('id', del.id);
    setDelBusy(false); setDel(null);
    if (error) { setErr(toUserMessage(error, 'מחיקת הראיון נכשלה.')); return; }
    onChange();
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="sec">ראיונות</h2>
      <Msg kind="err">{err}</Msg>
      {rows.length === 0 ? <p className="hint">אין ראיונות מתוזמנים.</p> : rows.map(iv => (
        <div key={iv.id} className="subrow">
          <span>🗓 {formatDateTime(iv.scheduled_at)}{iv.location ? ' · ' + iv.location : ''}</span>
          <span className="row-actions">
            <span className="tag mute">{label(IV_STATUS, iv.status)}</span>
            <button type="button" className="iconbtn" onClick={() => startEdit(iv)} aria-label="עריכת ראיון">✎</button>
            <button type="button" className="iconbtn" onClick={() => setDel(iv)} aria-label="מחיקת ראיון">🗑</button>
          </span>
        </div>
      ))}
      {open ? (
        <form onSubmit={save} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <label><span className="lbl">מועד הראיון *</span>
            <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} required /></label>
          <label><span className="lbl">מיקום / קישור</span>
            <input value={loc} onChange={e => setLoc(e.target.value)} /></label>
          {editId && (
            <label><span className="lbl">סטטוס</span>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                {Object.entries(IV_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
          )}
          <Msg kind="err">{err}</Msg>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !when}>{editId ? 'עדכון ראיון' : 'שמירה'}</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setOpen(false); setEditId(null); }}>ביטול</button>
          </div>
        </form>
      ) : <button className="btn btn-quiet btn-sm addbtn" onClick={startAdd}>+ זימון ראיון</button>}

      <Dialog open={!!del} title="מחיקת ראיון" onClose={() => setDel(null)}
        description={del ? formatDateTime(del.scheduled_at) : undefined}
        footer={<>
          <button className="btn btn-danger" disabled={delBusy} onClick={remove}>{delBusy ? 'מוחק…' : 'מחיקה'}</button>
          <button className="btn btn-quiet" onClick={() => setDel(null)}>ביטול</button>
        </>}>
        <p>הראיון יימחק לצמיתות.</p>
      </Dialog>
    </div>
  );
}

function Submissions({ appId, meId, rows, contacts, onChange }:
  { appId: string; meId: string | null; rows: Submission[]; contacts: ContactOpt[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [contactId, setContactId] = useState(''); const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [del, setDel] = useState<Submission | null>(null); const [delBusy, setDelBusy] = useState(false);

  function startAdd() { setEditId(null); setContactId(''); setSummary(''); setErr(''); setOpen(true); }
  function startEdit(s: Submission) { setEditId(s.id); setContactId(s.contact_id ?? ''); setSummary(s.summary_sent ?? ''); setErr(''); setOpen(true); }

  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = editId
      ? await supabase.from('client_submissions').update({ contact_id: contactId || null, summary_sent: summary.trim() || null }).eq('id', editId)
      : await supabase.from('client_submissions').insert({
          application_id: appId, contact_id: contactId || null, summary_sent: summary.trim() || null,
          channel: 'email', sent_manually: true, sent_at: new Date().toISOString(), created_by: meId,
        });
    setBusy(false);
    if (error) { setErr(toUserMessage(error, 'שמירת ההגשה נכשלה.')); return; }
    setOpen(false); setEditId(null); onChange();
  }

  async function remove() {
    if (!del) return;
    setDelBusy(true); setErr('');
    const { error } = await supabase.from('client_submissions').delete().eq('id', del.id);
    setDelBusy(false); setDel(null);
    if (error) { setErr(toUserMessage(error, 'מחיקת ההגשה נכשלה.')); return; }
    onChange();
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="sec">הגשות ללקוח</h2>
      <Msg kind="err">{err}</Msg>
      {rows.length === 0 ? <p className="hint">אין הגשות. הגשה שומרת נמען ומועד.</p> : rows.map(s => (
        <div key={s.id} className="subrow">
          <span>📤 {s.contacts?.full_name ?? 'נמען'} {s.sent_manually && <span className="tag mute">נשלח ידנית</span>}</span>
          <span className="row-actions">
            <span className="hint">{formatDate(s.sent_at)}</span>
            <button type="button" className="iconbtn" onClick={() => startEdit(s)} aria-label="עריכת הגשה">✎</button>
            <button type="button" className="iconbtn" onClick={() => setDel(s)} aria-label="מחיקת הגשה">🗑</button>
          </span>
        </div>
      ))}
      {open ? (
        <form onSubmit={save} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <label><span className="lbl">איש קשר אצל הלקוח</span>
            <select value={contactId} onChange={e => setContactId(e.target.value)}>
              <option value="">— ללא —</option>
              {contacts.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select></label>
          <label><span className="lbl">תקציר שנשלח</span>
            <textarea value={summary} onChange={e => setSummary(e.target.value)} /></label>
          <Msg kind="err">{err}</Msg>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary btn-sm" disabled={busy}>{editId ? 'עדכון הגשה' : 'שמירת הגשה'}</button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setOpen(false); setEditId(null); }}>ביטול</button>
          </div>
        </form>
      ) : <button className="btn btn-quiet btn-sm addbtn" onClick={startAdd}>+ תיעוד הגשה ללקוח</button>}

      <Dialog open={!!del} title="מחיקת הגשה" onClose={() => setDel(null)}
        description={del?.contacts?.full_name ?? undefined}
        footer={<>
          <button className="btn btn-danger" disabled={delBusy} onClick={remove}>{delBusy ? 'מוחק…' : 'מחיקה'}</button>
          <button className="btn btn-quiet" onClick={() => setDel(null)}>ביטול</button>
        </>}>
        <p>ההגשה תימחק לצמיתות.</p>
      </Dialog>
    </div>
  );
}

// שדות מותאמים למועמדות (תהליך גיוס) — עריכה ושמירה במקום.
function AppCustom({ appId, initial, onSaved }: { appId: string; initial: Record<string, unknown>; onSaved: () => void }) {
  const fields = useCustomFields('application');
  const [vals, setVals] = useState<Record<string, unknown>>(initial);
  const [busy, setBusy] = useState(false); const [note, setNote] = useState(''); const [err, setErr] = useState('');

  async function save() {
    setBusy(true); setNote(''); setErr('');
    const { error } = await supabase.from('applications').update({ custom: vals }).eq('id', appId);
    setBusy(false);
    if (error) { setErr(toUserMessage(error, 'שמירת השדות הנוספים נכשלה.')); return; }
    setNote('נשמר'); onSaved();
  }

  if (!fields.length) return null;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <CustomFieldsEdit entityType="application" values={vals} onChange={setVals} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-quiet btn-sm" disabled={busy} onClick={save}>{busy ? 'שומר…' : 'שמירת שדות נוספים'}</button>
        <Msg kind="ok">{note}</Msg>
        <Msg kind="err">{err}</Msg>
      </div>
    </div>
  );
}
