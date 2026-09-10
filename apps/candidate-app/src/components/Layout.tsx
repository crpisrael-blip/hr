import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const tabs = [
  { to: '/', label: 'מועמדויות', icon: 'M4 5h16M4 12h16M4 19h10' },
  { to: '/documents', label: 'מסמכים', icon: 'M7 3h7l4 4v14H7zM14 3v5h5' },
  { to: '/profile', label: 'פרופיל', icon: 'M12 12a4 4 0 100-8 4 4 0 000 8zM5 20a7 7 0 0114 0' },
];

function Ic({ d }: { d: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <img src="/ursa-logo.png" alt="URSA GROUP" className="brand" />
        <button className="signout" onClick={signOut} aria-label="יציאה">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 12H4M9 7l-5 5 5 5M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4" />
          </svg>
        </button>
      </header>

      <main className="content">{children}</main>

      <nav className="tabbar">
        {tabs.map(t => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'}
            className={({ isActive }) => 'tab' + (isActive ? ' active' : '')}>
            <Ic d={t.icon} />
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
