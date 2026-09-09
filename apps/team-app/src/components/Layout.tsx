import { type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const NAV = [
  { to: '/', label: 'דף הבית', icon: '⌂', end: true },
  { to: '/jobs', label: 'משרות', icon: '💼' },
  { to: '/candidates', label: 'מועמדים', icon: '👤' },
  { to: '/companies', label: 'לקוחות', icon: '🏢' },
  { to: '/applications', label: 'תהליכי גיוס', icon: '🔎' },
  { to: '/placements', label: 'השמות', icon: '★' },
  { to: '/reports', label: 'דוחות', icon: '📊' },
  { to: '/tasks', label: 'משימות', icon: '✓' },
  { to: '/calendar', label: 'לוח שנה', icon: '🗓' },
  { to: '/settings', label: 'הגדרות', icon: '⚙' },
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
  return (
    <div className="shell">
      <aside className="side">
        <div className="side-logo">
          <picture>
            <source srcSet="/ursa-logo-dark.png" media="(prefers-color-scheme: dark)" />
            <img src="/ursa-logo.png" alt="URSA GROUP" />
          </picture>
        </div>
        <nav>
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}>
              <span className="ic" aria-hidden="true">{n.icon}</span><span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="promo">
          <div className="promo-title">אנשים מניעים עסקים</div>
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
            <span className="s-ic" aria-hidden="true">⌕</span>
            <input placeholder="חיפוש מועמדים, לקוחות, משרות…" aria-label="חיפוש" />
            <kbd>⌘K</kbd>
          </div>
          <button className="bell" aria-label="התראות">🔔</button>
          <span className="ava sm" title={employee?.full_name}>{initials(employee?.full_name)}</span>
        </header>
        <div className="content">{children}</div>
      </div>
      <style>{css}</style>
    </div>
  );
}

const css = `
.shell { display: grid; grid-template-columns: 248px 1fr; min-height: 100vh; }
.side { position: sticky; top: 0; height: 100vh; background: var(--card);
  border-inline-start: 1px solid var(--line); display: flex; flex-direction: column;
  padding: 18px 14px; gap: 4px; }
.side-logo { padding: 6px 10px 18px; }
.side-logo img { height: 30px; width: auto; display: block; }
.side nav { display: flex; flex-direction: column; gap: 2px; flex: 1; overflow-y: auto; }
.nav-item { display: flex; align-items: center; gap: 11px; padding: 10px 12px; border-radius: 8px;
  color: var(--ink-mid); text-decoration: none; font-weight: 500; font-size: .95rem;
  transition-property: background-color, color; transition-duration: 130ms; }
.nav-item:hover { background: var(--sunk); color: var(--ink); }
.nav-item.active { background: var(--brand-soft); color: var(--brand-ink); font-weight: 600; }
.nav-item .ic { width: 20px; text-align: center; font-size: 1rem; filter: grayscale(.15); }
.promo { margin-top: 8px; padding: 16px; border-radius: 12px;
  background: linear-gradient(150deg, var(--brand) 0%, #1e2a6e 100%); color: #eaf2ff; }
.promo-title { font-weight: 700; margin-bottom: 4px; }
.promo p { font-size: .82rem; color: #c3d3f5; text-wrap: pretty; }
.user-chip { margin-top: 10px; display: flex; align-items: center; gap: 10px; width: 100%;
  background: none; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; cursor: pointer;
  transition-property: background-color, border-color; transition-duration: 130ms; }
.user-chip:hover { background: var(--sunk); border-color: var(--line-strong); }
.ava { display: grid; place-items: center; width: 38px; height: 38px; flex: 0 0 auto; border-radius: 50%;
  background: var(--brand); color: #fff; font-weight: 700; font-size: .85rem; }
.ava.sm { width: 34px; height: 34px; }
.who { display: flex; flex-direction: column; overflow: hidden; text-align: start; }
.who-name { font-weight: 600; font-size: .88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.who-role { font-size: .74rem; color: var(--ink-soft); }
.main { display: flex; flex-direction: column; min-width: 0; }
.topbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; gap: 14px;
  padding: 12px 24px; background: color-mix(in srgb, var(--surface) 85%, transparent);
  backdrop-filter: saturate(140%) blur(8px); border-bottom: 1px solid var(--line); }
.search { position: relative; flex: 1; max-width: 560px; }
.search input { padding-inline-start: 38px; padding-inline-end: 52px; min-height: 42px; border-radius: 10px; background: var(--card); }
.search .s-ic { position: absolute; inset-inline-start: 12px; top: 50%; transform: translateY(-50%); color: var(--ink-soft); font-size: 1.1rem; }
.search kbd { position: absolute; inset-inline-end: 10px; top: 50%; transform: translateY(-50%);
  font: inherit; font-size: .72rem; color: var(--ink-soft); background: var(--sunk);
  border: 1px solid var(--line); border-radius: 6px; padding: 2px 6px; }
.bell { margin-inline-start: auto; width: 42px; height: 42px; border-radius: 10px; border: 1px solid var(--line);
  background: var(--card); cursor: pointer; font-size: 1.05rem;
  transition-property: background-color; transition-duration: 130ms; }
.bell:hover { background: var(--sunk); }
.content { padding: 24px; max-width: 1280px; width: 100%; }
@media (max-width: 820px) {
  .shell { grid-template-columns: 1fr; }
  .side { position: static; height: auto; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  .side-logo { padding: 6px; } .side nav { flex-direction: row; flex-wrap: wrap; flex: 1 1 100%; }
  .promo { display: none; } .user-chip { width: auto; }
  .content { padding: 16px; }
}
`;
