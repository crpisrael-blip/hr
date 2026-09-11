import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { useTitle } from '../lib/useTitle';

// מחובר אך אין רשומת מועמד מקושרת — או שבדיקת הקישור נכשלה.
// שני המצבים שונים לגמרי ולכן מקבלים טקסט שונה.
export default function Unlinked() {
  const { refresh, signOut, link, linkError } = useAuth();
  const failed = link === 'error';
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useTitle(failed ? 'לא הצלחנו לקשר את החשבון' : 'לא נמצאה מועמדות');

  async function onRefresh() {
    setBusy(true); setNote('');
    const next = await refresh();
    setBusy(false);
    if (next === 'unlinked') setNote('עדיין לא נמצאה מועמדות המשויכת לפרטים האלה.');
    else if (next === 'error') setNote('הבדיקה נכשלה. נסו שוב בעוד רגע.');
  }

  return (
    <div className="login-wrap">
      <div className="card login" style={{ textAlign: 'center' }}>
        <img className="login-logo" src="/ursa-logo.png" alt="URSA GROUP" />
        <h1>{failed ? 'לא הצלחנו לקשר את החשבון' : 'עוד לא מצאנו מועמדות'}</h1>
        <p className="sub">
          {failed
            ? (linkError || 'בדיקת הקישור לחשבון נכשלה. ייתכן שזו תקלה זמנית בחיבור — אפשר לנסות שוב.')
            : 'לא נמצאה מועמדות המשויכת לפרטים שאיתם נכנסת.'}
        </p>
        {!failed && (
          <p className="sub">
            אם הגשת מועמדות דרך אתר המשרות, הכניסה צריכה להיות עם <b>אותו מספר טלפון</b>
            {' '}שמסרת בהגשה. הגשת דרך מגייס/ת? נסו את הדוא״ל שמסרתם.
          </p>
        )}

        <button type="button" className="btn btn-primary" disabled={busy}
          style={{ width: '100%', marginTop: 8 }} onClick={onRefresh}>
          {busy ? 'בודק…' : 'בדיקה מחדש'}
        </button>

        {note && <p className="msg" role="status" aria-live="polite" style={{ marginTop: 10 }}>{note}</p>}

        <button type="button" className="linkish" onClick={signOut} style={{ marginTop: 12 }}>
          התחברות עם פרטים אחרים
        </button>
      </div>
    </div>
  );
}
