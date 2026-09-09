import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr('התחברות נכשלה. בדקו דוא״ל וסיסמה.');
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <form className="card login" onSubmit={onSubmit}>
        <picture>
          <source srcSet="/ursa-logo-dark.png" media="(prefers-color-scheme: dark)" />
          <img src="/ursa-logo.png" alt="URSA GROUP" style={{ height: 38, width: 'auto', marginInline: 'auto' }} />
        </picture>
        <h1>ניהול הגיוס</h1>
        <p className="sub">כניסה לצוות החברה</p>
        <label><span className="lbl">דוא״ל</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" autoFocus /></label>
        <label><span className="lbl">סיסמה</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} required autoComplete="current-password" /></label>
        {err && <p className="msg err">{err}</p>}
        <button className="btn btn-primary" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'מתחבר…' : 'כניסה'}</button>
      </form>
      <style>{`
        .login-wrap { min-height: 100vh; display: grid; place-items: center; padding: 20px;
          background: radial-gradient(120% 90% at 100% 0, var(--brand-soft) 0, var(--surface) 55%); }
        .login { width: 100%; max-width: 380px; padding: 32px; display: grid; gap: 14px; }
        
        .login h1 { font-size: 1.3rem; margin-top: 6px; }
        .login .sub { color: var(--ink-mid); margin-bottom: 6px; }
      `}</style>
    </div>
  );
}
