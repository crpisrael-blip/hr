import { useRef, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { ASSIGNABLE_ROLES, EMP_STATUS, EMPLOYEE_DOC_KIND, ROLE, formatDate, fmtSize, label, safeFileName } from '../lib/format';
import { ALLOWED_UPLOAD_ACCEPT, ALLOWED_UPLOAD_MIME, MAX_UPLOAD_MB } from '../lib/config';
import { useLoad, unwrap } from '../lib/useLoad';
import { toUserMessage } from '../lib/errors';
import PageHead from '../components/PageHead';
import Dialog from '../components/Dialog';
import { Msg, Loading } from '../components/Msg';

const BUCKET = 'employee-docs';

interface EmployeeRow {
  id: string; full_name: string; email: string; phone: string | null; role: string;
  job_title: string | null; hire_date: string | null; employment_status: string;
  notes: string | null; user_id: string | null; invited_at: string | null;
}
interface DocRow { id: string; kind: string; file_name: string; storage_path: string; size_bytes: number | null; created_at: string }
interface FeedbackRow { id: string; rating: number | null; body: string; created_at: string }

const INVITE_ERR: Record<string, string> = {
  forbidden: 'רק מנהלת יכולה להזמין.', already_linked: 'העובד כבר מקושר לחשבון כניסה.',
  not_found: 'העובד לא נמצא.', invite_failed: 'שליחת ההזמנה נכשלה (ייתכן שהדוא״ל כבר קיים במערכת, או שכתובת ה-Redirect אינה מוגדרת).',
  missing_employee: 'חסר מזהה עובד.', server_misconfigured: 'הפונקציה חסרה מפתח שירות.',
};

export default function EmployeeDetail() {
  const { id } = useParams();
  const { employee: me } = useAuth();
  const [form, setForm] = useState<EmployeeRow | null>(null);
  const [err, setErr] = useState(''); const [saved, setSaved] = useState('');
  const [inviteMsg, setInviteMsg] = useState({ text: '', kind: 'ok' as 'ok' | 'err' });
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data, err: loadErr, loading, reload } = useLoad(async () => {
    const emp = unwrap(await supabase.from('employees')
      .select('id, full_name, email, phone, role, job_title, hire_date, employment_status, notes, user_id, invited_at')
      .eq('id', id).maybeSingle()) as EmployeeRow | null;
    if (!emp) throw { code: 'PGRST116', message: 'employee not found' };
    const [d, g] = await Promise.all([
      supabase.from('employee_documents').select('id, kind, file_name, storage_path, size_bytes, created_at').eq('employee_id', id).order('created_at', { ascending: false }),
      supabase.from('employee_feedback').select('id, rating, body, created_at').eq('employee_id', id).order('created_at', { ascending: false }),
    ]);
    setForm(emp);
    return { emp, docs: unwrap(d) as DocRow[], feedback: unwrap(g) as FeedbackRow[] };
  }, [id]);

  async function saveDetails(ev: FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setErr(''); setSaved(''); setBusy(true);
    const { error } = await supabase.from('employees').update({
      full_name: form.full_name, email: form.email.trim().toLowerCase(), phone: form.phone || null, role: form.role,
      job_title: form.job_title || null, hire_date: form.hire_date || null,
      employment_status: form.employment_status, notes: form.notes || null,
    }).eq('id', id);
    setBusy(false);
    if (error) { setErr(toUserMessage(error, 'שמירת פרטי העובד נכשלה.')); return; }
    setSaved('הפרטים נשמרו.');
    reload();
  }

  async function invite() {
    setInviting(true); setInviteMsg({ text: '', kind: 'ok' });
    const { error } = await supabase.functions.invoke('invite-employee', { body: { employee_id: id } });
    setInviting(false);
    if (error) {
      let code = ''; let detail = '';
      try {
        const ctx = (error as { context?: { json?: () => Promise<{ error?: string; detail?: string }> } }).context;
        const b = await ctx?.json?.();
        code = b?.error ?? ''; detail = b?.detail ?? '';
      } catch { /* גוף התשובה אינו JSON */ }
      console.error('[hr] invite-employee failed:', error);
      setInviteMsg({ text: (INVITE_ERR[code] || 'שליחת ההזמנה נכשלה.') + (detail ? ` (${detail})` : ''), kind: 'err' });
      return;
    }
    setInviteMsg({ text: 'הזמנה נשלחה למייל. אחרי לחיצה על הקישור המגייס ייכנס ויקבע סיסמה.', kind: 'ok' });
    reload();
  }

  if (loading) return <Loading />;
  if (loadErr || !data || !form) return <Msg kind="err">{loadErr || 'העובד לא נמצא.'}</Msg>;
  const { emp, docs, feedback } = data;
  // superadmin נשמר כאפשרות רק אם זה כבר תפקידו — כדי לא לאפשר הענקה מהמסך.
  const roleOptions = emp.role === 'superadmin' ? ['superadmin', ...ASSIGNABLE_ROLES] : [...ASSIGNABLE_ROLES];

  return (
    <>
      <PageHead title={emp.full_name} sub={`${label(ROLE, emp.role)}${emp.job_title ? ' · ' + emp.job_title : ''}`}
        action={<Link to="/employees" className="btn btn-quiet btn-sm">חזרה לרשימה</Link>} />
      <Msg kind="err">{err}</Msg>

      <div className="grid2 emp-grid">
        <form className="card" style={{ padding: 20, display: 'grid', gap: 14 }} onSubmit={saveDetails}>
          <h2 className="sec">פרטי עובד</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 14 }}>
            <label><span className="lbl">שם מלא</span><input value={form.full_name ?? ''} onChange={ev => setForm({ ...form, full_name: ev.target.value })} required /></label>
            <label><span className="lbl">דוא״ל</span><input type="email" dir="ltr" value={form.email ?? ''} onChange={ev => setForm({ ...form, email: ev.target.value })} required /></label>
            <label><span className="lbl">טלפון</span><input type="tel" dir="ltr" value={form.phone ?? ''} onChange={ev => setForm({ ...form, phone: ev.target.value })} /></label>
            <label><span className="lbl">תפקיד/משרה</span><input value={form.job_title ?? ''} onChange={ev => setForm({ ...form, job_title: ev.target.value })} /></label>
            <label><span className="lbl">תפקיד במערכת</span>
              <select value={form.role} onChange={ev => setForm({ ...form, role: ev.target.value })}>
                {roleOptions.map(k => <option key={k} value={k}>{ROLE[k]}</option>)}
              </select></label>
            <label><span className="lbl">סטטוס העסקה</span>
              <select value={form.employment_status} onChange={ev => setForm({ ...form, employment_status: ev.target.value })}>
                {Object.entries(EMP_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></label>
            <label><span className="lbl">תחילת עבודה</span><input type="date" value={form.hire_date ?? ''} onChange={ev => setForm({ ...form, hire_date: ev.target.value })} /></label>
          </div>
          <label><span className="lbl">הערות</span><textarea value={form.notes ?? ''} onChange={ev => setForm({ ...form, notes: ev.target.value })} rows={2} /></label>
          <Msg kind="ok">{saved}</Msg>
          <div><button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'שומר…' : 'שמירה'}</button></div>
        </form>

        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card" style={{ padding: 20 }}>
            <h2 className="sec">כניסה למערכת</h2>
            {emp.user_id
              ? <Msg kind="ok">מקושר לכניסה{emp.invited_at ? ` · הוזמן ${formatDate(emp.invited_at)}` : ''}.</Msg>
              : <>
                <p className="hint" style={{ marginBottom: 10 }}>שלחו הזמנה לדוא״ל <bdi dir="ltr">{emp.email}</bdi>. המגייס ילחץ על הקישור, ייכנס למערכת ויקבע סיסמה.</p>
                <button className="btn btn-primary btn-sm" disabled={inviting} onClick={invite}>{inviting ? 'שולח…' : 'שליחת הזמנה לכניסה'}</button>
              </>}
            <Msg kind={inviteMsg.kind} style={{ marginTop: 10 }}>{inviteMsg.text}</Msg>
          </div>
          <Documents empId={id!} rows={docs} onChange={reload} />
          <Feedback empId={id!} authorId={me?.id} rows={feedback} onChange={reload} />
        </div>
      </div>
      <style>{`
        .emp-grid { grid-template-columns: 1.2fr 1fr; }
        .doc-row, .fb-row { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
        .doc-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
        .fb-row { display: grid; gap: 4px; }
        @media (max-width: 860px) { .emp-grid { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}

function Documents({ empId, rows, onChange }: { empId: string; rows: DocRow[]; onChange: () => void }) {
  const [kind, setKind] = useState('contract');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [toDelete, setToDelete] = useState<DocRow | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setErr('');
    // ולידציה לפני ההעלאה: סוג וגודל. אין טעם להעלות 50MB ואז להידחות.
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) { setErr(`הקובץ גדול מדי. המקסימום הוא ${MAX_UPLOAD_MB} מ״ב.`); return; }
    if (file.type && !ALLOWED_UPLOAD_MIME.includes(file.type)) { setErr('סוג הקובץ אינו נתמך. מותר PDF, DOCX, JPG או PNG.'); return; }
    setBusy(true);
    // שם הקובץ המקורי נשמר בעמודה; בנתיב האחסון משתמשים בשם מנוקה.
    const path = `${empId}/${kind}/${Date.now()}-${safeFileName(file.name)}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' });
    if (up.error) { setErr(toUserMessage(up.error, 'העלאת הקובץ נכשלה.')); setBusy(false); return; }
    const ins = await supabase.from('employee_documents').insert({
      employee_id: empId, kind, file_name: file.name, storage_path: path,
      mime: file.type || null, size_bytes: file.size,
    });
    setBusy(false);
    if (ins.error) {
      // מנקים את הקובץ כדי שלא יישאר יתום בדלי.
      await supabase.storage.from(BUCKET).remove([path]);
      setErr(toUserMessage(ins.error, 'רישום המסמך נכשל. הקובץ לא נשמר.'));
      return;
    }
    onChange();
  }

  async function open(d: DocRow) {
    setErr('');
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path, 120);
    if (error || !data?.signedUrl) { setErr(toUserMessage(error, 'פתיחת המסמך נכשלה. ייתכן שהקובץ הוסר מהאחסון.')); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  async function remove(d: DocRow) {
    setBusy(true); setErr('');
    // ★ מוחקים קודם מהאחסון; כשל שם עוצר — אחרת נשארים קבצים יתומים בדלי.
    const rm = await supabase.storage.from(BUCKET).remove([d.storage_path]);
    if (rm.error) { setErr(toUserMessage(rm.error, 'מחיקת הקובץ מהאחסון נכשלה. הרשומה לא נמחקה.')); setBusy(false); setToDelete(null); return; }
    const del = await supabase.from('employee_documents').delete().eq('id', d.id);
    setBusy(false); setToDelete(null);
    if (del.error) { setErr(toUserMessage(del.error, 'הקובץ נמחק מהאחסון אך מחיקת הרשומה נכשלה.')); return; }
    onChange();
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="sec">מסמכים ותעודות ({rows.length})</h2>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', margin: '6px 0 12px', flexWrap: 'wrap' }}>
        <label style={{ flex: '0 0 auto' }}><span className="lbl">סוג מסמך</span>
          <select value={kind} onChange={e => setKind(e.target.value)}>
            {Object.entries(EMPLOYEE_DOC_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        {/* כפתור אמיתי במקום label שעוטף input hidden — נגיש למקלדת. */}
        <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          {busy ? 'מעלה…' : '+ העלאת קובץ'}
        </button>
        <input ref={fileRef} type="file" className="sr-only" accept={ALLOWED_UPLOAD_ACCEPT} tabIndex={-1}
          aria-hidden="true" disabled={busy}
          onChange={e => { const file = e.target.files?.[0]; if (file) upload(file); e.currentTarget.value = ''; }} />
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>עד {MAX_UPLOAD_MB} מ״ב · PDF, DOCX, JPG, PNG</p>
      <Msg kind="err">{err}</Msg>
      {rows.length === 0 ? <p className="hint">אין מסמכים.</p> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map(d => (
            <div key={d.id} className="doc-row">
              <button type="button" className="linkrow" onClick={() => open(d)}>
                <span>📄 {d.file_name}</span>
                <span className="hint">{label(EMPLOYEE_DOC_KIND, d.kind)} · {fmtSize(d.size_bytes)} · {formatDate(d.created_at)}</span>
              </button>
              <button className="btn btn-quiet btn-sm" onClick={() => setToDelete(d)} aria-label={`מחיקת המסמך ${d.file_name}`}>
                <span aria-hidden="true">🗑</span>
              </button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={!!toDelete} title="מחיקת מסמך" onClose={() => setToDelete(null)}
        description={toDelete?.file_name}
        footer={<>
          <button className="btn btn-primary" disabled={busy} onClick={() => toDelete && remove(toDelete)}>{busy ? 'מוחק…' : 'מחיקה'}</button>
          <button className="btn btn-quiet" onClick={() => setToDelete(null)}>ביטול</button>
        </>}>
        <p>המסמך יימחק מהאחסון ומהרשומות. לא ניתן לשחזר.</p>
      </Dialog>
    </div>
  );
}

function Feedback({ empId, authorId, rows, onChange }:
  { empId: string; authorId?: string; rows: FeedbackRow[]; onChange: () => void }) {
  const [body, setBody] = useState(''); const [rating, setRating] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  async function add(ev: FormEvent) {
    ev.preventDefault();
    const t = body.trim(); if (!t) return;
    setBusy(true); setErr('');
    const { error } = await supabase.from('employee_feedback').insert({
      employee_id: empId, author_id: authorId ?? null, rating: rating ? Number(rating) : null, body: t,
    });
    setBusy(false);
    if (error) { setErr(toUserMessage(error, 'שמירת המשוב נכשלה.')); return; }
    setBody(''); setRating(''); onChange();
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="sec">משוב והערכות ({rows.length})</h2>
      <form onSubmit={add} style={{ display: 'grid', gap: 8, margin: '6px 0 12px' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
          <label style={{ flex: '0 0 120px' }}><span className="lbl">דירוג</span>
            <select value={rating} onChange={e => setRating(e.target.value)}>
              <option value="">ללא דירוג</option>{[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n} כוכבים</option>)}
            </select></label>
          <label style={{ flex: 1, minWidth: 180 }}><span className="lbl">משוב</span>
            <input value={body} onChange={e => setBody(e.target.value)} placeholder="משוב, הערכה, ציון לשבח…" /></label>
          <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>הוספה</button>
        </div>
      </form>
      <Msg kind="err">{err}</Msg>
      {rows.length === 0 ? <p className="hint">אין עדיין משוב.</p> : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map(g => (
            <div key={g.id} className="fb-row">
              {g.rating != null && <span className="rating"><span aria-hidden="true">{'★'.repeat(g.rating)}</span><span className="sr-only">דירוג {g.rating} מתוך 5</span></span>}
              <div>{g.body}</div>
              <span className="hint">{formatDate(g.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
