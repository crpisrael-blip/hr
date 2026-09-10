import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

type Method = 'email' | 'phone';

// נרמול טלפון ישראלי לפורמט E.164 (תואם לשרת ולמפתח הכפילות).
function normPhone(raw: string): string {
  const d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+972')) return '+972' + d.slice(4).replace(/^0/, '');
  if (d.startsWith('972')) return '+972' + d.slice(3).replace(/^0/, '');
  if (d.startsWith('0')) return '+972' + d.slice(1);
  return d;
}

export default function Login() {
  const [method, setMethod] = useState<Method>('email');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const res = method === 'email'
      ? await supabase.auth.signInWithOtp({ email: contact.trim(), options: { shouldCreateUser: true } })
      : await supabase.auth.signInWithOtp({ phone: normPhone(contact), options: { shouldCreateUser: true } });
    if (res.error) setErr('שליחת הקוד נכשלה. בדקו את הפרטים ונסו שוב.');
    else setSent(true);
    setBusy(false);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const res = method === 'email'
      ? await supabase.auth.verifyOtp({ email: contact.trim(), token: code.trim(), type: 'email' })
      : await supabase.auth.verifyOtp({ phone: normPhone(contact), token: code.trim(), type: 'sms' });
    if (res.error) setErr('הקוד שגוי או שפג תוקפו.');
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={sent ? verify : sendCode}>
        <img className="login-logo" src="/ursa-logo.png" alt="URSA GROUP" />
        <h1>האזור האישי</h1>
        <p className="sub">מעקב אחרי המועמדויות שלך</p>

        {!sent && (
          <>
            <div className="seg" role="tablist">
              <button type="button" role="tab" aria-selected={method === 'email'}
                className={method === 'email' ? 'on' : ''} onClick={() => setMethod('email')}>דוא״ל</button>
              <button type="button" role="tab" aria-selected={method === 'phone'}
                className={method === 'phone' ? 'on' : ''} onClick={() => setMethod('phone')}>טלפון</button>
            </div>
            <label><span className="lbl">{method === 'email' ? 'כתובת דוא״ל' : 'מספר טלפון'}</span>
              <input
                type={method === 'email' ? 'email' : 'tel'}
                inputMode={method === 'email' ? 'email' : 'tel'}
                value={contact} onChange={e => setContact(e.target.value)}
                dir="ltr" required autoFocus
                placeholder={method === 'email' ? 'name@example.com' : '050-000-0000'} /></label>
          </>
        )}

        {sent && (
          <>
            <p className="msg">שלחנו קוד בן 6 ספרות אל <b dir="ltr">{contact}</b>.</p>
            <label><span className="lbl">קוד אימות</span>
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                value={code} onChange={e => setCode(e.target.value)} dir="ltr" required autoFocus
                style={{ letterSpacing: '.4em', textAlign: 'center', fontSize: '1.2rem' }} /></label>
            <button type="button" className="linkish" onClick={() => { setSent(false); setCode(''); }}>
              החלפת הפרטים / שליחה מחדש</button>
          </>
        )}

        {err && <p className="msg err">{err}</p>}
        <button className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? '…' : sent ? 'כניסה' : 'שליחת קוד'}</button>
      </form>
    </div>
  );
}
