import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ASSIGNABLE_ROLES, EMP_STATUS, ROLE, label } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import { PAGE_SIZE } from '../lib/config';
import PageHead from '../components/PageHead';
import Contact from '../components/Contact';
import { Msg, Loading, EmptyState } from '../components/Msg';

interface Row {
  id: string; full_name: string; email: string; phone: string | null;
  role: string; job_title: string | null; employment_status: string; hire_date: string | null;
}

export default function Employees() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ full_name: '', email: '', phone: '', role: 'recruiter', job_title: '', hire_date: '' });
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [more, setMore] = useState(false);
  const set = (k: string, v: string) => setF(s => ({ ...s, [k]: v }));

  async function load() {
    const r = await supabase.from('employees')
      .select('id, full_name, email, phone, role, job_title, employment_status, hire_date')
      .order('full_name').limit(limit);
    if (r.error) { setErr(toUserMessage(r.error, 'טעינת רשימת העובדים נכשלה.')); return; }
    const data = r.data as Row[];
    setErr(''); setRows(data); setMore(data.length >= limit);
  }
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [limit]);

  async function add(e: FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    const { error } = await supabase.from('employees').insert({
      full_name: f.full_name.trim(), email: f.email.trim().toLowerCase(), phone: f.phone.trim() || null,
      role: f.role, job_title: f.job_title.trim() || null, hire_date: f.hire_date || null,
      employment_status: 'active',
    });
    setBusy(false);
    if (error) { setErr(error.code === '23505' ? 'קיים כבר עובד עם דוא״ל זה.' : toUserMessage(error, 'הוספת העובד נכשלה.')); return; }
    setF({ full_name: '', email: '', phone: '', role: 'recruiter', job_title: '', hire_date: '' });
    setAdding(false); load();
  }

  return (
    <>
      <PageHead title="מגייסים" sub="ניהול הצוות: פרטים, מסמכים ומשוב"
        action={<button className="btn btn-primary btn-sm" onClick={() => setAdding(a => !a)} aria-expanded={adding}>{adding ? 'ביטול' : '+ מגייס'}</button>} />
      <Msg kind="err">{err}</Msg>

      {adding && (
        <form className="card" style={{ padding: 20, marginBottom: 16, display: 'grid', gap: 14, maxWidth: 640 }} onSubmit={add}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 14 }}>
            <label><span className="lbl">שם מלא *</span><input value={f.full_name} onChange={e => set('full_name', e.target.value)} required autoFocus /></label>
            <label><span className="lbl">דוא״ל *</span><input type="email" dir="ltr" value={f.email} onChange={e => set('email', e.target.value)} required /></label>
            <label><span className="lbl">טלפון</span><input type="tel" dir="ltr" value={f.phone} onChange={e => set('phone', e.target.value)} /></label>
            <label><span className="lbl">תפקיד במערכת</span>
              <select value={f.role} onChange={e => set('role', e.target.value)}>
                {ASSIGNABLE_ROLES.map(k => <option key={k} value={k}>{ROLE[k]}</option>)}
              </select></label>
            <label><span className="lbl">תפקיד/משרה</span><input value={f.job_title} onChange={e => set('job_title', e.target.value)} placeholder="מגייס בכיר" /></label>
            <label><span className="lbl">תחילת עבודה</span><input type="date" value={f.hire_date} onChange={e => set('hire_date', e.target.value)} /></label>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={busy || !f.full_name || !f.email}>{busy ? 'שומר…' : 'הוספה'}</button>
          </div>
          <p className="hint">הוספה כאן יוצרת כרטיס עובד. הזמנה לכניסה נשלחת מתוך כרטיס העובד.</p>
        </form>
      )}

      {!rows && !err && <Loading />}
      {rows && rows.length === 0 && <EmptyState>אין עדיין עובדים.</EmptyState>}
      {rows && rows.length > 0 && (
        <div className="record-grid">
          {rows.map(r => (
            <article className="card record-card" key={r.id}>
              <header>
                <span className="tag brand">{label(ROLE, r.role)}</span>
                <span className={'tag ' + (r.employment_status === 'active' ? 'ok' : 'mute')}>{label(EMP_STATUS, r.employment_status)}</span>
              </header>
              <h2><Link to={`/employees/${r.id}`}>{r.full_name}</Link></h2>
              <dl>
                <dt>תפקיד</dt><dd>{r.job_title ?? '—'}</dd>
                <dt>דוא״ל</dt><dd><Contact kind="email" value={r.email} /></dd>
                <dt>טלפון</dt><dd><Contact kind="phone" value={r.phone} /></dd>
              </dl>
            </article>
          ))}
        </div>
      )}
      {rows && more && (
        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button className="btn btn-quiet btn-sm" onClick={() => setLimit(l => l + PAGE_SIZE)}>הצגת עוד עובדים</button>
        </div>
      )}
    </>
  );
}
