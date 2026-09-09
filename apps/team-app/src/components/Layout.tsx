import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'לוח בקרה', icon: '▚', end: true },
  { to: '/companies', label: 'חברות', icon: '▤' },
  { to: '/jobs', label: 'משרות', icon: '▧' },
  { to: '/candidates', label: 'מועמדים', icon: '☺' },
  { to: '/applications', label: 'מועמדויות', icon: '➤' },
  { to: '/tasks', label: 'משימות', icon: '✓' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { employee, signOut } = useAuth();
  return (
    <div className="app-shell">
      <aside className="side">
        <div className="brand">
          <picture>
            <source srcSet="/ursa-logo-dark.png" media="(prefers-color-scheme: dark)" />
            <img src="/ursa-logo.png" alt="URSA GROUP" className="brand-logo" />
          </picture>
        </div>
        <nav>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
              <span className="ic" aria-hidden="true">{n.icon}</span>{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <div className="who">
            <span className="who-name">{employee?.full_name}</span>
            <span className="who-role">{roleLabel(employee?.role)}</span>
          </div>
          <button className="btn btn-quiet btn-sm" onClick={signOut}>יציאה</button>
        </div>
      </aside>
      <main className="main">{children}</main>
      <style>{css}</style>
    </div>
  );
}

function roleLabel(r?: string) {
  return ({ manager: 'מנהלת החברה', superadmin: 'מנהל על', recruiter: 'מגייס' } as Record<string,string>)[r ?? ''] ?? r;
}

const css = `
.app-shell { display: grid; grid-template-columns: 232px 1fr; min-height: 100vh; }
.side { position: sticky; top: 0; height: 100vh; background: var(--card); border-inline-start: 1px solid var(--line);
  display: flex; flex-direction: column; padding: 16px 12px; gap: 4px; }
.brand { padding: 6px 12px 16px; }
.brand-logo { height: 30px; width: auto; display: block; }
.side nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.nav-item { display: flex; align-items: center; gap: 10px; padding: 9px 12px; border-radius: var(--radius-sm);
  color: var(--ink-mid); text-decoration: none; font-weight: 500; }
.nav-item:hover { background: var(--sunk); color: var(--ink); }
.nav-item.active { background: var(--brand-soft); color: var(--brand-ink); font-weight: 600; }
.nav-item .ic { width: 18px; text-align: center; opacity: .8; }
.side-foot { border-top: 1px solid var(--line); padding-top: 12px; display: flex; align-items: center; gap: 8px; justify-content: space-between; }
.who { display: flex; flex-direction: column; overflow: hidden; }
.who-name { font-weight: 600; font-size: .9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who-role { font-size: .76rem; color: var(--ink-soft); }
.main { padding: 28px 32px; max-width: 1200px; }
@media (max-width: 720px) {
  .app-shell { grid-template-columns: 1fr; }
  .side { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; }
  .side nav { flex-direction: row; flex-wrap: wrap; }
  .main { padding: 20px 16px; }
}
`;
