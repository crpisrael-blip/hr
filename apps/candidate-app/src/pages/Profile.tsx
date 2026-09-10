import { useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

interface Profile {
  id: string; full_name: string; email: string | null; phone: string | null;
  availability: string | null; desired_salary: number | null;
  years_experience: number | null; skills: string[] | null;
  preferences: Record<string, unknown>; editable_fields: string[];
}

export default function Profile() {
  const [p, setP] = useState<Profile | null>(null);
  const [form, setForm] = useState({ full_name: '', email: '', availability: '', desired_salary: '' });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    supabase.rpc('my_profile').then(({ data }) => {
      const prof = data as Profile | null;
      setP(prof);
      if (prof) setForm({
        full_name: prof.full_name ?? '',
        email: prof.email ?? '',
        availability: prof.availability ?? '',
        desired_salary: prof.desired_salary != null ? String(prof.desired_salary) : '',
      });
    });
  }, []);

  const can = (f: string) => p?.editable_fields?.includes(f) ?? false;

  async function save(e: FormEvent) {
    e.preventDefault();
    setErr(''); setSaved(false); setBusy(true);
    const patch: Record<string, unknown> = {};
    if (can('full_name')) patch.full_name = form.full_name;
    if (can('email')) patch.email = form.email;
    if (can('availability')) patch.availability = form.availability;
    if (can('desired_salary')) patch.desired_salary = form.desired_salary;
    const { data, error } = await supabase.rpc('update_my_profile', { p: patch });
    if (error) setErr('השמירה נכשלה.');
    else { setP(data as Profile); setSaved(true); }
    setBusy(false);
  }

  if (!p) return <div className="screen-center"><div className="spinner" /></div>;

  return (
    <section className="page">
      <h1 className="page-title">הפרופיל שלי</h1>
      <form className="card form" onSubmit={save}>
        <label><span className="lbl">שם מלא</span>
          <input value={form.full_name} disabled={!can('full_name')}
            onChange={e => setForm({ ...form, full_name: e.target.value })} /></label>

        <label><span className="lbl">דוא״ל</span>
          <input type="email" dir="ltr" value={form.email} disabled={!can('email')}
            onChange={e => setForm({ ...form, email: e.target.value })} /></label>

        <label><span className="lbl">טלפון</span>
          <input dir="ltr" value={p.phone ?? ''} disabled />
          <span className="hint">מספר הטלפון משמש לזיהוי ואינו ניתן לשינוי כאן.</span></label>

        <label><span className="lbl">זמינות להתחלה</span>
          <input value={form.availability} disabled={!can('availability')}
            placeholder="מיידי / חודש הודעה מוקדמת"
            onChange={e => setForm({ ...form, availability: e.target.value })} /></label>

        <label><span className="lbl">שכר מבוקש (₪)</span>
          <input type="number" dir="ltr" value={form.desired_salary} disabled={!can('desired_salary')}
            onChange={e => setForm({ ...form, desired_salary: e.target.value })} /></label>

        {err && <p className="msg err">{err}</p>}
        {saved && <p className="msg ok">הפרטים נשמרו.</p>}
        <button className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'שומר…' : 'שמירה'}</button>
      </form>
    </section>
  );
}
