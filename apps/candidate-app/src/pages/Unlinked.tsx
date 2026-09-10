import { useAuth } from '../lib/auth';

// מחובר אך אין רשומת מועמד: כנראה נכנס בטלפון/דוא"ל שלא הגיש בו למשרה.
export default function Unlinked() {
  const { refresh, signOut } = useAuth();
  return (
    <div className="login-wrap">
      <div className="card login" style={{ textAlign: 'center' }}>
        <img className="login-logo" src="/ursa-logo.png" alt="URSA GROUP" />
        <h1>עוד לא מצאנו מועמדות</h1>
        <p className="sub">
          לא נמצאה מועמדות המשויכת לפרטים שאיתם נכנסת. אם הגשת מועמדות,
          נסה/י להתחבר עם אותו טלפון או דוא״ל שאיתו הגשת.
        </p>
        <a className="btn btn-primary" href="/" onClick={e => { e.preventDefault(); refresh(); }}
          style={{ width: '100%', marginTop: 8 }}>רענון</a>
        <button className="linkish" onClick={signOut} style={{ marginTop: 12 }}>התחברות עם פרטים אחרים</button>
      </div>
    </div>
  );
}
