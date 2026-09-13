import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { reportError } from '../lib/errors';
import { useTitle } from '../lib/useTitle';

interface ProfileData {
  id: string; full_name: string; email: string | null; phone: string | null;
  availability: string | null; desired_salary: number | null;
  years_experience: number | null; skills: string[] | null;
  preferences: Record<string, unknown>; editable_fields: string[];
}

interface Form { full_name: string; email: string; availability: string; desired_salary: string }

const MAX_TEXT = 120;

const toForm = (p: ProfileData): Form => ({
  full_name: p.full_name ?? '',
  email: p.email ?? '',
  availability: p.availability ?? '',
  desired_salary: p.desired_salary != null ? String(p.desired_salary) : '',
});

export default function Profile() {
  useTitle('הפרופיל שלי');
  const [p, setP] = useState<ProfileData | null>(null);
  const [form, setForm] = useState<Form>({ full_name: '', email: '', availability: '', desired_salary: '' });
  const [loadErr, setLoadErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState('');
  const [fieldErr, setFieldErr] = useState<keyof Form | ''>('');

  const load = useCallback(async () => {
    setLoadErr('');
    const { data, error } = await supabase.rpc('my_profile');
    if (error) {
      // בלי זה: setP לא נקרא לעולם והדף נשאר על spinner עד אינסוף.
      setLoadErr(reportError('my_profile', error, 'טעינת הפרופיל נכשלה.'));
      return;
    }
    const prof = data as ProfileData | null;
    if (!prof) { setLoadErr('לא נמצא פרופיל מקושר לחשבון.'); return; }
    setP(prof);
    setForm(toForm(prof));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const can = (f: string) => p?.editable_fields?.includes(f) ?? false;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!p) return;
    setErr(''); setFieldErr(''); setSaved(false);

    // ולידציה בצד לקוח כדי שלא נקבל שגיאת המרה גולמית מהשרת.
    if (can('full_name') && !form.full_name.trim()) {
      setErr('נא למלא שם מלא.'); setFieldErr('full_name'); return;
    }
    if (can('full_name') && form.full_name.trim().length > MAX_TEXT) {
      setErr(`השם ארוך מדי (עד ${MAX_TEXT} תווים).`); setFieldErr('full_name'); return;
    }
    if (can('email') && form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) {
      setErr('כתובת הדוא״ל אינה תקינה.'); setFieldErr('email'); return;
    }
    if (can('availability') && form.availability.length > MAX_TEXT) {
      setErr(`הטקסט ארוך מדי (עד ${MAX_TEXT} תווים).`); setFieldErr('availability'); return;
    }
    if (can('desired_salary') && form.desired_salary && !/^\d{1,9}$/.test(form.desired_salary)) {
      setErr('שכר מבוקש — נא להזין מספר שלם בלבד.'); setFieldErr('desired_salary'); return;
    }

    setBusy(true);
    // נשלחים רק שדות שהשתנו בפועל. update_my_profile מרשה לערוך דוא"ל רק אם
    // הוא זהה לזה שאומת בכניסה (0023:857-864) — שליחת ערך שלא נגעו בו הייתה
    // מפילה את השמירה כולה על פרופיל שדוא"לו נקבע ע"י המגייס.
    const base = toForm(p);
    const patch: Record<string, unknown> = {};
    if (can('full_name') && form.full_name.trim() !== base.full_name) patch.full_name = form.full_name.trim();
    if (can('email') && form.email.trim() !== base.email) patch.email = form.email.trim();
    if (can('availability') && form.availability.trim() !== base.availability) patch.availability = form.availability.trim();
    if (can('desired_salary') && form.desired_salary.trim() !== base.desired_salary) patch.desired_salary = form.desired_salary.trim();
    if (Object.keys(patch).length === 0) { setBusy(false); setSaved(true); return; }
    const { data, error } = await supabase.rpc('update_my_profile', { p: patch });
    setBusy(false);
    if (error) { setErr(reportError('update_my_profile', error, 'השמירה נכשלה. נסו שוב.')); return; }

    const next = data as ProfileData | null;
    if (next) { setP(next); setForm(toForm(next)); } // סנכרון הטופס עם מה שהשרת באמת שמר
    setSaved(true);
  }

  if (!p) {
    if (loadErr) return (
      <section className="page">
        <h1 className="page-title">הפרופיל שלי</h1>
        <div className="card">
          <p className="msg err" role="alert">{loadErr}</p>
          <button type="button" className="btn btn-primary" style={{ width: '100%' }}
            onClick={() => void load()}>נסו שוב</button>
        </div>
      </section>
    );
    return <div className="screen-center"><div className="spinner" role="status" aria-label="טוען" /></div>;
  }

  const describe = (f: keyof Form) => (fieldErr === f ? 'profile-err' : undefined);
  const invalid = (f: keyof Form) => (fieldErr === f ? true : undefined);

  return (
    <section className="page">
      <h1 className="page-title">הפרופיל שלי</h1>
      <form className="card form" onSubmit={save} noValidate>
        <div className="field">
          <label className="lbl" htmlFor="pf-name">שם מלא</label>
          <input id="pf-name" value={form.full_name} disabled={!can('full_name')} maxLength={MAX_TEXT}
            autoComplete="name" aria-invalid={invalid('full_name')} aria-describedby={describe('full_name')}
            onChange={e => setForm({ ...form, full_name: e.target.value })} />
        </div>

        <div className="field">
          <label className="lbl" htmlFor="pf-email">דוא״ל</label>
          <input id="pf-email" type="email" dir="ltr" value={form.email} disabled={!can('email')}
            autoComplete="email" aria-invalid={invalid('email')}
            aria-describedby={describe('email') ?? 'pf-email-hint'}
            onChange={e => setForm({ ...form, email: e.target.value })} />
          {can('email') && <span className="hint" id="pf-email-hint">
            אפשר לעדכן רק לכתובת שאיתה נכנסת לאזור האישי. לשינוי כתובת אחרת — פנו למגייס/ת.
          </span>}
        </div>

        <div className="field">
          <label className="lbl" htmlFor="pf-phone">טלפון</label>
          <input id="pf-phone" dir="ltr" value={p.phone ?? ''} disabled aria-describedby="pf-phone-hint" />
          <span className="hint" id="pf-phone-hint">מספר הטלפון משמש לזיהוי ואינו ניתן לשינוי כאן.</span>
        </div>

        <div className="field">
          <label className="lbl" htmlFor="pf-avail">זמינות להתחלה</label>
          <input id="pf-avail" value={form.availability} disabled={!can('availability')} maxLength={MAX_TEXT}
            placeholder="מיידי / חודש הודעה מוקדמת"
            aria-invalid={invalid('availability')} aria-describedby={describe('availability')}
            onChange={e => setForm({ ...form, availability: e.target.value })} />
        </div>

        <div className="field">
          <label className="lbl" htmlFor="pf-salary">שכר מבוקש (₪)</label>
          <input id="pf-salary" type="text" inputMode="numeric" dir="ltr" maxLength={9}
            value={form.desired_salary} disabled={!can('desired_salary')}
            aria-invalid={invalid('desired_salary')} aria-describedby={describe('desired_salary')}
            onChange={e => setForm({ ...form, desired_salary: e.target.value.replace(/\D/g, '') })} />
        </div>

        {err && <p className="msg err" id="profile-err" role="alert">{err}</p>}
        {saved && <p className="msg ok" role="status" aria-live="polite">הפרטים נשמרו.</p>}
        <button className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'שומר…' : 'שמירה'}
        </button>
      </form>
    </section>
  );
}
