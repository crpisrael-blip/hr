import { type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import Icon from './Icon';

const NAV = [
  { to: '/', label: 'דף הבית', icon: 'home', end: true },
  { to: '/jobs', label: 'משרות', icon: 'jobs' },
  { to: '/candidates', label: 'מועמדים', icon: 'candidates' },
  { to: '/companies', label: 'לקוחות', icon: 'companies' },
  { to: '/applications', label: 'תהליכי גיוס', icon: 'applications' },
  { to: '/placements', label: 'השמות', icon: 'placements' },
  { to: '/reports', label: 'דוחות', icon: 'reports' },
  { to: '/tasks', label: 'משימות', icon: 'tasks' },
  { to: '/calendar', label: 'לוח שנה', icon: 'calendar' },
  { to: '/settings', label: 'הגדרות', icon: 'settings' },
];

function roleLabel(r?: string) {
  return ({ manager: 'מנהל מערכת', superadmin: 'מנהל על', recruiter: 'מגייס' } as Record<string,string>)[r ?? ''] ?? r;
}
function initials(name?: string) {
  if (!name) return '·';
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('');
}

export default function Layout({ children }: { children: ReactNode }) {
  const { employee, signOut } = useAuth();
  const isHome = useLocation().pathname === '/';
  return (
    <div className={"shell" + (isHome ? " home-shell" : "")} dir="rtl">
      <a className="skip-link" href="#main-content">דלגו לתוכן הראשי</a>
      <aside className="side">
        <div className="side-logo">
          <picture>
            <img src="/ursa-logo.png" alt="URSA GROUP" />
          </picture>
        </div>
        <nav aria-label="תפריט ראשי">
          {NAV.map(n => (
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
        <button className="user-chip" onClick={signOut} title="יציאה">
          <span className="ava">{initials(employee?.full_name)}</span>
          <span className="who">
            <span className="who-name">{employee?.full_name}</span>
            <span className="who-role">{roleLabel(employee?.role)}</span>
          </span>
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="search">
            <span className="s-ic" aria-hidden="true"><Icon name="search" size={18} /></span>
            <input placeholder="חיפוש מועמדים, לקוחות, משרות…" aria-label="חיפוש" />
            <kbd>⌘K</kbd>
          </div>
          <button className="bell" aria-label="התראות"><Icon name="bell" /></button>
          <span className="ava sm" title={employee?.full_name}>{initials(employee?.full_name)}</span>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
