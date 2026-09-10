import { useEffect, useState, type FormEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { formatDate } from '../lib/format';
import PageHead from '../components/PageHead';

const ROLE: Record<string,string> = { recruiter:'מגייס', manager:'מנהלת החברה', superadmin:'מנהל על' };
const DOC_KIND: Record<string,string> = { contract:'חוזה', certificate:'תעודה', id:'תעודת זהות', resume:'קורות חיים', other:'מסמך' };
const BUCKET = 'employee-docs';
const fmtSize = (b: number) => b < 1048576 ? `${(b/1024).toFixed(0)} ק״ב` : `${(b/1048576).toFixed(1)} מ״ב`;

export default function EmployeeDetail() {
  const { id } = useParams();
  const { employee } = useAuth();
  const isMgr = employee?.role === 'manager' || employee?.role === 'superadmin';
  const [e, setE] = useState<any>(null);
  const [docs, setDocs] = useState<any[]>([]);
  const [fb, setFb] = useState<any[]>([]);
  const [err, setErr] = useState(''); const [saved, setSaved] = useState(false);
  const [inviteMsg, setInviteMsg] = useState(''); const [inviting, setInviting] = useState(false);

  async function load() {
    const r = await supabase.from('employees')
      .select('id, full_name, email, phone, role, job_title, hire_date, employment_status, notes, user_id, invited_at')
      .eq('id', id).maybeSingle();
    if (r.error) { setErr(r.error.message); return; }
    if (!r.data) { setErr('העובד לא נמצא'); return; }
    setE(r.data);
    const [d, g] = await Promise.all([
      supabase.from('employee_documents').select('*').eq('employee_id', id).order('created_at', { ascending:false }),
      supabase.from('employee_feedback').select('*').eq('employee_id', id).order('created_at', { ascending:false }),
    ]);
    if (!d.error) setDocs(d.data); if (!g.error) setFb(g.data);
  }
  useEffect(() => { load(); }, [id]);

  async function saveDetails(ev: FormEvent) {
    ev.preventDefault(); setErr(''); setSaved(false);
    const { error } = await supabase.from('employees').update({
      full_name: e.full_name, email: e.email, phone: e.phone || null, role: e.role,
      job_title: e.job_title || null, hire_date: e.hire_date || null,
      employment_status: e.employment_status, notes: e.notes || null,
    }).eq('id', id);
    if (error) setErr(error.message); else setSaved(true);
  }

  const INVITE_ERR: Record<string,string> = {
    forbidden: 'רק מנהלת יכולה להזמין.', already_linked: 'העובד כבר מקושר לחשבון כניסה.',
    not_found: 'העובד לא נמצא.', invite_failed: 'שליחת ההזמנה נכשלה (ייתכן שהדוא״ל כבר קיים במערכת, או שכתובת ה-Redirect לא מוגדרת).',
    missing_employee: 'חסר מזהה עובד.', server_misconfigured: 'הפונקציה חסרה מפתח שירות.',
  };
  async function invite() {
    setInviting(true); setInviteMsg('');
    const { error } = await supabase.functions.invoke('invite-employee', { body: { employee_id: id } });
    setInviting(false);
    if (error) {
      let code = ''; let detail = '';
      try { const b = await (error as any).context.json(); code = b.error || ''; detail = b.detail || ''; } catch { /* ignore */ }
      setInviteMsg('שגיאה: ' + (INVITE_ERR[code] || code || error.message) + (detail ? ` (${detail})` : ''));
      return;
    }
    setInviteMsg('הזמנה נשלחה למייל. אחרי לחיצה על הקישור המגייס ייכנס ויקבע סיסמה.'); load();
  }

  if (!isMgr) return <><PageHead title="עובד" /><p className="msg err">ניהול העובדים פתוח למנהלת בלבד.</p></>;
  if (err && !e) return <p className="msg err">{err}</p>;
  if (!e) return <p className="spinner">טוען…</p>;

  return (
    <>
      <PageHead title={e.full_name} sub={`${ROLE[e.role] ?? e.role}${e.job_title ? ' · ' + e.job_title : ''}`}
        action={<Link to="/employees" className="btn btn-quiet btn-sm">← לרשימה</Link>} />
      {err && <p className="msg err">{err}</p>}

      <div className="grid2">
        <form className="card" style={{ padding: 20, display:'grid', gap:14 }} onSubmit={saveDetails}>
          <h2 className="sec">פרטי עובד</h2>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <label><span className="lbl">שם מלא</span><input value={e.full_name ?? ''} onChange={ev=>setE({...e, full_name:ev.target.value})} /></label>
            <label><span className="lbl">דוא״ל</span><input type="email" dir="ltr" value={e.email ?? ''} onChange={ev=>setE({...e, email:ev.target.value})} /></label>
            <label><span className="lbl">טלפון</span><input dir="ltr" value={e.phone ?? ''} onChange={ev=>setE({...e, phone:ev.target.value})} /></label>
            <label><span className="lbl">תפקיד/משרה</span><input value={e.job_title ?? ''} onChange={ev=>setE({...e, job_title:ev.target.value})} /></label>
            <label><span className="lbl">תפקיד במערכת</span>
              <select value={e.role} onChange={ev=>setE({...e, role:ev.target.value})}>
                <option value="recruiter">מגייס</option><option value="manager">מנהלת החברה</option><option value="superadmin">מנהל על</option>
              </select></label>
            <label><span className="lbl">סטטוס העסקה</span>
              <select value={e.employment_status} onChange={ev=>setE({...e, employment_status:ev.target.value})}>
                <option value="active">פעיל</option><option value="suspended">מושבת</option><option value="ended">סיים</option>
              </select></label>
            <label><span className="lbl">תחילת עבודה</span><input type="date" value={e.hire_date ?? ''} onChange={ev=>setE({...e, hire_date:ev.target.value})} /></label>
          </div>
          <label><span className="lbl">הערות</span><textarea value={e.notes ?? ''} onChange={ev=>setE({...e, notes:ev.target.value})} rows={2} /></label>
          {saved && <p className="msg ok">הפרטים נשמרו.</p>}
          <div><button className="btn btn-primary btn-sm">שמירה</button></div>
        </form>

        <div style={{ display:'grid', gap:16 }}>
          <div className="card" style={{ padding: 20 }}>
            <h2 className="sec">כניסה למערכת</h2>
            {e.user_id
              ? <p className="msg ok">מקושר לכניסה{e.invited_at ? ` · הוזמן ${formatDate(e.invited_at)}` : ''}.</p>
              : <>
                  <p className="hint" style={{ marginBottom: 10 }}>שלחו הזמנה לדוא״ל <b dir="ltr">{e.email}</b>. המגייס ילחץ על הקישור, ייכנס למערכת ויקבע סיסמה.</p>
                  <button className="btn btn-primary btn-sm" disabled={inviting} onClick={invite}>{inviting ? 'שולח…' : '✉️ הזמן לכניסה'}</button>
                </>}
            {inviteMsg && <p className={'msg ' + (inviteMsg.startsWith('שגיאה') ? 'err' : 'ok')} style={{ marginTop: 10 }}>{inviteMsg}</p>}
          </div>
          <Documents empId={id!} rows={docs} onChange={load} />
          <Feedback empId={id!} authorId={employee?.id} rows={fb} onChange={load} />
        </div>
      </div>
      <style>{`
        .grid2 { display: grid; gap: 16px; grid-template-columns: 1.2fr 1fr; align-items: start; }
        .sec { font-size: 1.05rem; margin-bottom: 6px; }
        .doc-row, .fb-row { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
        .doc-row { display:flex; justify-content:space-between; align-items:center; gap:10px; }
        .fb-row { display:grid; gap:4px; }
        @media (max-width: 860px) { .grid2 { grid-template-columns: 1fr; } }
      `}</style>
    </>
  );
}

function Documents({ empId, rows, onChange }: { empId: string; rows: any[]; onChange: () => void }) {
  const [kind, setKind] = useState('contract');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  async function upload(file: File) {
    setBusy(true); setErr('');
    const path = `${empId}/${kind}/${Date.now()}-${file.name}`;
    const up = await supabase.storage.from(BUCKET).upload(path, file);
    if (up.error) { setErr(up.error.message); setBusy(false); return; }
    const ins = await supabase.from('employee_documents').insert({
      employee_id: empId, kind, file_name: file.name, storage_path: path, mime: file.type, size_bytes: file.size });
    setBusy(false);
    if (ins.error) setErr(ins.error.message); else onChange();
  }
  async function open(d: any) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(d.storage_path, 120);
    if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
  }
  async function remove(d: any) {
    if (!confirm('למחוק את המסמך?')) return;
    await supabase.storage.from(BUCKET).remove([d.storage_path]);
    await supabase.from('employee_documents').delete().eq('id', d.id);
    onChange();
  }

  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="sec">מסמכים ותעודות ({rows.length})</h2>
      <div style={{ display:'flex', gap:8, alignItems:'center', margin:'6px 0 12px', flexWrap:'wrap' }}>
        <select value={kind} onChange={e=>setKind(e.target.value)} style={{ flex:'0 0 auto' }}>
          {Object.entries(DOC_KIND).map(([k,l])=><option key={k} value={k}>{l}</option>)}
        </select>
        <label className="btn btn-quiet btn-sm" style={{ cursor:'pointer' }}>
          {busy ? 'מעלה…' : '+ העלאת קובץ'}
          <input type="file" hidden disabled={busy} onChange={e=>{ const file=e.target.files?.[0]; if(file) upload(file); e.currentTarget.value=''; }} />
        </label>
      </div>
      {err && <p className="msg err">{err}</p>}
      {rows.length === 0 ? <p className="hint">אין מסמכים.</p> : (
        <div style={{ display:'grid', gap:8 }}>
          {rows.map(d => (
            <div key={d.id} className="doc-row">
              <button className="linkish" style={{ background:'none', border:0, cursor:'pointer', textAlign:'start' }} onClick={()=>open(d)}>
                📄 {d.file_name}<br/><span className="hint">{DOC_KIND[d.kind] ?? d.kind} · {d.size_bytes?fmtSize(d.size_bytes):''} · {formatDate(d.created_at)}</span>
              </button>
              <button className="btn btn-quiet btn-sm" onClick={()=>remove(d)}>🗑</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Feedback({ empId, authorId, rows, onChange }: { empId: string; authorId?: string; rows: any[]; onChange: () => void }) {
  const [body, setBody] = useState(''); const [rating, setRating] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  async function add(ev: FormEvent) {
    ev.preventDefault(); const t = body.trim(); if (!t) return;
    setBusy(true); setErr('');
    const { error } = await supabase.from('employee_feedback').insert({
      employee_id: empId, author_id: authorId ?? null, rating: rating ? Number(rating) : null, body: t });
    setBusy(false);
    if (error) setErr(error.message); else { setBody(''); setRating(''); onChange(); }
  }
  return (
    <div className="card" style={{ padding: 20 }}>
      <h2 className="sec">משוב והערכות ({rows.length})</h2>
      <form onSubmit={add} style={{ display:'grid', gap:8, margin:'6px 0 12px' }}>
        <div style={{ display:'flex', gap:8 }}>
          <select value={rating} onChange={e=>setRating(e.target.value)} style={{ flex:'0 0 110px' }}>
            <option value="">ללא דירוג</option>{[5,4,3,2,1].map(n=><option key={n} value={n}>{'★'.repeat(n)}</option>)}
          </select>
          <input value={body} onChange={e=>setBody(e.target.value)} placeholder="משוב, הערכה, ציון לשבח…" style={{ flex:1 }} />
          <button className="btn btn-primary btn-sm" disabled={busy || !body.trim()}>הוספה</button>
        </div>
      </form>
      {err && <p className="msg err">{err}</p>}
      {rows.length === 0 ? <p className="hint">אין עדיין משוב.</p> : (
        <div style={{ display:'grid', gap:8 }}>
          {rows.map(g => (
            <div key={g.id} className="fb-row">
              {g.rating && <span style={{ color:'#e6a700' }}>{'★'.repeat(g.rating)}</span>}
              <div>{g.body}</div>
              <span className="hint">{formatDate(g.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
