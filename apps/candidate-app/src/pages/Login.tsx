import { useEffect, useRef, useState, type FormEvent } from 'react';
import { supabase, PHONE_OTP_ENABLED } from '../lib/supabase';
import { normPhone, isLikelyEmail, isValidPhone } from '../lib/shared';
import { logError, isNetworkError } from '../lib/errors';
import { useTitle } from '../lib/useTitle';

type Method = 'email' | 'phone';

const RESEND_SECONDS = 60;

// Supabase מחזיר 429 עם code ייעודי כשחורגים ממכסת השליחה.
function sendErrorText(err: { status?: number; code?: string; message?: string } | null): string {
  if (!err) return '';
  if (isNetworkError(err)) return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.';
  if (err.status === 429 || (err.code ?? '').includes('rate_limit')) {
    return 'נשלחו יותר מדי קודים. נסו שוב בעוד דקה.';
  }
  if (err.status === 422) return 'הפרטים אינם תקינים. בדקו את הכתובת או המספר ונסו שוב.';
  return 'שליחת הקוד נכשלה. נסו שוב בעוד רגע.';
}

export default function Login() {
  useTitle('כניסה');
  const [method, setMethod] = useState<Method>('email');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  // טיימר ה-cooldown: מונע הצפה של בקשות OTP לפני שהשרת חוסם.
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown(c => (c <= 1 ? 0 : c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  // מעבר לשלב הקוד — מיקוד לשדה כדי שקורא מסך והמקלדת ימשיכו ברצף.
  useEffect(() => { if (sent) codeRef.current?.focus(); }, [sent]);

  const contactValid = method === 'email' ? isLikelyEmail(contact) : isValidPhone(contact);

  async function requestCode(): Promise<boolean> {
    if (cooldown > 0 || busy) return false;
    if (!contactValid) {
      setErr(method === 'email'
        ? 'כתובת הדוא״ל אינה תקינה.'
        : 'מספר הטלפון אינו תקין. לדוגמה: 050-0000000.');
      return false;
    }
    setErr(''); setNote(''); setBusy(true);
    const res = method === 'email'
      ? await supabase.auth.signInWithOtp({ email: contact.trim(), options: { shouldCreateUser: true } })
      : await supabase.auth.signInWithOtp({ phone: normPhone(contact), options: { shouldCreateUser: true } });
    setBusy(false);
    if (res.error) {
      logError('signInWithOtp', res.error);
      setErr(sendErrorText(res.error));
      if (res.error.status === 429) setCooldown(RESEND_SECONDS);
      return false;
    }
    setCooldown(RESEND_SECONDS);
    return true;
  }

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (await requestCode()) { setSent(true); setCode(''); }
  }

  async function resend() {
    if (await requestCode()) setNote('שלחנו קוד חדש.');
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setErr(''); setNote(''); setBusy(true);
    const res = method === 'email'
      ? await supabase.auth.verifyOtp({ email: contact.trim(), token: code.trim(), type: 'email' })
      : await supabase.auth.verifyOtp({ phone: normPhone(contact), token: code.trim(), type: 'sms' });
    setBusy(false);
    if (res.error) {
      logError('verifyOtp', res.error);
      setErr(isNetworkError(res.error)
        ? 'אין חיבור לשרת. בדקו את החיבור לאינטרנט ונסו שוב.'
        : 'הקוד שגוי או שפג תוקפו. אפשר לבקש קוד חדש.');
      codeRef.current?.focus();
    }
  }

  const errId = 'login-err';
  const noteId = 'login-note';

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={sent ? verify : sendCode} noValidate>
        <img className="login-logo" src="/ursa-logo.png" alt="URSA GROUP" />
        <h1>האזור האישי</h1>
        <p className="sub">מעקב אחרי המועמדויות שלך</p>

        {!sent && (
          <>
            {/* קבוצת רדיו ולא tablist: אין כאן tabpanel, וזו בחירת שיטה.
                הרדיו נותן ניווט בחיצים ושיוך קבוצה בלי ARIA ידני. */}
            {PHONE_OTP_ENABLED && (
              <fieldset className="seg-set">
                <legend className="sr-only">שיטת כניסה</legend>
                <div className="seg">
                  {([['email', 'דוא״ל'], ['phone', 'טלפון']] as [Method, string][]).map(([id, label]) => (
                    <label key={id} className={'seg-opt' + (method === id ? ' on' : '')}>
                      <input className="sr-only" type="radio" name="login-method" value={id}
                        checked={method === id}
                        onChange={() => { setMethod(id); setContact(''); setErr(''); }} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            <div className="field">
              <label htmlFor="login-contact" className="lbl">
                {method === 'email' ? 'כתובת דוא״ל' : 'מספר טלפון'}
              </label>
              <input
                id="login-contact"
                type={method === 'email' ? 'email' : 'tel'}
                inputMode={method === 'email' ? 'email' : 'tel'}
                autoComplete={method === 'email' ? 'email' : 'tel'}
                name={method === 'email' ? 'email' : 'tel'}
                value={contact} onChange={e => { setContact(e.target.value); setErr(''); }}
                dir="ltr" required autoFocus
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? errId : undefined}
                placeholder={method === 'email' ? 'name@example.com' : '050-000-0000'} />
            </div>
          </>
        )}

        {sent && (
          <>
            <p className="msg">שלחנו קוד חד־פעמי אל <bdi dir="ltr">{contact}</bdi>.</p>
            <div className="field">
              <label htmlFor="login-code" className="lbl">קוד אימות</label>
              <input
                id="login-code" ref={codeRef}
                type="text" inputMode="numeric" pattern="[0-9]*" maxLength={8}
                autoComplete="one-time-code" name="one-time-code"
                value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setErr(''); }}
                dir="ltr" required
                aria-invalid={err ? true : undefined}
                aria-describedby={err ? errId : undefined}
                className="otp-input" />
            </div>
            <div className="login-actions">
              <button type="button" className="linkish" disabled={busy || cooldown > 0} onClick={resend}>
                {cooldown > 0 ? `שליחה מחדש בעוד ${cooldown} שניות` : 'שליחת קוד חדש'}
              </button>
              <button type="button" className="linkish"
                onClick={() => { setSent(false); setCode(''); setErr(''); setNote(''); }}>
                החלפת הפרטים
              </button>
            </div>
          </>
        )}

        {err && <p className="msg err" id={errId} role="alert">{err}</p>}
        {note && <p className="msg ok" id={noteId} role="status" aria-live="polite">{note}</p>}

        <button className="btn btn-primary" disabled={busy || (!sent && cooldown > 0)} style={{ width: '100%' }}>
          {busy ? 'רגע…' : sent ? 'כניסה' : cooldown > 0 ? `שליחת קוד בעוד ${cooldown} שניות` : 'שליחת קוד'}
        </button>
      </form>
    </div>
  );
}
