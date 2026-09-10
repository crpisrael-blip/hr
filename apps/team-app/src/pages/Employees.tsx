import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import PageHead from '../components/PageHead';

const ROLE: Record<string,string> = { recruiter:'מגייס', manager:'מנהלת החברה', superadmin:'מנהל על' };
const EMP_STATUS: Record<string,string> = { active:'פעיל', suspended:'מושבת', ended:'סיים' };

export default function Employees() {
  const { employee } = useAuth();
  const isMgr = employee?.role === 'manager' || employee?.role === 'superadmin';
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ full_name:'', email:'', phone:'', role:'recruiter', job_title:'', hire_date:'' });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));

  async function load() {
    const r = await supabase.from('employees')
      .select('id, full_name, email, phone, role, job_title, employment_status, hire_date')
      .order('full_name');
    if (r.error) setErr(r.error.message); else setRows(r.data);
  }
  useEffect(() => { load(); }, []);

  async function add(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await supabase.from('employees').insert({
      full_name: f.full_name.trim(), email: f.email.trim(), phone: f.phone.trim() || null,
      role: f.role, job_title: f.job_title.trim() || null, hire_date: f.hire_date || null,
      employment_status: 'active',
    });
    setBusy(false);
    if (error) { setErr(error.code === '23505' ? 'קיים כבר עובד עם דוא״ל זה.' : error.message); return; }
    setF({ full_name:'', email:'', phone:'', role:'recruiter', job_title:'', hire_date:'' });
    setAdding(false); load();
  }

  if (!isMgr) return <><PageHead title="מגייסים" /><p className="msg err">ניהול העובדים פתוח למנהלת בלבד.</p></>;

  return (
    <>
      <PageHead title="מגייסים" sub="ניהול הצוות: פרטים, מסמכים ומשוב"
        action={<button className="btn btn-primary btn-sm" onClick={()=>setAdding(a=>!a)}>{adding?'ביטול':'+ מגייס'}</button>} />
      {err && <p className="msg err">{err}</p>}

      {adding && (
        <form className="card" style={{ padding: 20, marginBottom: 16, display:'grid', gap:14, maxWidth:640 }} onSubmit={add}>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            <label><span className="lbl">שם מלא *</span><input value={f.full_name} onChange={e=>set('full_name',e.target.value)} required autoFocus /></label>
            <label><span className="lbl">דוא״ל *</span><input type="email" dir="ltr" value={f.email} onChange={e=>set('email',e.target.value)} required /></label>
            <label><span className="lbl">טלפון</span><input dir="ltr" value={f.phone} onChange={e=>set('phone',e.target.value)} /></label>
            <label><span className="lbl">תפקיד במערכת</span>
              <select value={f.role} onChange={e=>set('role',e.target.value)}>
                <option value="recruiter">מגייס</option><option value="manager">מנהלת החברה</option>
              </select></label>
            <label><span className="lbl">תפקיד/משרה</span><input value={f.job_title} onChange={e=>set('job_title',e.target.value)} placeholder="מגייס בכיר" /></label>
            <label><span className="lbl">תחילת עבודה</span><input type="date" value={f.hire_date} onChange={e=>set('hire_date',e.target.value)} /></label>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !f.full_name || !f.email}>{busy?'שומר…':'הוספה'}</button>
          </div>
          <p className="hint">הוספה כאן יוצרת כרטיס עובד. חיבור חשבון כניסה (התחברות) נעשה בנפרד דרך Supabase Authentication + קישור, או במסך ההזמנה שיתווסף.</p>
        </form>
      )}

      {!rows && !err && <p className="spinner">טוען…</p>}
      {rows && rows.length === 0 && <div className="card empty">אין עדיין עובדים.</div>}
      {rows && rows.length > 0 && (
        <div className="record-grid">
          {rows.map(r => (
            <Link to={`/employees/${r.id}`} className="card record-card" key={r.id} style={{ textDecoration:'none', color:'inherit' }}>
              <header>
                <span className="tag brand">{ROLE[r.role] ?? r.role}</span>
                <span className={'tag ' + (r.employment_status==='active'?'ok':'mute')}>{EMP_STATUS[r.employment_status] ?? r.employment_status}</span>
              </header>
              <h2>{r.full_name}</h2>
              <dl>
                <dt>תפקיד</dt><dd>{r.job_title ?? '—'}</dd>
                <dt>דוא״ל</dt><dd dir="ltr" style={{ textAlign:'start' }}>{r.email}</dd>
                <dt>טלפון</dt><dd dir="ltr" style={{ textAlign:'start' }}>{r.phone ?? '—'}</dd>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
