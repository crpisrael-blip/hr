import { useState, type ReactNode, type FormEvent } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth, isManager } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { ROLE, initials, label } from '../lib/format';
import { toUserMessage } from '../lib/errors';
import Icon from './Icon';
import Dialog from './Dialog';
import { Msg } from './Msg';

interface NavItem { to: string; label: string; icon: string; end?: boolean; managerOnly?: boolean }

const NAV: NavItem[] = [
  { to: '/', label: 'דף הבית', icon: 'home', end: true },
  { to: '/jobs', label: 'משרות', icon: 'jobs' },
  { to: '/candidates', label: 'מועמדים', icon: 'candidates' },
  { to: '/companies', label: 'לקוחות', icon: 'companies' },
  { to: '/applications', label: 'תהליכי גיוס', icon: 'applications' },
  { to: '/placements', label: 'השמות', icon: 'placements' },
  { to: '/finance', label: 'כספים', icon: 'placements', managerOnly: true },
  { to: '/reports', label: 'דוחות', icon: 'reports' },
  { to: '/tasks', label: 'משימות', icon: 'tasks' },
  { to: '/employees', label: 'מגייסים', icon: 'candidates', managerOnly: true },
  { to: '/forms', label: 'טפסים', icon: 'reports' },
  { to: '/calendar', label: 'לוח שנה', icon: 'calendar' },
  { to: '/settings', label: 'הגדרות', icon: 'settings', managerOnly: true },
];

const MIN_PASSWORD = 8;

export default function Layout({ children }: { children: ReactNode }) {
  const { employee, signOut } = useAuth();
  const isHome = useLocation().pathname === '/';
  const [menu, setMenu] = useState<'' | 'account' | 'password' | 'signout'>('');
  const [pw, setPw] = useState({ a: '', b: '' });
  const [pwErr, setPwErr] = useState(''); const [pwOk, setPwOk] = useState('');
  const [busy, setBusy] = useState(false);

  const items = NAV.filter(n => !n.managerOnly || isManager(employee));

  async function changePassword(e?: FormEvent) {
    e?.preventDefault();
    setPwErr(''); setPwOk('');
    if (pw.a.length < MIN_PASSWORD) { setPwErr(`הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD} תווים.`); return; }
    if (pw.a !== pw.b) { setPwErr('הסיסמאות אינן תואמות.'); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw.a });
    setBusy(false);
    if (error) { setPwErr(toUserMessage(error, 'שינוי הסיסמה נכשל.')); return; }
    setPw({ a: '', b: '' }); setPwOk('הסיסמה עודכנה.');
  }

  return (
    <div className={'shell' + (isHome ? ' home-shell' : '')} dir="rtl">
      <a className="skip-link" href="#main-content">דלגו לתוכן הראשי</a>
      <aside className="side">
        <div className="side-logo">
          <picture>
            <img src="/ursa-logo.png" alt="URSA GROUP" />
          </picture>
        </div>
        <nav aria-label="תפריט ראשי">
          {items.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
              <span className="ic" aria-hidden="true"><Icon name={n.icon} /></span><span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="promo">
          <div className="promo-leaves" aria-hidden="true"><i/><i/><i/><i/><i/></div><div className="promo-title">אנשים מניעים עסקים</div>
          <p>הכישרון הנכון במקום הנכון, יוצר את המחר.</p>
        </div>
        {/* לחיצה על כרטיס המשתמש פותחת תפריט חשבון — לא מנתקת מיד. */}
        <button className="user-chip" onClick={() => setMenu('account')}
          aria-label={`תפריט חשבון — ${employee?.full_name ?? ''}`} aria-haspopup="dialog">
          <span className="ava" aria-hidden="true">{initials(employee?.full_name)}</span>
          <span className="who">
            <span className="who-name">{employee?.full_name}</span>
            <span className="who-role">{label(ROLE, employee?.role)}</span>
          </span>
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <p className="topbar-who">
            <span className="ava sm" aria-hidden="true">{initials(employee?.full_name)}</span>
            <span>{employee?.full_name}</span>
          </p>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>{children}</main>
      </div>

      <Dialog open={menu === 'account'} title="החשבון שלי" onClose={() => setMenu('')}
        description={employee ? `${employee.full_name} · ${label(ROLE, employee.role)}` : undefined}
        footer={<>
          <button className="btn btn-quiet" onClick={() => { setPwErr(''); setPwOk(''); setMenu('password'); }}>שינוי סיסמה</button>
          <button className="btn btn-quiet" onClick={() => setMenu('signout')}>יציאה מהמערכת</button>
        </>}>
        <p className="hint" dir="ltr" style={{ textAlign: 'start' }}>{employee?.email}</p>
      </Dialog>

      <Dialog open={menu === 'password'} title="שינוי סיסמה" onClose={() => setMenu('')} onSubmit={changePassword}
        footer={<>
          <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'שומר…' : 'עדכון סיסמה'}</button>
          <button className="btn btn-quiet" type="button" onClick={() => setMenu('')}>סגירה</button>
        </>}>
        <label><span className="lbl">סיסמה חדשה</span>
          <input type="password" autoComplete="new-password" value={pw.a}
            onChange={e => setPw(s => ({ ...s, a: e.target.value }))} required minLength={MIN_PASSWORD} />
          <span className="hint">לפחות {MIN_PASSWORD} תווים.</span></label>
        <label><span className="lbl">אימות סיסמה</span>
          <input type="password" autoComplete="new-password" value={pw.b}
            onChange={e => setPw(s => ({ ...s, b: e.target.value }))} required /></label>
        <Msg kind="err">{pwErr}</Msg>
        <Msg kind="ok">{pwOk}</Msg>
      </Dialog>

      <Dialog open={menu === 'signout'} title="יציאה מהמערכת" onClose={() => setMenu('')}
        footer={<>
          <button className="btn btn-primary" onClick={signOut}>יציאה</button>
          <button className="btn btn-quiet" onClick={() => setMenu('account')}>ביטול</button>
        </>}>
        <p>לצאת מהחשבון במכשיר הזה?</p>
      </Dialog>
    </div>
  );
}
